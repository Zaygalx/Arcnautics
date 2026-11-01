import { BadgeCheck, Bot, ExternalLink, FileCheck2, Lock, RotateCcw, Undo2, Unlink } from 'lucide-react'
import type { ComponentType } from 'react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, shortAddress } from '@/lib/escrow'
import type { Receipt, ReceiptKind, SyncState } from '@/hooks/useReceipts'
import { formatDuration, money, useNow } from './ui'

const ICONS: Record<ReceiptKind, { Icon: ComponentType<{ className?: string }>; color: string }> = {
  created: { Icon: Lock, color: 'var(--accent-hover)' },
  claimed: { Icon: Bot, color: 'var(--warn)' },
  released: { Icon: Unlink, color: 'var(--muted)' },
  submitted: { Icon: FileCheck2, color: 'var(--ink)' },
  accepted: { Icon: BadgeCheck, color: 'var(--success)' },
  rejected: { Icon: RotateCcw, color: 'var(--danger)' },
  refunded: { Icon: Undo2, color: 'var(--muted)' },
}

function describe(r: Receipt): { title: string; detail?: string } {
  const id = `#${r.bountyId.toString()}`
  const who = shortAddress(r.actor)
  switch (r.kind) {
    case 'created':
      return {
        title: `Bounty ${id} posted`,
        detail: `${who} locked ${r.amount !== undefined ? money(r.amount) : ''} USDC${
          r.designatedAgent && !/^0x0+$/.test(r.designatedAgent) ? `, reserved for ${shortAddress(r.designatedAgent)}` : ''
        }`,
      }
    case 'claimed':
      return { title: `Bounty ${id} claimed`, detail: `${who} took the job` }
    case 'released':
      return { title: `Claim on ${id} released`, detail: `${who} is no longer assigned` }
    case 'submitted':
      return { title: `Result submitted for ${id}`, detail: `${who} delivered work` }
    case 'accepted':
      return { title: `Paid ${r.amount !== undefined ? money(r.amount) : ''} USDC`, detail: `${who} was paid for bounty ${id}` }
    case 'rejected':
      return { title: `Result rejected on ${id}`, detail: `${who}'s work was declined and the bounty reopened` }
    case 'refunded':
      return { title: `Refunded ${r.amount !== undefined ? money(r.amount) : ''} USDC`, detail: `Bounty ${id} returned to ${who}` }
  }
}

interface Props {
  receipts: Receipt[]
  sync: SyncState | null
  error: boolean
}

export function ReceiptsFeed({ receipts, sync, error }: Props) {
  const now = useNow()
  const behind = sync ? sync.head - sync.scannedTo : 0n
  const syncing = !sync || behind > 50n

  return (
    <section className="glass rounded-3xl p-5" aria-label="Receipts">
      <div className="flex items-center justify-between">
        <h2 className="display text-xl font-bold">Receipts</h2>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <span
            className="size-2 rounded-full"
            style={{ background: error ? 'var(--danger)' : syncing ? 'var(--warn)' : 'var(--success)' }}
            aria-hidden
          />
          {error ? 'Reconnecting…' : syncing ? 'Syncing history' : 'Live'}
        </span>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
        Every action, read from the escrow contract's events.
      </p>

      <ol className="mt-4 grid gap-2">
        {receipts.length === 0 && (
          <li className="inner rounded-2xl p-4 text-sm" style={{ color: 'var(--muted)' }}>
            {syncing ? 'Reading events from the contract…' : 'No activity yet. Post a bounty to create the first receipt.'}
          </li>
        )}
        {receipts.slice(0, 40).map((r) => {
          const { Icon, color } = ICONS[r.kind]
          const { title, detail } = describe(r)
          return (
            <li key={r.key} className="inner flex items-start gap-3 rounded-2xl p-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--surface-muted)', color }}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold tabular-nums">{title}</div>
                {detail && <div className="text-pretty text-xs" style={{ color: 'var(--muted)' }}>{detail}</div>}
                <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums" style={{ color: 'var(--subtle)' }}>
                  <span>{r.timestamp ? `${formatDuration(now - BigInt(r.timestamp))} ago` : `Block ${r.blockNumber.toString()}`}</span>
                  <a
                    href={buildTxExplorerUrl(CHAIN_ID, r.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline"
                    style={{ color: 'var(--accent-hover)' }}
                  >
                    Transaction <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {sync && (
        <p className="mono mt-3 text-[11px] tabular-nums" style={{ color: 'var(--subtle)' }}>
          {behind > 50n
            ? `Scanned to block ${sync.scannedTo.toString()} of ${sync.head.toString()} (${behind.toString()} left)`
            : `Up to date at block ${sync.scannedTo.toString()}`}
        </p>
      )}
    </section>
  )
}
