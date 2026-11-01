import { useEffect, useRef, useState } from 'react'
import { usePublicClient } from 'wagmi'
import type { Address, Hex } from 'viem'
import { CHAIN_ID, DEPLOY_BLOCK, ESCROW_ADDRESS, escrowEventsAbi } from '@/lib/escrow'

export type ReceiptKind = 'created' | 'claimed' | 'released' | 'submitted' | 'accepted' | 'rejected' | 'refunded'

export interface Receipt {
  key: string
  kind: ReceiptKind
  bountyId: bigint
  /** The address the event is about: client, agent, or the party who released. */
  actor: Address
  /** Reward in USDC base units when the event carries one. */
  amount?: bigint
  hash?: Hex
  designatedAgent?: Address
  txHash: Hex
  blockNumber: bigint
  logIndex: number
  timestamp?: number
}

export interface SyncState {
  scannedTo: bigint
  head: bigint
}

const POLL_MS = 4000
const START_CHUNK = 10_000n
const MIN_CHUNK = 250n

/**
 * Builds the receipts feed from the escrow's own events. Scans forward from the
 * deployment block in bounded ranges, shrinking the range if the RPC refuses one,
 * and keeps polling the head so new events show up on their own.
 */
export function useReceipts() {
  const client = usePublicClient({ chainId: CHAIN_ID })
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [sync, setSync] = useState<SyncState | null>(null)
  const [error, setError] = useState(false)
  const nextBlock = useRef(DEPLOY_BLOCK)
  const chunk = useRef(START_CHUNK)
  const seen = useRef(new Set<string>())
  const times = useRef(new Map<bigint, number>())

  useEffect(() => {
    if (!client) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const scan = async () => {
      try {
        const head = await client.getBlockNumber()
        const fresh: Receipt[] = []

        while (!cancelled && nextBlock.current <= head) {
          const from = nextBlock.current
          const to = from + chunk.current - 1n > head ? head : from + chunk.current - 1n
          let logs
          try {
            logs = await client.getLogs({ address: ESCROW_ADDRESS, events: escrowEventsAbi, fromBlock: from, toBlock: to })
          } catch (rangeError) {
            if (chunk.current <= MIN_CHUNK) throw rangeError
            chunk.current = chunk.current / 2n
            continue
          }

          for (const log of logs) {
            if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) continue
            const key = `${log.transactionHash}-${log.logIndex}`
            if (seen.current.has(key)) continue
            seen.current.add(key)
            const base = {
              key,
              bountyId: log.args.id as bigint,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
            }
            switch (log.eventName) {
              case 'BountyCreated':
                fresh.push({ ...base, kind: 'created', actor: log.args.client as Address, amount: log.args.reward, hash: log.args.descriptionHash, designatedAgent: log.args.designatedAgent })
                break
              case 'BountyClaimed':
                fresh.push({ ...base, kind: 'claimed', actor: log.args.agent as Address })
                break
              case 'ClaimReleased':
                fresh.push({ ...base, kind: 'released', actor: log.args.agent as Address })
                break
              case 'ResultSubmitted':
                fresh.push({ ...base, kind: 'submitted', actor: log.args.agent as Address, hash: log.args.resultHash })
                break
              case 'BountyAccepted':
                fresh.push({ ...base, kind: 'accepted', actor: log.args.agent as Address, amount: log.args.reward })
                break
              case 'BountyRejected':
                fresh.push({ ...base, kind: 'rejected', actor: log.args.agent as Address, hash: log.args.resultHash })
                break
              case 'BountyRefunded':
                fresh.push({ ...base, kind: 'refunded', actor: log.args.client as Address, amount: log.args.reward })
                break
            }
          }
          nextBlock.current = to + 1n
          if (!cancelled) setSync({ scannedTo: to, head })
        }

        const blocks = [...new Set(fresh.map((r) => r.blockNumber))].filter((b) => !times.current.has(b))
        await Promise.all(
          blocks.map(async (blockNumber) => {
            const block = await client.getBlock({ blockNumber })
            times.current.set(blockNumber, Number(block.timestamp))
          }),
        )

        // Applied even after cancellation: these events are already marked seen, so dropping them would lose them.
        if (fresh.length > 0) {
          setReceipts((prev) =>
            [...prev, ...fresh.map((r) => ({ ...r, timestamp: times.current.get(r.blockNumber) }))].sort((a, b) =>
              a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1,
            ),
          )
        }
        if (!cancelled) setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) timer = setTimeout(() => void scan(), POLL_MS)
      }
    }

    void scan()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [client])

  return { receipts, sync, error }
}
