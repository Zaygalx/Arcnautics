import { useState } from 'react'
import { Bot, Clock, FileCheck2, User } from 'lucide-react'
import type { Address } from 'viem'
import { Status, isZero, sameAddress, shortHash } from '@/lib/escrow'
import type { Bounty } from '@/lib/escrow'
import { hashText, lookupText, rememberText } from '@/lib/texts'
import type { useEscrowActions } from '@/hooks/useEscrowActions'
import { AddressChip, Button, StatusPill, formatDuration, money } from './ui'

interface Props {
  bounty: Bounty
  me?: Address
  now: bigint
  claimWindow?: bigint
  actions: ReturnType<typeof useEscrowActions>
}

export function BountyCard({ bounty: b, me, now, claimWindow, actions }: Props) {
  const [resultText, setResultText] = useState('')
  const { busy } = actions

  const isClient = sameAddress(me, b.client)
  const isAgent = sameAddress(me, b.agent)
  const expired = now >= b.deadline
  const live = b.status === Status.Open || b.status === Status.Claimed || b.status === Status.Submitted
  const reserved = !isZero(b.designatedAgent)
  const canClaim =
    b.status === Status.Open && !expired && !isClient && (!reserved || sameAddress(me, b.designatedAgent))
  const stalled =
    b.status === Status.Claimed && claimWindow !== undefined && now >= b.claimedAt + claimWindow
  const anyBusy = busy !== null

  const description = lookupText(b.descriptionHash)
  const result = b.resultHash === `0x${'0'.repeat(64)}` ? undefined : lookupText(b.resultHash)

  const submit = async () => {
    const text = resultText.trim()
    if (!text) return
    const ok = await actions.submitResult(b.id, hashText(text))
    if (ok) {
      rememberText(text)
      setResultText('')
    }
  }

  return (
    <article className="glass rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-xs" style={{ color: 'var(--subtle)' }}>
            Bounty #{b.id.toString()}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="display text-3xl font-bold tabular-nums">{money(b.reward)}</span>
            <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>
              USDC
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusPill status={b.status} />
          {isClient && <span className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>You posted this</span>}
          {isAgent && live && <span className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>You are the agent</span>}
        </div>
      </div>

      <p className="mt-3 text-pretty text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
        {description ?? (
          <span className="mono text-xs" style={{ color: 'var(--muted)' }} title="The text behind this hash is not saved in this browser">
            {shortHash(b.descriptionHash)}
          </span>
        )}
      </p>

      <dl className="mt-4 grid gap-2 text-xs" style={{ color: 'var(--muted)' }}>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5">
            <User className="size-3.5" aria-hidden /> Client
          </dt>
          <dd><AddressChip address={b.client} /></dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5">
            <Bot className="size-3.5" aria-hidden /> Agent
          </dt>
          <dd>
            {!isZero(b.agent) ? (
              <AddressChip address={b.agent} />
            ) : reserved ? (
              <span className="flex items-center gap-1">
                Reserved for <AddressChip address={b.designatedAgent} />
              </span>
            ) : (
              <span>Open to any agent</span>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden /> Deadline
          </dt>
          <dd className="tabular-nums" style={{ color: expired && live ? 'var(--danger)' : undefined }}>
            {live ? (expired ? 'Expired' : `Closes in ${formatDuration(b.deadline - now)}`) : new Date(Number(b.deadline) * 1000).toLocaleString()}
          </dd>
        </div>
      </dl>

      {b.status === Status.Submitted && (
        <div className="inner mt-4 rounded-2xl p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color: 'var(--ink)' }}>
            <FileCheck2 className="size-3.5" aria-hidden /> Submitted result
          </div>
          <p className="text-pretty" style={{ color: 'var(--ink-2)' }}>
            {result ?? <span className="mono">{shortHash(b.resultHash)}</span>}
          </p>
        </div>
      )}

      {live && (
        <div className="mt-4 grid gap-2">
          {canClaim && (
            <Button loading={busy === `claim-${b.id}`} disabled={anyBusy} onClick={() => void actions.claim(b.id)}>
              Claim this bounty
            </Button>
          )}

          {b.status === Status.Claimed && isAgent && !expired && (
            <>
              <textarea
                value={resultText}
                onChange={(e) => setResultText(e.target.value)}
                rows={2}
                placeholder="Describe or link your result. Its hash is stored onchain."
                className="inner w-full resize-none rounded-2xl p-3 text-sm outline-none"
                aria-label="Result"
              />
              <Button loading={busy === `submit-${b.id}`} disabled={anyBusy || !resultText.trim()} onClick={() => void submit()}>
                Submit result
              </Button>
              <Button variant="ghost" loading={busy === `releaseClaim-${b.id}`} disabled={anyBusy} onClick={() => void actions.releaseClaim(b.id)}>
                Release my claim
              </Button>
            </>
          )}

          {b.status === Status.Claimed && isClient && !expired && (
            stalled ? (
              <Button variant="ghost" loading={busy === `releaseClaim-${b.id}`} disabled={anyBusy} onClick={() => void actions.releaseClaim(b.id)}>
                Release stalled claim
              </Button>
            ) : (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Waiting for the agent. You can release a stalled claim after {claimWindow !== undefined ? formatDuration(b.claimedAt + claimWindow - now) : '…'}.
              </p>
            )
          )}

          {b.status === Status.Submitted && isClient && (
            <>
              <Button loading={busy === `accept-${b.id}`} disabled={anyBusy} onClick={() => void actions.accept(b.id)}>
                Accept and pay {money(b.reward)} USDC
              </Button>
              <Button variant="danger" loading={busy === `reject-${b.id}`} disabled={anyBusy} onClick={() => void actions.reject(b.id)}>
                Reject and reopen
              </Button>
            </>
          )}

          {b.status === Status.Submitted && isAgent && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Waiting for the client to accept or reject.</p>
          )}

          {isClient && expired && (
            <Button
              variant={b.status === Status.Submitted ? 'ghost' : 'primary'}
              loading={busy === `refund-${b.id}`}
              disabled={anyBusy}
              onClick={() => void actions.refund(b.id)}
            >
              {b.status === Status.Submitted ? 'Refund instead' : 'Refund reward'}
            </Button>
          )}

          {!me && <p className="text-xs" style={{ color: 'var(--muted)' }}>Connect a wallet to act on this bounty.</p>}
          {me && b.status === Status.Open && !canClaim && !isClient && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {reserved ? 'Reserved for another agent.' : 'This bounty has expired.'}
            </p>
          )}
        </div>
      )}
    </article>
  )
}
