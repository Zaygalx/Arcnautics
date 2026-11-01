import { useState } from 'react'
import type { Address } from 'viem'
import { Status, isZero, sameAddress } from '@/lib/escrow'
import type { Bounty } from '@/lib/escrow'
import type { useEscrowActions } from '@/hooks/useEscrowActions'
import { BountyCard } from './BountyCard'
import { useNow } from './ui'

type Filter = 'all' | 'open' | 'mine'

interface Props {
  bounties: Bounty[]
  isLoading: boolean
  isError: boolean
  me?: Address
  claimWindow?: bigint
  actions: ReturnType<typeof useEscrowActions>
  onPost: () => void
}

export function BountyBoard({ bounties, isLoading, isError, me, claimWindow, actions, onPost }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const now = useNow()

  const visible = bounties.filter((b) => {
    if (filter === 'open') return b.status === Status.Open && now < b.deadline
    if (filter === 'mine')
      return sameAddress(me, b.client) || sameAddress(me, b.agent) || (!isZero(b.designatedAgent) && sameAddress(me, b.designatedAgent))
    return true
  })

  return (
    <section aria-label="Bounties" className="grid gap-4">
      <div className="flex gap-2" role="tablist" aria-label="Filter bounties">
        {(['all', 'open', 'mine'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className="min-h-11 rounded-full px-4 text-sm font-semibold capitalize"
            style={{
              background: filter === f ? 'var(--accent)' : 'var(--surface-strong)',
              color: filter === f ? '#fff' : 'var(--ink)',
              border: '1px solid var(--border)',
            }}
          >
            {f === 'mine' ? 'Mine' : f === 'open' ? 'Open to claim' : 'All'}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="glass rounded-3xl p-5 text-sm" style={{ color: 'var(--muted)' }}>
          Loading bounties from Arc Testnet…
        </div>
      )}
      {isError && (
        <div className="glass rounded-3xl p-5 text-sm" style={{ color: 'var(--danger)' }}>
          Could not read the escrow contract. Retrying.
        </div>
      )}
      {!isLoading && !isError && visible.length === 0 && (
        <div className="glass rounded-3xl p-6 text-center">
          <p className="display text-lg font-semibold">
            {bounties.length === 0 ? 'No bounties yet' : filter === 'mine' ? 'Nothing here for your wallet' : 'Nothing open right now'}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-pretty text-sm" style={{ color: 'var(--muted)' }}>
            Post a bounty and lock USDC. An agent claims it, submits a result, and you decide whether to pay.
          </p>
          <button
            onClick={onPost}
            className="mt-4 min-h-11 rounded-2xl px-5 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Post a bounty
          </button>
        </div>
      )}

      {visible.map((b) => (
        <BountyCard key={b.id.toString()} bounty={b} me={me} now={now} claimWindow={claimWindow} actions={actions} />
      ))}
    </section>
  )
}
