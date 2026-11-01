// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BountyEscrow
/// @notice USDC bounty escrow for clients and AI agents with optional agent designation.
/// @dev Rewards are denominated in the token's smallest units. The supplied token
/// must be standard USDC, not a fee-on-transfer or rebasing token. There is no
/// administrator, fee, upgrade mechanism, or automatic approval of results.
contract BountyEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Lifecycle states; Paid and Refunded are terminal.
    enum Status { None, Open, Claimed, Submitted, Paid, Refunded }

    /// @notice Terms, participants, result commitment, and state of a bounty.
    struct Bounty {
        address client;
        address agent;
        /// @notice Only this agent may claim if nonzero; fixed at creation, including after reopening.
        address designatedAgent;
        uint256 reward;
        uint64 deadline;
        uint64 claimedAt;
        bytes32 descriptionHash;
        bytes32 resultHash;
        Status status;
    }

    /// @notice Immutable token used to fund and settle every bounty.
    IERC20 public immutable USDC;

    /// @notice Seconds after a claim before the client may release and bar its agent.
    uint64 public immutable CLAIM_WINDOW;

    /// @notice Bounties by ID; nonexistent IDs return default values.
    mapping(uint256 id => Bounty bounty) public bounties;

    /// @notice Agents barred from a bounty after its client releases their claim.
    mapping(uint256 id => mapping(address agent => bool barred)) public barredAgents;

    /// @notice ID assigned to the next bounty. IDs start at one.
    uint256 public nextBountyId = 1;

    /// @notice The supplied token address is zero.
    error ZeroAddress();
    /// @notice Rewards must be positive.
    error InvalidReward();
    /// @notice Description commitments cannot be zero.
    error InvalidDescriptionHash();
    /// @notice Result commitments cannot be zero.
    error InvalidResultHash();
    /// @notice A new bounty's deadline must be in the future.
    error InvalidDeadline();
    /// @notice The requested bounty does not exist.
    error BountyNotFound(uint256 id);
    /// @notice The bounty is not in the state required by this operation.
    error InvalidStatus(uint256 id, Status actual);
    /// @notice Only the bounty client may perform this operation.
    error OnlyClient(uint256 id);
    /// @notice Only the assigned agent may perform this operation.
    error OnlyAgent(uint256 id);
    /// @notice A client cannot claim their own bounty.
    error ClientCannotClaim(uint256 id);
    /// @notice Claiming and submitting are forbidden at or after the deadline.
    error DeadlineReached(uint256 id);
    /// @notice Refunds are forbidden before the deadline.
    error DeadlineNotReached(uint256 id);
    /// @notice The claim window must be positive.
    error InvalidClaimWindow();
    /// @notice The agent is barred from claiming this bounty.
    error AgentBarred(uint256 id, address agent);
    /// @notice The client cannot release a claim before its claim window elapses.
    error ClaimWindowNotElapsed(uint256 id);
    /// @notice A client cannot designate themselves as the bounty's agent.
    error InvalidDesignatedAgent();
    /// @notice Only the designated agent may claim this bounty.
    error NotDesignatedAgent(uint256 id);

    /// @notice Emitted when a funded bounty is created.
    event BountyCreated(
        uint256 indexed id,
        address indexed client,
        bytes32 descriptionHash,
        uint256 reward,
        uint64 deadline,
        address designatedAgent
    );
    /// @notice Emitted when an agent claims an open bounty.
    event BountyClaimed(uint256 indexed id, address indexed agent);
    /// @notice Emitted when an agent or client releases an unsubmitted claim.
    event ClaimReleased(uint256 indexed id, address indexed agent, address indexed releasedBy);
    /// @notice Emitted when the assigned agent submits a result commitment.
    event ResultSubmitted(uint256 indexed id, address indexed agent, bytes32 resultHash);
    /// @notice Emitted when the client accepts a result and pays the agent.
    event BountyAccepted(uint256 indexed id, address indexed agent, uint256 reward);
    /// @notice Emitted with the rejected agent and commitment when a bounty reopens.
    event BountyRejected(uint256 indexed id, address indexed agent, bytes32 resultHash);
    /// @notice Emitted when an expired bounty's reward is returned to its client.
    event BountyRefunded(uint256 indexed id, address indexed client, uint256 reward);

    /// @notice Initialize the escrow with its USDC token and claim window.
    /// @param usdc_ Address of the USDC token contract.
    /// @param claimWindow_ Positive duration in seconds before client claim release.
    constructor(address usdc_, uint64 claimWindow_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (claimWindow_ == 0) revert InvalidClaimWindow();
        USDC = IERC20(usdc_);
        CLAIM_WINDOW = claimWindow_;
    }

    /// @notice Return the number of bounties ever created, including terminal ones.
    /// @return count Total number of created bounties.
    function bountyCount() external view returns (uint256 count) {
        return nextBountyId - 1;
    }

    /// @notice Return a bounty as a struct, reverting if it does not exist.
    /// @param id Bounty ID.
    /// @return bounty The complete bounty record.
    function getBounty(uint256 id) external view returns (Bounty memory bounty) {
        return _existingBounty(id);
    }

    /// @notice Create and fully fund a bounty; approve this escrow beforehand.
    /// @param descriptionHash Nonzero commitment to the off-chain task description.
    /// @param reward Reward in USDC's smallest units.
    /// @param deadline Future Unix timestamp; the original deadline never changes.
    /// @param designatedAgent Permanent eligible agent, or zero for open claiming; cannot be the client.
    /// @return id Newly allocated bounty ID.
    function createBounty(bytes32 descriptionHash, uint256 reward, uint64 deadline, address designatedAgent)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (reward == 0) revert InvalidReward();
        if (descriptionHash == bytes32(0)) revert InvalidDescriptionHash();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (designatedAgent != address(0) && designatedAgent == msg.sender) revert InvalidDesignatedAgent();

        id = nextBountyId++;
        bounties[id] = Bounty({
            client: msg.sender,
            agent: address(0),
            designatedAgent: designatedAgent,
            reward: reward,
            deadline: deadline,
            claimedAt: 0,
            descriptionHash: descriptionHash,
            resultHash: bytes32(0),
            status: Status.Open
        });

        USDC.safeTransferFrom(msg.sender, address(this), reward);
        emit BountyCreated(id, msg.sender, descriptionHash, reward, deadline, designatedAgent);
    }

    /// @notice Claim an open bounty before its deadline, unless you are its client or barred.
    /// @dev A nonzero designated agent restricts claiming to that address.
    /// @param id Bounty ID.
    function claim(uint256 id) external nonReentrant {
        Bounty storage bounty = _existingBounty(id);
        if (bounty.status != Status.Open) revert InvalidStatus(id, bounty.status);
        if (block.timestamp >= bounty.deadline) revert DeadlineReached(id);
        if (msg.sender == bounty.client) revert ClientCannotClaim(id);
        if (barredAgents[id][msg.sender]) revert AgentBarred(id, msg.sender);
        if (bounty.designatedAgent != address(0) && msg.sender != bounty.designatedAgent) {
            revert NotDesignatedAgent(id);
        }

        bounty.agent = msg.sender;
        bounty.claimedAt = uint64(block.timestamp);
        bounty.status = Status.Claimed;
        emit BountyClaimed(id, msg.sender);
    }

    /// @notice Reopen an unsubmitted claim voluntarily, or as its client after the claim window.
    /// @dev Client release bars the agent from this bounty; voluntary release does not.
    /// Release does not extend the deadline and remains possible after expiry.
    /// @param id Bounty ID.
    function releaseClaim(uint256 id) external nonReentrant {
        Bounty storage bounty = _existingBounty(id);
        if (bounty.status != Status.Claimed) revert InvalidStatus(id, bounty.status);

        address agent = bounty.agent;
        if (msg.sender != agent) {
            if (msg.sender != bounty.client) revert OnlyClient(id);
            if (block.timestamp < uint256(bounty.claimedAt) + CLAIM_WINDOW) {
                revert ClaimWindowNotElapsed(id);
            }
            barredAgents[id][agent] = true;
        }

        bounty.agent = address(0);
        bounty.claimedAt = 0;
        bounty.status = Status.Open;
        emit ClaimReleased(id, agent, msg.sender);
    }

    /// @notice Submit a nonzero result commitment as the assigned agent before expiry.
    /// @param id Bounty ID.
    /// @param resultHash Commitment to the off-chain result.
    function submitResult(uint256 id, bytes32 resultHash) external nonReentrant {
        Bounty storage bounty = _existingBounty(id);
        if (msg.sender != bounty.agent) revert OnlyAgent(id);
        if (bounty.status != Status.Claimed) revert InvalidStatus(id, bounty.status);
        if (block.timestamp >= bounty.deadline) revert DeadlineReached(id);
        if (resultHash == bytes32(0)) revert InvalidResultHash();

        bounty.resultHash = resultHash;
        bounty.status = Status.Submitted;
        emit ResultSubmitted(id, msg.sender, resultHash);
    }

    /// @notice Accept a submitted result and pay its agent, even after the deadline.
    /// @dev A refunded bounty cannot be accepted. State changes precede transfer.
    /// @param id Bounty ID.
    function accept(uint256 id) external nonReentrant {
        Bounty storage bounty = _existingBounty(id);
        if (msg.sender != bounty.client) revert OnlyClient(id);
        if (bounty.status != Status.Submitted) revert InvalidStatus(id, bounty.status);

        bounty.status = Status.Paid;
        USDC.safeTransfer(bounty.agent, bounty.reward);
        emit BountyAccepted(id, bounty.agent, bounty.reward);
    }

    /// @notice Reject a submitted result and reopen the bounty without extending it.
    /// @dev Clears the claim timestamp. Rejection remains possible after expiry, but new claims do not.
    /// @param id Bounty ID.
    function reject(uint256 id) external nonReentrant {
        Bounty storage bounty = _existingBounty(id);
        if (msg.sender != bounty.client) revert OnlyClient(id);
        if (bounty.status != Status.Submitted) revert InvalidStatus(id, bounty.status);

        address rejectedAgent = bounty.agent;
        bytes32 rejectedResultHash = bounty.resultHash;
        bounty.agent = address(0);
        bounty.claimedAt = 0;
        bounty.resultHash = bytes32(0);
        bounty.status = Status.Open;
        emit BountyRejected(id, rejectedAgent, rejectedResultHash);
    }

    /// @notice Refund an expired, unpaid bounty to its client.
    /// @dev Open, Claimed, and Submitted are refundable at or after the deadline.
    /// State changes precede transfer; Paid and Refunded cannot be refunded.
    /// @param id Bounty ID.
    function refund(uint256 id) external nonReentrant {
        Bounty storage bounty = _existingBounty(id);
        if (msg.sender != bounty.client) revert OnlyClient(id);
        if (block.timestamp < bounty.deadline) revert DeadlineNotReached(id);
        if (
            bounty.status != Status.Open && bounty.status != Status.Claimed
                && bounty.status != Status.Submitted
        ) revert InvalidStatus(id, bounty.status);

        bounty.status = Status.Refunded;
        USDC.safeTransfer(bounty.client, bounty.reward);
        emit BountyRefunded(id, bounty.client, bounty.reward);
    }

    /// @dev Resolve an existing bounty without permitting a default mapping entry.
    function _existingBounty(uint256 id) private view returns (Bounty storage bounty) {
        bounty = bounties[id];
        if (bounty.status == Status.None) revert BountyNotFound(id);
    }
}
