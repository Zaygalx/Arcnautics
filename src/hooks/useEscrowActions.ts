import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { erc20Abi } from 'viem'
import type { Address, Hex } from 'viem'
import { toast } from 'sonner'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS, describeError, escrowAbi } from '@/lib/escrow'

/** Every wallet action in the app. `busy` holds the key of the action in flight. */
export function useEscrowActions() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, label: string, send: () => Promise<Hex>): Promise<boolean> => {
      setBusy(key)
      let toastId: string | number | undefined
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        const hash = await send()
        toastId = toast.loading(`${label}…`)
        const receipt = await publicClient?.waitForTransactionReceipt({ hash })
        if (receipt?.status !== 'success') throw new Error('The transaction reverted onchain.')
        const url = buildTxExplorerUrl(CHAIN_ID, hash)
        toast.success(`${label} confirmed`, {
          id: toastId,
          action: url ? { label: 'View', onClick: () => window.open(url, '_blank', 'noopener,noreferrer') } : undefined,
        })
        await queryClient.invalidateQueries()
        return true
      } catch (error) {
        const message = describeError(error)
        if (toastId !== undefined) toast.dismiss(toastId)
        if (message) toast.error(message)
        return false
      } finally {
        setBusy(null)
      }
    },
    [chainId, switchChainAsync, publicClient, queryClient],
  )

  const call = useCallback(
    (functionName: 'claim' | 'releaseClaim' | 'accept' | 'reject' | 'refund', id: bigint, label: string) =>
      run(`${functionName}-${id}`, label, () =>
        writeContractAsync({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName,
          args: [id],
          chainId: CHAIN_ID,
        }),
      ),
    [run, writeContractAsync],
  )

  const approve = useCallback(
    (amount: bigint) =>
      run('approve', 'USDC allowance', () =>
        writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ESCROW_ADDRESS, amount],
          chainId: CHAIN_ID,
        }),
      ),
    [run, writeContractAsync],
  )

  const createBounty = useCallback(
    (descriptionHash: Hex, reward: bigint, deadline: bigint, designatedAgent: Address) =>
      run('create', 'Bounty posted', () =>
        writeContractAsync({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: 'createBounty',
          args: [descriptionHash, reward, deadline, designatedAgent],
          chainId: CHAIN_ID,
        }),
      ),
    [run, writeContractAsync],
  )

  const submitResult = useCallback(
    (id: bigint, resultHash: Hex) =>
      run(`submit-${id}`, 'Result submitted', () =>
        writeContractAsync({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: 'submitResult',
          args: [id, resultHash],
          chainId: CHAIN_ID,
        }),
      ),
    [run, writeContractAsync],
  )

  return {
    busy,
    approve,
    createBounty,
    submitResult,
    claim: (id: bigint) => call('claim', id, 'Bounty claimed'),
    releaseClaim: (id: bigint) => call('releaseClaim', id, 'Claim released'),
    accept: (id: bigint) => call('accept', id, 'Agent paid'),
    reject: (id: bigint) => call('reject', id, 'Result rejected'),
    refund: (id: bigint) => call('refund', id, 'Reward refunded'),
  }
}
