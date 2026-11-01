// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BountyEscrow} from "../BountyEscrow.sol";

/// @dev Minimal 6-decimal ERC20 for testing.
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amt) external {
        totalSupply += amt;
        balanceOf[to] += amt;
        emit Transfer(address(0), to, amt);
    }

    function approve(address s, uint256 amt) external returns (bool) {
        allowance[msg.sender][s] = amt;
        emit Approval(msg.sender, s, amt);
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        _move(from, to, amt);
        return true;
    }

    function _move(address from, address to, uint256 amt) internal {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        emit Transfer(from, to, amt);
    }
}

abstract contract BountyEscrowBase is Test {
    BountyEscrow internal escrow;
    MockUSDC internal usdc;

    address internal client = makeAddr("client");
    address internal agent = makeAddr("agent");
    address internal agent2 = makeAddr("agent2");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant REWARD = 100e6;
    bytes32 internal constant DESC = keccak256("task description");
    bytes32 internal constant RESULT = keccak256("result");
    bytes32 internal constant RESULT2 = keccak256("result2");
    uint64 internal constant CLAIM_WINDOW = 1 days;
    uint64 internal deadline;

    function setUp() public virtual {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
        escrow = new BountyEscrow(address(usdc), CLAIM_WINDOW);
        usdc.mint(client, 10_000e6);
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);
        deadline = uint64(block.timestamp + 7 days);
    }

    function _create() internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.createBounty(DESC, REWARD, deadline, address(0));
    }

    function _createFor(address designated) internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.createBounty(DESC, REWARD, deadline, designated);
    }

    function _claim(uint256 id, address who) internal {
        vm.prank(who);
        escrow.claim(id);
    }

    function _submit(uint256 id, address who, bytes32 h) internal {
        vm.prank(who);
        escrow.submitResult(id, h);
    }

    function _toSubmitted() internal returns (uint256 id) {
        id = _create();
        _claim(id, agent);
        _submit(id, agent, RESULT);
    }

    function _status(uint256 id) internal view returns (BountyEscrow.Status) {
        return escrow.getBounty(id).status;
    }
}

