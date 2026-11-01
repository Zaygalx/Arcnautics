import { BaseError, ContractFunctionRevertedError, parseAbi, UserRejectedRequestError } from 'viem'
import type { Address, Hex } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'

/**
 * The app runs on Arc mainnet only when a mainnet escrow address and its deploy block are both
 * configured. Until then it stays on Arc Testnet, where the escrow is deployed.
 */
const mainnetAddress = import.meta.env.VITE_BOUNTY_ESCROW_ADDRESS_MAINNET
const mainnetBlock = import.meta.env.VITE_BOUNTY_ESCROW_DEPLOY_BLOCK_MAINNET
export const IS_MAINNET = Boolean(mainnetAddress && mainnetBlock)

export const CHAIN_ID = IS_MAINNET ? arc.id : arcTestnet.id
export const CHAIN_NAME = IS_MAINNET ? 'Arc mainnet' : 'Arc Testnet'

export const ESCROW_ADDRESS = (IS_MAINNET
  ? mainnetAddress
  : import.meta.env.VITE_BOUNTY_ESCROW_ADDRESS) as Address
/** Block the escrow was deployed at; event scanning starts here, never at block 0. */
export const DEPLOY_BLOCK = BigInt(
  (IS_MAINNET ? mainnetBlock : import.meta.env.VITE_BOUNTY_ESCROW_DEPLOY_BLOCK) as string,
)

const usdc = getUsdc(CHAIN_ID)
if (!usdc) throw new Error('USDC is not available on Arc Testnet in the onchain facts')
export const USDC_ADDRESS = usdc.address as Address

const functionsAbi = parseAbi([
  'function CLAIM_WINDOW() view returns (uint64)',
  'function bountyCount() view returns (uint256)',
  'function bounties(uint256 id) view returns (address client, address agent, address designatedAgent, uint256 reward, uint64 deadline, uint64 claimedAt, bytes32 descriptionHash, bytes32 resultHash, uint8 status)',
  'function createBounty(bytes32 descriptionHash, uint256 reward, uint64 deadline, address designatedAgent) returns (uint256 id)',
  'function claim(uint256 id)',
  'function releaseClaim(uint256 id)',
  'function submitResult(uint256 id, bytes32 resultHash)',
  'function accept(uint256 id)',
  'function reject(uint256 id)',
  'function refund(uint256 id)',
])

export const escrowEventsAbi = parseAbi([
  'event BountyCreated(uint256 indexed id, address indexed client, bytes32 descriptionHash, uint256 reward, uint64 deadline, address designatedAgent)',
  'event BountyClaimed(uint256 indexed id, address indexed agent)',
  'event ClaimReleased(uint256 indexed id, address indexed agent, address indexed releasedBy)',
  'event ResultSubmitted(uint256 indexed id, address indexed agent, bytes32 resultHash)',
  'event BountyAccepted(uint256 indexed id, address indexed agent, uint256 reward)',
  'event BountyRejected(uint256 indexed id, address indexed agent, bytes32 resultHash)',
  'event BountyRefunded(uint256 indexed id, address indexed client, uint256 reward)',
])

const errorsAbi = parseAbi([
  'error InvalidReward()',
  'error InvalidDescriptionHash()',
  'error InvalidResultHash()',
  'error InvalidDeadline()',
  'error BountyNotFound(uint256 id)',
  'error InvalidStatus(uint256 id, uint8 actual)',
  'error OnlyClient(uint256 id)',
  'error OnlyAgent(uint256 id)',
  'error ClientCannotClaim(uint256 id)',
  'error DeadlineReached(uint256 id)',
  'error DeadlineNotReached(uint256 id)',
  'error AgentBarred(uint256 id, address agent)',
  'error ClaimWindowNotElapsed(uint256 id)',
  'error InvalidDesignatedAgent()',
  'error NotDesignatedAgent(uint256 id)',
])

export const escrowAbi = [...functionsAbi, ...escrowEventsAbi, ...errorsAbi] as const

export const Status = {
  None: 0,
  Open: 1,
  Claimed: 2,
  Submitted: 3,
  Paid: 4,
  Refunded: 5,
} as const
export type StatusCode = (typeof Status)[keyof typeof Status]

export const STATUS_LABEL: Record<StatusCode, string> = {
  0: 'Unknown',
  1: 'Open',
  2: 'Claimed',
  3: 'Submitted',
  4: 'Paid',
  5: 'Refunded',
}

export interface Bounty {
  id: bigint
  client: Address
  agent: Address
  designatedAgent: Address
  reward: bigint
  deadline: bigint
  claimedAt: bigint
  descriptionHash: Hex
  resultHash: Hex
  status: StatusCode
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

export const isZero = (address: Address) => address === ZERO_ADDRESS

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
export const shortHash = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`

export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const REVERT_COPY: Record<string, string> = {
  InvalidReward: 'The reward must be more than zero.',
  InvalidDescriptionHash: 'The description is empty.',
  InvalidResultHash: 'The result is empty.',
  InvalidDeadline: 'The deadline must be in the future.',
  BountyNotFound: 'That bounty does not exist.',
  InvalidStatus: 'This bounty is not in the right state for that action.',
  OnlyClient: 'Only the client who posted this bounty can do that.',
  OnlyAgent: 'Only the agent who claimed this bounty can do that.',
  ClientCannotClaim: 'You posted this bounty, so you cannot claim it. Use a different wallet.',
  DeadlineReached: 'The deadline has passed.',
  DeadlineNotReached: 'The deadline has not passed yet.',
  AgentBarred: 'You were released from this bounty and cannot claim it again.',
  ClaimWindowNotElapsed: 'The claim window has not elapsed yet.',
  InvalidDesignatedAgent: 'You cannot name yourself as the agent.',
  NotDesignatedAgent: 'This bounty is reserved for a different agent.',
}

/** Turns a wallet or contract failure into one plain sentence. Returns null when the user cancelled. */
export function describeError(error: unknown): string | null {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return null
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
      return REVERT_COPY[reverted.data.errorName] ?? `The contract rejected the call (${reverted.data.errorName}).`
    }
    const message = error.shortMessage.toLowerCase()
    if (message.includes('user rejected') || message.includes('denied')) return null
    if (message.includes('insufficient funds')) return 'Not enough USDC to pay for gas.'
    return error.shortMessage
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}
