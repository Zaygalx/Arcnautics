import { useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/escrow'
import type { Bounty, StatusCode } from '@/lib/escrow'

const MAX_BOUNTIES = 60
const POLL_MS = 5000

/** Reads the newest bounties straight from the escrow contract. */
export function useBounties() {
  const count = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'bountyCount',
    chainId: CHAIN_ID,
    query: { refetchInterval: POLL_MS },
  })

  const total = Number(count.data ?? 0n)
  const ids = useMemo(
    () => Array.from({ length: Math.min(total, MAX_BOUNTIES) }, (_, i) => BigInt(total - i)),
    [total],
  )

  const rows = useReadContracts({
    contracts: ids.map((id) => ({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: 'bounties' as const,
      args: [id] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: ids.length > 0, refetchInterval: POLL_MS },
  })

  const bounties = useMemo(() => {
    const list: Bounty[] = []
    rows.data?.forEach((row, index) => {
      if (row.status !== 'success') return
      const [client, agent, designatedAgent, reward, deadline, claimedAt, descriptionHash, resultHash, status] =
        row.result
      list.push({
        id: ids[index],
        client,
        agent,
        designatedAgent,
        reward,
        deadline: BigInt(deadline),
        claimedAt: BigInt(claimedAt),
        descriptionHash,
        resultHash,
        status: status as StatusCode,
      })
    })
    return list
  }, [rows.data, ids])

  return {
    bounties,
    total,
    isLoading: count.isLoading || (ids.length > 0 && rows.isLoading),
    isError: count.isError || rows.isError,
  }
}

export function useClaimWindow() {
  const { data } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'CLAIM_WINDOW',
    chainId: CHAIN_ID,
  })
  return data !== undefined ? BigInt(data) : undefined
}