contract BountyEscrowTest is BountyEscrowBase {
    // ---------- deployment ----------
    function test_Constructor_SetsUsdcAndCounter() public view {
        assertEq(address(escrow.USDC()), address(usdc));
        assertEq(escrow.CLAIM_WINDOW(), CLAIM_WINDOW);
        assertEq(escrow.nextBountyId(), 1);
        assertEq(escrow.bountyCount(), 0);
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        new BountyEscrow(address(0), CLAIM_WINDOW);
    }

    function test_Constructor_RevertsOnZeroClaimWindow() public {
        vm.expectRevert(BountyEscrow.InvalidClaimWindow.selector);
        new BountyEscrow(address(usdc), 0);
    }

    // ---------- (1) happy flow ----------
    function test_HappyFlow_CreateClaimSubmitAccept() public {
        uint256 clientStart = usdc.balanceOf(client);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyCreated(1, client, DESC, REWARD, deadline, address(0));
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(escrow.getBounty(id).designatedAgent, address(0));
        assertEq(escrow.bountyCount(), 1);
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
        assertEq(usdc.balanceOf(client), clientStart - REWARD);
        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        assertEq(b.client, client);
        assertEq(b.agent, address(0));
        assertEq(b.reward, REWARD);
        assertEq(b.deadline, deadline);
        assertEq(b.descriptionHash, DESC);
        assertEq(b.resultHash, bytes32(0));
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Open));

        vm.expectEmit(true, true, false, false, address(escrow));
        emit BountyEscrow.BountyClaimed(id, agent);
        _claim(id, agent);
        b = escrow.getBounty(id);
        assertEq(b.agent, agent);
        assertEq(b.claimedAt, uint64(block.timestamp));
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Claimed));

        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.ResultSubmitted(id, agent, RESULT);
        _submit(id, agent, RESULT);
        b = escrow.getBounty(id);
        assertEq(b.resultHash, RESULT);
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Submitted));
        assertEq(usdc.balanceOf(address(escrow)), REWARD);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyAccepted(id, agent, REWARD);
        vm.prank(client);
        escrow.accept(id);

        assertEq(usdc.balanceOf(agent), REWARD);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(client), clientStart - REWARD);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Paid));
    }

    function test_Accept_WorksAfterDeadline() public {
        uint256 id = _toSubmitted();
        vm.warp(deadline + 1 days);
        vm.prank(client);
        escrow.accept(id);
        assertEq(usdc.balanceOf(agent), REWARD);
    }

    // ---------- (2) rejection ----------
    function test_Reject_ReopensClearsAndSecondAgentPaid() public {
        uint256 id = _toSubmitted();

        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyRejected(id, agent, RESULT);
        vm.prank(client);
        escrow.reject(id);

        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Open));
        assertEq(b.agent, address(0));
        assertEq(b.claimedAt, 0);
        assertEq(b.resultHash, bytes32(0));
        assertEq(b.reward, REWARD);
        assertEq(b.deadline, deadline);
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
        assertEq(usdc.balanceOf(agent), 0);

        _claim(id, agent2);
        _submit(id, agent2, RESULT2);
        vm.prank(client);
        escrow.accept(id);

        assertEq(usdc.balanceOf(agent2), REWARD);
        assertEq(usdc.balanceOf(agent), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Paid));
    }

    function test_Reject_PreviousAgentCanReclaim() public {
        uint256 id = _toSubmitted();
        vm.prank(client);
        escrow.reject(id);
        _claim(id, agent);
        assertEq(escrow.getBounty(id).agent, agent);
    }

    function test_Reject_AfterDeadlineThenClaimReverts() public {
        uint256 id = _toSubmitted();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.reject(id);
        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineReached.selector, id));
        escrow.claim(id);
    }

    function test_Reject_RevertsForNonClient() public {
        uint256 id = _toSubmitted();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyClient.selector, id));
        escrow.reject(id);
    }

    function test_Reject_RevertsWhenNotSubmitted() public {
        uint256 id = _create();
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(BountyEscrow.InvalidStatus.selector, id, BountyEscrow.Status.Open)
        );
        escrow.reject(id);
    }

    // ---------- (3) refunds ----------
    function _assertRefunded(uint256 id, uint256 clientBefore) internal view {
        assertEq(usdc.balanceOf(client), clientBefore + REWARD);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Refunded));
    }

    function test_Refund_FromOpen() public {
        uint256 id = _create();
        uint256 before = usdc.balanceOf(client);
        vm.warp(deadline);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyRefunded(id, client, REWARD);
        vm.prank(client);
        escrow.refund(id);
        _assertRefunded(id, before);
    }

    function test_Refund_FromClaimed() public {
        uint256 id = _create();
        _claim(id, agent);
        uint256 before = usdc.balanceOf(client);
        vm.warp(deadline + 1);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyRefunded(id, client, REWARD);
        vm.prank(client);
        escrow.refund(id);
        _assertRefunded(id, before);
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_Refund_FromSubmitted() public {
        uint256 id = _toSubmitted();
        uint256 before = usdc.balanceOf(client);
        vm.warp(deadline + 1);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyRefunded(id, client, REWARD);
        vm.prank(client);
        escrow.refund(id);
        _assertRefunded(id, before);
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_Refund_RevertsBeforeDeadline() public {
        uint256 id = _create();
        vm.warp(deadline - 1);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineNotReached.selector, id));
        escrow.refund(id);
    }

    function test_Refund_RevertsForNonClient() public {
        uint256 id = _create();
        vm.warp(deadline + 1);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyClient.selector, id));
        escrow.refund(id);
    }

    function test_Refund_AgentCannotRefund() public {
        uint256 id = _toSubmitted();
        vm.warp(deadline + 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyClient.selector, id));
        escrow.refund(id);
    }

    // ---------- (4) double payout ----------
    function _invalidStatus(uint256 id, BountyEscrow.Status s) internal {
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.InvalidStatus.selector, id, s));
    }

    function test_DoubleAccept_Reverts() public {
        uint256 id = _toSubmitted();
        vm.prank(client);
        escrow.accept(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Paid);
        escrow.accept(id);
        assertEq(usdc.balanceOf(agent), REWARD);
    }

    function test_AcceptAfterRefund_Reverts() public {
        uint256 id = _toSubmitted();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Refunded);
        escrow.accept(id);
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_RefundAfterAccept_Reverts() public {
        uint256 id = _toSubmitted();
        vm.prank(client);
        escrow.accept(id);
        vm.warp(deadline + 1);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Paid);
        escrow.refund(id);
        assertEq(usdc.balanceOf(agent), REWARD);
    }

    function test_RejectAfterAccept_Reverts() public {
        uint256 id = _toSubmitted();
        vm.prank(client);
        escrow.accept(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Paid);
        escrow.reject(id);
    }

    function test_DoubleRefund_Reverts() public {
        uint256 id = _create();
        vm.warp(deadline + 1);
        vm.prank(client);
        escrow.refund(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Refunded);
        escrow.refund(id);
    }

    function test_EscrowNeverPaysMoreThanReward_OtherBountyFundsSafe() public {
        uint256 id1 = _create();
        uint256 id2 = _create();
        _claim(id1, agent);
        _submit(id1, agent, RESULT);
        vm.prank(client);
        escrow.accept(id1);
        // repeat attempts cannot drain bounty 2's funds
        vm.startPrank(client);
        vm.expectRevert();
        escrow.accept(id1);
        vm.expectRevert();
        escrow.refund(id1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(agent), REWARD);
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
        assertEq(uint8(_status(id2)), uint8(BountyEscrow.Status.Open));
    }

    // ---------- (5) access control & reverts ----------
    function test_Create_RevertsZeroReward() public {
        vm.prank(client);
        vm.expectRevert(BountyEscrow.InvalidReward.selector);
        escrow.createBounty(DESC, 0, deadline, address(0));
    }

    function test_Create_RevertsZeroHash() public {
        vm.prank(client);
        vm.expectRevert(BountyEscrow.InvalidDescriptionHash.selector);
        escrow.createBounty(bytes32(0), REWARD, deadline, address(0));
    }

    function test_Create_RevertsPastAndCurrentDeadline() public {
        vm.startPrank(client);
        vm.expectRevert(BountyEscrow.InvalidDeadline.selector);
        escrow.createBounty(DESC, REWARD, uint64(block.timestamp - 1), address(0));
        vm.expectRevert(BountyEscrow.InvalidDeadline.selector);
        escrow.createBounty(DESC, REWARD, uint64(block.timestamp), address(0));
        vm.stopPrank();
    }

    function test_Create_RevertsWithoutAllowance() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.createBounty(DESC, REWARD, deadline, address(0));
    }

    function test_Claim_ClientCannotClaim() public {
        uint256 id = _create();
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClientCannotClaim.selector, id));
        escrow.claim(id);
    }

    function test_Claim_RevertsAfterDeadline() public {
        uint256 id = _create();
        vm.warp(deadline);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineReached.selector, id));
        escrow.claim(id);
    }

    function test_Claim_RevertsWhenAlreadyClaimed() public {
        uint256 id = _create();
        _claim(id, agent);
        vm.prank(agent2);
        _invalidStatus(id, BountyEscrow.Status.Claimed);
        escrow.claim(id);
    }

    function test_Submit_OnlyAgent() public {
        uint256 id = _create();
        _claim(id, agent);
        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyAgent.selector, id));
        escrow.submitResult(id, RESULT);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyAgent.selector, id));
        escrow.submitResult(id, RESULT);
    }

    function test_Submit_RevertsZeroHash() public {
        uint256 id = _create();
        _claim(id, agent);
        vm.prank(agent);
        vm.expectRevert(BountyEscrow.InvalidResultHash.selector);
        escrow.submitResult(id, bytes32(0));
    }

    function test_Submit_RevertsAfterDeadline() public {
        uint256 id = _create();
        _claim(id, agent);
        vm.warp(deadline);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineReached.selector, id));
        escrow.submitResult(id, RESULT);
    }

    function test_Submit_RevertsWhenAlreadySubmitted() public {
        uint256 id = _toSubmitted();
        vm.prank(agent);
        _invalidStatus(id, BountyEscrow.Status.Submitted);
        escrow.submitResult(id, RESULT2);
    }

    function test_Accept_OnlyClient() public {
        uint256 id = _toSubmitted();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyClient.selector, id));
        escrow.accept(id);
    }

    function test_Accept_RevertsWhenNotSubmitted() public {
        uint256 id = _create();
        _claim(id, agent);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Claimed);
        escrow.accept(id);
    }

    function test_UnknownId_Reverts() public {
        uint256 bad = 999;
        bytes memory err = abi.encodeWithSelector(BountyEscrow.BountyNotFound.selector, bad);
        vm.expectRevert(err);
        escrow.getBounty(bad);
        vm.expectRevert(err);
        escrow.claim(bad);
        vm.expectRevert(err);
        escrow.submitResult(bad, RESULT);
        vm.expectRevert(err);
        escrow.accept(bad);
        vm.expectRevert(err);
        escrow.reject(bad);
        vm.expectRevert(err);
        escrow.releaseClaim(bad);
        vm.expectRevert(err);
        escrow.refund(bad);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.BountyNotFound.selector, 0));
        escrow.getBounty(0);
    }

    // ---------- (5b) releaseClaim / claim window ----------
    function _claimed() internal returns (uint256 id, uint64 claimedAt) {
        id = _create();
        _claim(id, agent);
        claimedAt = uint64(block.timestamp);
    }

    function _release(uint256 id, address who) internal {
        vm.prank(who);
        escrow.releaseClaim(id);
    }

    function test_Claim_RecordsClaimedAt() public {
        uint256 id = _create();
        assertEq(escrow.getBounty(id).claimedAt, 0);
        skip(123);
        _claim(id, agent);
        assertEq(escrow.getBounty(id).claimedAt, uint64(block.timestamp));
    }

    function test_Release_AgentImmediately_ReopensAndEmits() public {
        (uint256 id,) = _claimed();
        vm.expectEmit(true, true, true, false, address(escrow));
        emit BountyEscrow.ClaimReleased(id, agent, agent);
        _release(id, agent);

        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Open));
        assertEq(b.agent, address(0));
        assertEq(b.claimedAt, 0);
        assertEq(b.reward, REWARD);
        assertEq(b.deadline, deadline);
        assertFalse(escrow.barredAgents(id, agent));
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_Release_AgentAfterWindow_NotBarred() public {
        (uint256 id,) = _claimed();
        skip(CLAIM_WINDOW + 1 hours);
        vm.expectEmit(true, true, true, false, address(escrow));
        emit BountyEscrow.ClaimReleased(id, agent, agent);
        _release(id, agent);
        assertFalse(escrow.barredAgents(id, agent));
        _claim(id, agent); // agent may reclaim after voluntary release
        assertEq(escrow.getBounty(id).agent, agent);
    }

    function test_Release_AgentCanReclaimAndOthersCanClaim() public {
        (uint256 id,) = _claimed();
        _release(id, agent);
        _claim(id, agent2);
        assertEq(escrow.getBounty(id).agent, agent2);
    }

    function test_Release_ClientAfterWindow_BarsAgentAndEmits() public {
        (uint256 id, uint64 claimedAt) = _claimed();
        vm.warp(uint256(claimedAt) + CLAIM_WINDOW);
        vm.expectEmit(true, true, true, false, address(escrow));
        emit BountyEscrow.ClaimReleased(id, agent, client);
        _release(id, client);

        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Open));
        assertEq(b.agent, address(0));
        assertEq(b.claimedAt, 0);
        assertTrue(escrow.barredAgents(id, agent));
        assertFalse(escrow.barredAgents(id, agent2));
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
    }

    function test_Release_ClientBeforeWindow_Reverts() public {
        (uint256 id, uint64 claimedAt) = _claimed();
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClaimWindowNotElapsed.selector, id));
        escrow.releaseClaim(id);

        vm.warp(uint256(claimedAt) + CLAIM_WINDOW - 1);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClaimWindowNotElapsed.selector, id));
        escrow.releaseClaim(id);

        assertEq(escrow.getBounty(id).agent, agent);
        assertFalse(escrow.barredAgents(id, agent));
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Claimed));
    }

    function test_Release_StrangerReverts_BeforeAndAfterWindow() public {
        (uint256 id,) = _claimed();
        bytes memory err = abi.encodeWithSelector(BountyEscrow.OnlyClient.selector, id);
        vm.prank(stranger);
        vm.expectRevert(err);
        escrow.releaseClaim(id);
        skip(CLAIM_WINDOW + 1);
        vm.prank(stranger);
        vm.expectRevert(err);
        escrow.releaseClaim(id);
        vm.prank(agent2);
        vm.expectRevert(err);
        escrow.releaseClaim(id);
        assertEq(escrow.getBounty(id).agent, agent);
    }

    function test_Release_RevertsWhenOpen() public {
        uint256 id = _create();
        vm.prank(agent);
        _invalidStatus(id, BountyEscrow.Status.Open);
        escrow.releaseClaim(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Open);
        escrow.releaseClaim(id);
    }

    function test_Release_RevertsWhenSubmitted() public {
        uint256 id = _toSubmitted();
        skip(CLAIM_WINDOW + 1);
        vm.prank(agent);
        _invalidStatus(id, BountyEscrow.Status.Submitted);
        escrow.releaseClaim(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Submitted);
        escrow.releaseClaim(id);
    }

    function test_Release_RevertsWhenPaid() public {
        uint256 id = _toSubmitted();
        vm.prank(client);
        escrow.accept(id);
        vm.prank(agent);
        _invalidStatus(id, BountyEscrow.Status.Paid);
        escrow.releaseClaim(id);
    }

    function test_Release_RevertsWhenRefunded() public {
        uint256 id = _create();
        vm.warp(deadline);
        vm.prank(client);
        escrow.refund(id);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Refunded);
        escrow.releaseClaim(id);
    }

    function test_Release_DoubleReleaseReverts() public {
        (uint256 id,) = _claimed();
        _release(id, agent);
        vm.prank(agent);
        _invalidStatus(id, BountyEscrow.Status.Open);
        escrow.releaseClaim(id);
    }

    function test_BarredAgent_CannotReclaim_OthersCan() public {
        (uint256 id, uint64 claimedAt) = _claimed();
        vm.warp(uint256(claimedAt) + CLAIM_WINDOW);
        _release(id, client);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AgentBarred.selector, id, agent));
        escrow.claim(id);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Open));

        vm.expectEmit(true, true, false, false, address(escrow));
        emit BountyEscrow.BountyClaimed(id, agent2);
        _claim(id, agent2);
        assertEq(escrow.getBounty(id).agent, agent2);
    }

    function test_BarredAgent_StillBarredAfterSecondAgentRejected() public {
        (uint256 id, uint64 claimedAt) = _claimed();
        vm.warp(uint256(claimedAt) + CLAIM_WINDOW);
        _release(id, client);
        _claim(id, agent2);
        _submit(id, agent2, RESULT2);
        vm.prank(client);
        escrow.reject(id);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AgentBarred.selector, id, agent));
        escrow.claim(id);
        _claim(id, agent2); // agent2 was only rejected, not barred
        assertEq(escrow.getBounty(id).agent, agent2);
    }

    function test_BarredAgent_OnlyBarredOnThatBounty() public {
        (uint256 id1, uint64 claimedAt) = _claimed();
        uint256 id2 = _create();
        vm.warp(uint256(claimedAt) + CLAIM_WINDOW);
        _release(id1, client);
        assertTrue(escrow.barredAgents(id1, agent));
        assertFalse(escrow.barredAgents(id2, agent));
        _claim(id2, agent);
        assertEq(escrow.getBounty(id2).agent, agent);
    }

    function test_BarredAgent_CannotSubmit() public {
        (uint256 id, uint64 claimedAt) = _claimed();
        vm.warp(uint256(claimedAt) + CLAIM_WINDOW);
        _release(id, client);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.OnlyAgent.selector, id));
        escrow.submitResult(id, RESULT);
    }

    function test_Release_FullFlowAfterClientRelease_SecondAgentPaid() public {
        (uint256 id, uint64 claimedAt) = _claimed();
        vm.warp(uint256(claimedAt) + CLAIM_WINDOW);
        _release(id, client);
        _claim(id, agent2);
        _submit(id, agent2, RESULT2);
        vm.prank(client);
        escrow.accept(id);
        assertEq(usdc.balanceOf(agent2), REWARD);
        assertEq(usdc.balanceOf(agent), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Reclaim_ResetsClaimedAtAndWindow() public {
        (uint256 id,) = _claimed();
        skip(CLAIM_WINDOW / 2);
        _release(id, agent);
        skip(CLAIM_WINDOW);
        _claim(id, agent2);
        uint64 secondClaimAt = uint64(block.timestamp);
        assertEq(escrow.getBounty(id).claimedAt, secondClaimAt);

        // window is measured from the NEW claim, not the first one
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClaimWindowNotElapsed.selector, id));
        escrow.releaseClaim(id);
        vm.warp(uint256(secondClaimAt) + CLAIM_WINDOW);
        _release(id, client);
        assertTrue(escrow.barredAgents(id, agent2));
    }

    function test_Reject_ThenReclaimGetsFreshClaimedAt() public {
        uint256 id = _toSubmitted();
        vm.prank(client);
        escrow.reject(id);
        assertEq(escrow.getBounty(id).claimedAt, 0);
        skip(2 hours);
        _claim(id, agent2);
        assertEq(escrow.getBounty(id).claimedAt, uint64(block.timestamp));
    }

    function test_Release_ClientAfterDeadline_ThenRefund() public {
        (uint256 id,) = _claimed();
        vm.warp(deadline + 1);
        uint256 before = usdc.balanceOf(client);
        _release(id, client); // allowed after expiry
        assertTrue(escrow.barredAgents(id, agent));
        // cannot be claimed after expiry
        vm.prank(agent2);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineReached.selector, id));
        escrow.claim(id);
        vm.prank(client);
        escrow.refund(id);
        _assertRefunded(id, before);
    }

    function test_Release_AgentAfterDeadline_Allowed() public {
        (uint256 id,) = _claimed();
        vm.warp(deadline + 1);
        _release(id, agent);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Open));
        assertFalse(escrow.barredAgents(id, agent));
    }

    // ---------- (5c) designated agent ----------
    function _notDesignated(uint256 id) internal {
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotDesignatedAgent.selector, id));
    }

    function test_Designated_CreateStoresAndEmits() public {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyCreated(1, client, DESC, REWARD, deadline, agent);
        uint256 id = _createFor(agent);
        assertEq(escrow.getBounty(id).designatedAgent, agent);
        assertEq(escrow.getBounty(id).agent, address(0));
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Open));
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
    }

    function test_Designated_AgentClaimsSubmitsAndIsPaid() public {
        uint256 id = _createFor(agent);
        vm.expectEmit(true, true, false, false, address(escrow));
        emit BountyEscrow.BountyClaimed(id, agent);
        _claim(id, agent);
        assertEq(escrow.getBounty(id).agent, agent);
        _submit(id, agent, RESULT);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyAccepted(id, agent, REWARD);
        vm.prank(client);
        escrow.accept(id);
        assertEq(usdc.balanceOf(agent), REWARD);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Paid));
        assertEq(escrow.getBounty(id).designatedAgent, agent);
    }

    function test_Designated_OtherAgentsCannotClaim() public {
        uint256 id = _createFor(agent);
        vm.prank(agent2);
        _notDesignated(id);
        escrow.claim(id);
        vm.prank(stranger);
        _notDesignated(id);
        escrow.claim(id);
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Open));
        assertEq(escrow.getBounty(id).agent, address(0));
    }

    function test_Designated_ClientStillCannotClaim() public {
        uint256 id = _createFor(agent);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClientCannotClaim.selector, id));
        escrow.claim(id);
    }

    function test_Designated_OpenBountyAnyoneCanClaim() public {
        uint256 id = _createFor(address(0));
        _claim(id, agent2);
        assertEq(escrow.getBounty(id).agent, agent2);
    }

    function test_Designated_SelfDesignationReverts() public {
        vm.prank(client);
        vm.expectRevert(BountyEscrow.InvalidDesignatedAgent.selector);
        escrow.createBounty(DESC, REWARD, deadline, client);
        assertEq(escrow.bountyCount(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Designated_SurvivesReject() public {
        uint256 id = _createFor(agent);
        _claim(id, agent);
        _submit(id, agent, RESULT);
        vm.prank(client);
        escrow.reject(id);

        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        assertEq(b.designatedAgent, agent);
        assertEq(b.agent, address(0));
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Open));

        vm.prank(agent2);
        _notDesignated(id);
        escrow.claim(id);

        _claim(id, agent);
        _submit(id, agent, RESULT2);
        vm.prank(client);
        escrow.accept(id);
        assertEq(usdc.balanceOf(agent), REWARD);
        assertEq(usdc.balanceOf(agent2), 0);
    }

    function test_Designated_SurvivesVoluntaryRelease() public {
        uint256 id = _createFor(agent);
        _claim(id, agent);
        _release(id, agent);
        assertEq(escrow.getBounty(id).designatedAgent, agent);
        vm.prank(agent2);
        _notDesignated(id);
        escrow.claim(id);
        _claim(id, agent);
        assertEq(escrow.getBounty(id).agent, agent);
    }

    function test_Designated_ClientReleaseBarsDesignated() public {
        uint256 id = _createFor(agent);
        _claim(id, agent);
        skip(CLAIM_WINDOW);
        _release(id, client);
        assertEq(escrow.getBounty(id).designatedAgent, agent);
        assertTrue(escrow.barredAgents(id, agent));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AgentBarred.selector, id, agent));
        escrow.claim(id);
        vm.prank(agent2);
        _notDesignated(id);
        escrow.claim(id);
    }

    function test_Designated_RefundUnclaimedAfterDeadline() public {
        uint256 id = _createFor(agent);
        uint256 before = usdc.balanceOf(client);
        vm.warp(deadline);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineReached.selector, id));
        escrow.claim(id);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit BountyEscrow.BountyRefunded(id, client, REWARD);
        vm.prank(client);
        escrow.refund(id);
        _assertRefunded(id, before);
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_Designated_RefundAfterClaimedAndSubmittedDeadline() public {
        uint256 id1 = _createFor(agent);
        uint256 id2 = _createFor(agent);
        _claim(id1, agent);
        _claim(id2, agent);
        _submit(id2, agent, RESULT);
        uint256 before = usdc.balanceOf(client);
        vm.warp(deadline + 1);
        vm.startPrank(client);
        escrow.refund(id1);
        escrow.refund(id2);
        vm.stopPrank();
        assertEq(usdc.balanceOf(client), before + 2 * REWARD);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(agent), 0);
        assertEq(uint8(_status(id1)), uint8(BountyEscrow.Status.Refunded));
        assertEq(uint8(_status(id2)), uint8(BountyEscrow.Status.Refunded));
    }

    function test_Designated_DoublePayoutAndRefundAfterPaidReverts() public {
        uint256 id = _createFor(agent);
        _claim(id, agent);
        _submit(id, agent, RESULT);
        vm.startPrank(client);
        escrow.accept(id);
        _invalidStatus(id, BountyEscrow.Status.Paid);
        escrow.accept(id);
        vm.stopPrank();
        vm.warp(deadline + 1);
        vm.prank(client);
        _invalidStatus(id, BountyEscrow.Status.Paid);
        escrow.refund(id);
        assertEq(usdc.balanceOf(agent), REWARD);
    }

    function testFuzz_Designated_OnlyDesignatedCanClaim(address designated, address caller) public {
        vm.assume(designated != address(0) && designated != client);
        vm.assume(caller != client);
        uint256 id = _createFor(designated);
        vm.prank(caller);
        if (caller != designated) {
            _notDesignated(id);
            escrow.claim(id);
            assertEq(escrow.getBounty(id).agent, address(0));
        } else {
            escrow.claim(id);
            assertEq(escrow.getBounty(id).agent, designated);
        }
    }

    function testFuzz_Designated_SelfDesignationAlwaysReverts(address who) public {
        vm.assume(who != address(0));
        usdc.mint(who, REWARD);
        vm.prank(who);
        usdc.approve(address(escrow), REWARD);
        vm.prank(who);
        vm.expectRevert(BountyEscrow.InvalidDesignatedAgent.selector);
        escrow.createBounty(DESC, REWARD, deadline, who);
    }

    // ---------- (6) fuzz ----------
    function testFuzz_ClientRelease_RespectsWindow(uint256 wait) public {
        (uint256 id, uint64 claimedAt) = _claimed();
        wait = bound(wait, 0, 2 * uint256(CLAIM_WINDOW));
        vm.warp(uint256(claimedAt) + wait);
        vm.prank(client);
        if (wait < CLAIM_WINDOW) {
            vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClaimWindowNotElapsed.selector, id));
            escrow.releaseClaim(id);
            assertFalse(escrow.barredAgents(id, agent));
            assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Claimed));
        } else {
            escrow.releaseClaim(id);
            assertTrue(escrow.barredAgents(id, agent));
            assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Open));
        }
    }

    function testFuzz_AgentRelease_NeverBars(uint256 wait) public {
        (uint256 id,) = _claimed();
        wait = bound(wait, 0, 3 * uint256(CLAIM_WINDOW));
        skip(wait);
        _release(id, agent);
        assertFalse(escrow.barredAgents(id, agent));
        assertEq(uint8(_status(id)), uint8(BountyEscrow.Status.Open));
        assertEq(usdc.balanceOf(address(escrow)), REWARD);
    }

    function testFuzz_Constructor_AnyPositiveWindow(uint64 w) public {
        w = uint64(bound(w, 1, type(uint64).max));
        BountyEscrow e = new BountyEscrow(address(usdc), w);
        assertEq(e.CLAIM_WINDOW(), w);
    }

    function testFuzz_HappyFlow(uint256 reward, uint256 offset) public {
        reward = bound(reward, 1, type(uint128).max);
        offset = bound(offset, 1, 3650 days);
        uint64 dl = uint64(block.timestamp + offset);
        usdc.mint(client, reward);
        uint256 before = usdc.balanceOf(client);

        vm.prank(client);
        uint256 id = escrow.createBounty(DESC, reward, dl, address(0));
        assertEq(usdc.balanceOf(address(escrow)), reward);
        assertEq(usdc.balanceOf(client), before - reward);

        _claim(id, agent);
        _submit(id, agent, RESULT);
        vm.prank(client);
        escrow.accept(id);

        assertEq(usdc.balanceOf(agent), reward);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testFuzz_RefundOnlyAtOrAfterDeadline(uint256 reward, uint256 offset, uint256 wait) public {
        reward = bound(reward, 1, type(uint128).max);
        offset = bound(offset, 1, 3650 days);
        wait = bound(wait, 0, 4000 days);
        uint64 dl = uint64(block.timestamp + offset);
        usdc.mint(client, reward);
        uint256 before = usdc.balanceOf(client);
        vm.prank(client);
        uint256 id = escrow.createBounty(DESC, reward, dl, address(0));

        vm.warp(block.timestamp + wait);
        vm.prank(client);
        if (block.timestamp < dl) {
            vm.expectRevert(abi.encodeWithSelector(BountyEscrow.DeadlineNotReached.selector, id));
            escrow.refund(id);
            assertEq(usdc.balanceOf(address(escrow)), reward);
        } else {
            escrow.refund(id);
            assertEq(usdc.balanceOf(client), before);
            assertEq(usdc.balanceOf(address(escrow)), 0);
        }
    }

    function testFuzz_CreateRejectsNonFutureDeadline(uint64 dl) public {
        dl = uint64(bound(dl, 0, block.timestamp));
        vm.prank(client);
        vm.expectRevert(BountyEscrow.InvalidDeadline.selector);
        escrow.createBounty(DESC, REWARD, dl, address(0));
    }
}

