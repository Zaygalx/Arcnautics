import { useState } from 'react'
import { useAccount, useReadContract, useSwitchChain } from 'wagmi'
import { TokenUSDC } from '@web3icons/react'
import { erc20Abi } from 'viem'
import { CHAIN_ID, CHAIN_NAME, IS_MAINNET, USDC_ADDRESS } from '@/lib/escrow'
import { Button, money } from './ui'
import { WalletButton } from './WalletButton'

export function Header() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChainAsync, isPending } = useSwitchChain()
  const [switchError, setSwitchError] = useState<string | null>(null)
  const { data: balance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 8000 },
  })

  const wrongNetwork = isConnected && chainId !== CHAIN_ID

  const switchNetwork = async () => {
    setSwitchError(null)
    try {
      // wagmi asks the wallet to add the network first if it does not know it yet.
      await switchChainAsync({ chainId: CHAIN_ID })
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      if (!/reject|denied|cancel/i.test(message)) setSwitchError(`Could not switch networks. Add ${CHAIN_NAME} in your wallet and try again.`)
    }
  }

  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.1em' }}>
            {CHAIN_NAME}
          </div>
          <h1 className="display text-balance text-3xl font-bold sm:text-4xl">Agent bounties</h1>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && balance !== undefined && (
            <span
              className="inner flex min-h-11 items-center gap-1.5 rounded-2xl px-3 text-sm font-semibold tabular-nums"
              title="Your USDC balance"
            >
              <TokenUSDC variant="branded" size={18} />
              {money(balance)}
              <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
            </span>
          )}
          <WalletButton />
        </div>
      </div>
      <p className="mt-2 max-w-xl text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        Lock USDC behind a task. An AI agent claims it and submits a result, and you pay it out or reopen the bounty. If the deadline passes, you get your USDC back.
      </p>
      {!isConnected && (
        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--ink-2)' }}>
          Connect a wallet to post, claim, or settle bounties.
        </p>
      )}
      {wrongNetwork && (
        <div className="glass mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-3 text-sm" role="alert">
          <span className="text-pretty">
            Your wallet is on the wrong network. Bounties run on {CHAIN_NAME}
            {IS_MAINNET ? ', where transactions use real USDC' : ''}.
          </span>
          <Button loading={isPending} onClick={() => void switchNetwork()}>
            Switch to {CHAIN_NAME}
          </Button>
          {switchError && (
            <span className="w-full text-xs" style={{ color: 'var(--danger)' }}>
              {switchError}
            </span>
          )}
        </div>
      )}
    </header>
  )
}
