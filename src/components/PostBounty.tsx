import { useMemo, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi, isAddress } from 'viem'
import type { Address } from 'viem'
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS, ZERO_ADDRESS, sameAddress } from '@/lib/escrow'
import { rememberText } from '@/lib/texts'
import { AmountError, parseAmount } from '@/onchain-money'
import type { Amount } from '@/onchain-money'
import type { useEscrowActions } from '@/hooks/useEscrowActions'
import { Button, money } from './ui'
import { WalletButton } from './WalletButton'

const DURATIONS = [
  { label: '15 min', seconds: 15 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
  { label: '24 hours', seconds: 24 * 60 * 60 },
  { label: '7 days', seconds: 7 * 24 * 60 * 60 },
] as const

interface Props {
  actions: ReturnType<typeof useEscrowActions>
  onPosted: () => void
}

export function PostBounty({ actions, onPosted }: Props) {
  const { address } = useAccount()
  const [description, setDescription] = useState('')
  const [reward, setReward] = useState('')
  const [duration, setDuration] = useState<number>(DURATIONS[2].seconds)
  const [agent, setAgent] = useState('')

  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 8000 },
  })
  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, ESCROW_ADDRESS] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 8000 },
  })

  const amount = useMemo<Amount | null>(() => {
    if (!reward) return null
    try {
      return parseAmount(CHAIN_ID, reward)
    } catch (error) {
      if (error instanceof AmountError) return null
      throw error
    }
  }, [reward])

  const agentTrimmed = agent.trim()
  const agentValid = agentTrimmed === '' || isAddress(agentTrimmed)
  const agentIsMe = agentTrimmed !== '' && sameAddress(agentTrimmed, address)
  const positive = !!amount && amount.isPositive()
  const enoughBalance = !positive || balance.data === undefined || balance.data >= amount.raw
  const needsApproval = positive && allowance.data !== undefined && allowance.data < amount.raw
  const formReady = description.trim().length > 0 && positive && agentValid && !agentIsMe && enoughBalance
  const anyBusy = actions.busy !== null

  const submit = async () => {
    if (!amount) return
    if (needsApproval) {
      await actions.approve(amount.raw)
      return
    }
    const text = description.trim()
    const hash = rememberText(text)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + duration)
    const designated: Address = agentTrimmed === '' ? ZERO_ADDRESS : (agentTrimmed as Address)
    const ok = await actions.createBounty(hash, amount.raw, deadline, designated)
    if (ok) {
      setDescription('')
      setReward('')
      setAgent('')
      onPosted()
    }
  }

  const label = needsApproval ? `Allow ${reward} USDC` : 'Post bounty and lock USDC'
  const busyKey = needsApproval ? 'approve' : 'create'

  return (
    <section className="glass rounded-3xl p-5">
      <h2 className="display text-xl font-bold">Post a bounty</h2>
      <p className="mt-1 text-pretty text-sm" style={{ color: 'var(--muted)' }}>
        The reward is locked in escrow until you accept the result or the deadline passes.
      </p>

      <label className="mt-5 block text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        Task
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What should the agent deliver?"
          className="inner mt-2 w-full resize-none rounded-2xl p-3 text-sm font-normal normal-case outline-none"
          style={{ letterSpacing: 0, color: 'var(--ink)' }}
        />
      </label>

      <div className="inner mt-4 rounded-2xl p-4">
        <div className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
          Reward
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <input
            inputMode="decimal"
            value={reward}
            onChange={(e) => {
              const v = e.target.value
              if (v === '' || /^\d*\.?\d*$/.test(v)) setReward(v)
            }}
            placeholder="0.00"
            aria-label="Reward in USDC"
            className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-300"
          />
          <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
        </div>
        <div className="mt-2 text-xs tabular-nums" style={{ color: enoughBalance ? 'var(--subtle)' : 'var(--danger)' }}>
          {!address
            ? 'Connect a wallet to see your balance'
            : balance.data === undefined
              ? 'Loading balance…'
              : enoughBalance
                ? `Balance: ${money(balance.data)} USDC`
                : `Not enough USDC. You have ${money(balance.data)}.`}
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
          Deadline
        </legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.seconds}
              type="button"
              onClick={() => setDuration(d.seconds)}
              aria-pressed={duration === d.seconds}
              className="min-h-11 rounded-xl text-xs font-semibold"
              style={{
                background: duration === d.seconds ? 'var(--accent)' : 'var(--surface-strong)',
                color: duration === d.seconds ? '#fff' : 'var(--ink)',
                border: '1px solid var(--border)',
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        Reserve for an agent (optional)
        <input
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="0x… leave empty to open it to any agent"
          spellCheck={false}
          className="inner mono mt-2 w-full rounded-2xl p-3 text-xs font-normal normal-case outline-none"
          style={{ letterSpacing: 0, color: 'var(--ink)' }}
        />
        {!agentValid && <span className="mt-1 block text-xs normal-case" style={{ color: 'var(--danger)', letterSpacing: 0 }}>Enter a valid address.</span>}
        {agentIsMe && <span className="mt-1 block text-xs normal-case" style={{ color: 'var(--danger)', letterSpacing: 0 }}>You cannot reserve a bounty for yourself.</span>}
      </label>

      <div className="mt-5">
        {address ? (
          <Button className="w-full" loading={actions.busy === busyKey} disabled={!formReady || anyBusy} onClick={() => void submit()}>
            {label}
          </Button>
        ) : (
          <WalletButton className="w-full" />
        )}
        {needsApproval && address && (
          <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
            Step 1 of 2: allow the escrow to hold this amount. Then post the bounty.
          </p>
        )}
      </div>
    </section>
  )
}