/// @dev Drives random, bounded lifecycle actions; failed calls are swallowed.
contract BountyEscrowHandler is Test {
    BountyEscrow public escrow;
    MockUSDC public usdc;
    address[3] public clients;
    address[3] public agents;

    constructor(BountyEscrow e, MockUSDC u) {
        escrow = e;
        usdc = u;
        for (uint256 i = 0; i < 3; i++) {
            clients[i] = makeAddr(string.concat("hclient", vm.toString(i)));
            agents[i] = makeAddr(string.concat("hagent", vm.toString(i)));
            vm.prank(clients[i]);
            u.approve(address(e), type(uint256).max);
        }
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = escrow.bountyCount();
        return n == 0 ? 0 : (seed % n) + 1;
    }

    function create(uint256 cSeed, uint256 reward, uint256 offset, uint256 dSeed) external {
        address c = clients[cSeed % 3];
        reward = bound(reward, 1, 1e12);
        offset = bound(offset, 1, 10 days);
        // dSeed % 4: 0..2 -> designate that agent, 3 -> open bounty
        address designated = dSeed % 4 == 3 ? address(0) : agents[dSeed % 3];
        usdc.mint(c, reward);
        vm.prank(c);
        escrow.createBounty(
            keccak256(abi.encode(reward, offset)), reward, uint64(block.timestamp + offset), designated
        );
    }

    function claim(uint256 idSeed, uint256 aSeed) external {
        uint256 id = _id(idSeed);
        vm.prank(aSeed % 4 == 3 ? clients[aSeed % 3] : agents[aSeed % 3]);
        try escrow.claim(id) {} catch {}
    }

    function submit(uint256 idSeed, uint256 h) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        vm.prank(escrow.getBounty(id).agent);
        try escrow.submitResult(id, bytes32(h)) {} catch {}
    }

    function accept(uint256 idSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        vm.prank(escrow.getBounty(id).client);
        try escrow.accept(id) {} catch {}
    }

    function reject(uint256 idSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        vm.prank(escrow.getBounty(id).client);
        try escrow.reject(id) {} catch {}
    }

    function refund(uint256 idSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        vm.prank(escrow.getBounty(id).client);
        try escrow.refund(id) {} catch {}
    }

    /// Release as the assigned agent (anytime) or as the client (window-gated; may revert).
    function releaseClaim(uint256 idSeed, bool byClient) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        vm.prank(byClient ? b.client : b.agent);
        try escrow.releaseClaim(id) {} catch {}
    }

    function warp(uint256 secs) external {
        skip(bound(secs, 0, 4 days));
    }
}

