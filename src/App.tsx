import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { DeployKit } from '@/components/DeployKit'
import { Header } from '@/components/Header'
import { BountyBoard } from '@/components/BountyBoard'
import { PostBounty } from '@/components/PostBounty'
import { ReceiptsFeed } from '@/components/ReceiptsFeed'
import { money, useNow } from '@/components/ui'
import { useBounties, useClaimWindow } from '@/hooks/useBounties'
import { useEscrowActions } from '@/hooks/useEscrowActions'
import { useReceipts } from '@/hooks/useReceipts'
import { Status } from '@/lib/escrow'

type Tab = 'board' | 'post' | 'receipts'

const TABS: { id: Tab; label: string; mobileOnly?: boolean }[] = [
  { id: 'board', label: 'Bounties' },
  { id: 'post', label: 'Post a bounty' },
  { id: 'receipts', label: 'Receipts', mobileOnly: true },
]

export default function App() {
  const { address } = useAccount()
  const [tab, setTab] = useState<Tab>('board')
  const now = useNow()
  const { bounties, isLoading, isError } = useBounties()
  const claimWindow = useClaimWindow()
  const actions = useEscrowActions()
  const { receipts, sync, error } = useReceipts()

  const stats = useMemo(() => {
    let open = 0
    let escrow = 0n
    let paid = 0n
    for (const b of bounties) {
      if (b.status === Status.Open && now < b.deadline) open += 1
      if (b.status === Status.Open || b.status === Status.Claimed || b.status === Status.Submitted) escrow += b.reward
      if (b.status === Status.Paid) paid += b.reward
    }
    return { open, escrow, paid }
  }, [bounties, now])

  return (
    <div className="min-h-dvh px-4 pb-24 pt-8">
      <div className="mx-auto max-w-6xl">
        <Header />

        <dl className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: 'Open to claim', value: stats.open.toString(), unit: '' },
            { label: 'Held in escrow', value: money(stats.escrow), unit: 'USDC' },
            { label: 'Paid to agents', value: money(stats.paid), unit: 'USDC' },
          ].map((s) => (
            <div key={s.label} className="glass rounded-2xl p-3 sm:p-4">
              <dt className="text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
                {s.label}
              </dt>
              <dd className="display mt-1 text-xl font-bold tabular-nums sm:text-2xl">
                {isLoading ? '…' : s.value}
                {s.unit && <span className="ml-1 text-xs font-medium" style={{ color: 'var(--subtle)' }}>{s.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className={tab === 'receipts' ? 'hidden lg:block' : ''}>
            <div className="mb-4 flex gap-2" role="tablist" aria-label="Views">
              {TABS.filter((t) => !t.mobileOnly).map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className="min-h-11 flex-1 rounded-2xl text-sm font-semibold sm:flex-none sm:px-5"
                  style={{
                    background: tab === t.id ? 'var(--accent)' : 'var(--surface-strong)',
                    color: tab === t.id ? '#fff' : 'var(--ink)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {t.label}
                </button>
              ))}
              <button
                role="tab"
                aria-selected={false}
                onClick={() => setTab('receipts')}
                className="min-h-11 flex-1 rounded-2xl text-sm font-semibold lg:hidden"
                style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' }}
              >
                Receipts
              </button>
            </div>

            {tab === 'post' ? (
              <PostBounty actions={actions} onPosted={() => setTab('board')} />
            ) : (
              <BountyBoard
                bounties={bounties}
                isLoading={isLoading}
                isError={isError}
                me={address}
                claimWindow={claimWindow}
                actions={actions}
                onPost={() => setTab('post')}
              />
            )}
          </div>

          <div className={`lg:sticky lg:top-6 ${tab === 'receipts' ? '' : 'hidden lg:block'}`}>
            {tab === 'receipts' && (
              <button
                onClick={() => setTab('board')}
                className="mb-4 min-h-11 rounded-2xl px-4 text-sm font-semibold lg:hidden"
                style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' }}
              >
                Back to bounties
              </button>
            )}
            <ReceiptsFeed receipts={receipts} sync={sync} error={error} />
          </div>
        </div>

        <DeployKit />
      </div>
    </div>
  )
}
