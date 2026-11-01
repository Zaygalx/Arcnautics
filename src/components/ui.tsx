import { useEffect, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { CHAIN_ID, STATUS_LABEL, shortAddress } from '@/lib/escrow'
import type { StatusCode } from '@/lib/escrow'

/** Shows a USDC amount with at least two decimals, keeping any extra precision. */
export function money(raw: bigint): string {
  const text = formatUsdc(raw)
  if (!text.includes('.')) return `${text}.00`
  const fraction = text.split('.')[1]
  return fraction.length === 1 ? `${text}0` : text
}

/** Unix seconds, refreshed every second so countdowns stay honest. */
export function useNow(): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function formatDuration(totalSeconds: bigint): string {
  const s = Number(totalSeconds < 0n ? 0n : totalSeconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  children: ReactNode
}

export function Button({ loading, variant = 'primary', className = '', children, disabled, ...rest }: ButtonProps) {
  const styles =
    variant === 'primary'
      ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
      : variant === 'danger'
        ? { background: 'transparent', color: 'var(--danger)', border: '1px solid rgba(186,43,76,0.35)' }
        : { background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border)' }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={styles}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

const PILL: Record<StatusCode, { bg: string; fg: string }> = {
  0: { bg: 'var(--surface-muted)', fg: 'var(--muted)' },
  1: { bg: 'rgba(16,97,166,0.10)', fg: 'var(--accent-hover)' },
  2: { bg: 'rgba(154,91,0,0.12)', fg: 'var(--warn)' },
  3: { bg: 'rgba(18,45,69,0.08)', fg: 'var(--ink)' },
  4: { bg: 'rgba(26,128,71,0.12)', fg: 'var(--success)' },
  5: { bg: 'var(--surface-muted)', fg: 'var(--muted)' },
}

export function StatusPill({ status }: { status: StatusCode }) {
  const { bg, fg } = PILL[status]
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase"
      style={{ background: bg, color: fg, letterSpacing: '0.08em' }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function AddressChip({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={buildAddressExplorerUrl(CHAIN_ID, address)}
      target="_blank"
      rel="noopener noreferrer"
      className="mono inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs hover:underline"
      style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
      title={address}
    >
      {label ?? shortAddress(address)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}