contract BountyEscrowInvariantTest is BountyEscrowBase {
    BountyEscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new BountyEscrowHandler(escrow, usdc);
        targetContract(address(handler));
    }

    /// PROPERTY: escrow USDC == sum of rewards of non-terminal (Open/Claimed/Submitted) bounties.
    function invariant_EscrowBalanceEqualsLiveRewards() public view {
        uint256 live;
        uint256 n = escrow.bountyCount();
        for (uint256 i = 1; i <= n; i++) {
            BountyEscrow.Bounty memory b = escrow.getBounty(i);
            if (
                b.status == BountyEscrow.Status.Open || b.status == BountyEscrow.Status.Claimed
                    || b.status == BountyEscrow.Status.Submitted
            ) live += b.reward;
        }
        assertEq(usdc.balanceOf(address(escrow)), live);
    }

    /// PROPERTY: claimedAt/agent are set exactly while a claim is active, and the
    /// current agent is never barred from its own bounty.
    function invariant_ClaimFieldsConsistentWithStatus() public view {
        uint256 n = escrow.bountyCount();
        for (uint256 i = 1; i <= n; i++) {
            BountyEscrow.Bounty memory b = escrow.getBounty(i);
            if (b.status == BountyEscrow.Status.Open) {
                assertEq(b.agent, address(0));
                assertEq(b.claimedAt, 0);
                assertEq(b.resultHash, bytes32(0));
            } else if (
                b.status == BountyEscrow.Status.Claimed || b.status == BountyEscrow.Status.Submitted
            ) {
                assertTrue(b.agent != address(0));
                assertTrue(b.claimedAt != 0);
                assertFalse(escrow.barredAgents(i, b.agent));
            }
        }
    }

    /// PROPERTY: a designated agent is never the client, and any active/paid claimant of a
    /// designated bounty is that designated agent.
    function invariant_DesignationRespected() public view {
        uint256 n = escrow.bountyCount();
        for (uint256 i = 1; i <= n; i++) {
            BountyEscrow.Bounty memory b = escrow.getBounty(i);
            if (b.designatedAgent == address(0)) continue;
            assertTrue(b.designatedAgent != b.client);
            if (b.agent != address(0)) assertEq(b.agent, b.designatedAgent);
        }
    }
}
