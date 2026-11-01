import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi'
import { useModal } from 'connectkit'
import { Check, ChevronDown, Copy, ExternalLink, LogOut, QrCode, Wallet, X } from 'lucide-react'
import type { Connector } from 'wagmi'
import { UserRejectedRequestError } from 'viem'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, shortAddress } from '@/lib/escrow'
import { walletConnectProjectId } from '@/config'
import { Button } from './ui'

function WalletIcon({ connector }: { connector?: Pick<Connector, 'icon' | 'name'> }) {
  return connector?.icon ? (
    <img src={connector.icon} alt="" className="size-8 rounded-lg" />
  ) : (
    <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: 'var(--surface-muted)' }}>
      <Wallet className="size-4" aria-hidden />
    </span>
  )
}

function ConnectSheet({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors()
  const { connectAsync } = useConnect()
  const { setOpen } = useModal()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Wallets that announced themselves through EIP-6963 have their own id (their reverse-DNS name).
  const announced = connectors.filter((c) => c.type === 'injected' && c.id !== 'injected')
  const generic = connectors.find((c) => c.id === 'injected')
  const hasWindowEthereum = typeof window !== 'undefined' && 'ethereum' in window
  // window.ethereum is only offered separately when no wallet announced itself, so one wallet never shows twice.
  const showGeneric = announced.length === 0 && hasWindowEthereum && !!generic

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const connectWith = async (connector: Connector) => {
    setError(null)
    setPending(connector.uid)
    try {
      await connectAsync({ connector })
      onClose()
    } catch (e) {
      const rejected = e instanceof Error && (e instanceof UserRejectedRequestError || /reject|denied|cancel/i.test(e.message))
      if (!rejected) setError(e instanceof Error ? e.message.split('\n')[0] : 'Could not connect to that wallet.')
    } finally {
      setPending(null)
    }
  }

  const openWalletConnect = () => {
    onClose()
    setOpen(true)
  }

  return (
    <motion.div
      className="fixed inset-0 z-[10000] flex items-end justify-center sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="Connect wallet"
        className="relative w-full max-w-md rounded-t-3xl p-5 sm:rounded-3xl"
        style={{ background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(40px) saturate(200%)', border: '1px solid var(--border)' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="display text-xl font-bold">Connect wallet</h2>
          <button onClick={onClose} aria-label="Close" className="flex size-11 items-center justify-center rounded-full">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          {announced.map((c) => (
            <button
              key={c.uid}
              onClick={() => void connectWith(c)}
              disabled={pending !== null}
              className="inner flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left disabled:opacity-50"
            >
              <WalletIcon connector={c} />
              <span className="flex-1 text-sm font-semibold">{c.name}</span>
              <span className="text-xs" style={{ color: 'var(--success)' }}>
                {pending === c.uid ? 'Check your wallet…' : 'Detected'}
              </span>
            </button>
          ))}

          {showGeneric && generic && (
            <button
              onClick={() => void connectWith(generic)}
              disabled={pending !== null}
              className="inner flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left disabled:opacity-50"
            >
              <WalletIcon />
              <span className="flex-1 text-sm font-semibold">Browser wallet</span>
              <span className="text-xs" style={{ color: 'var(--success)' }}>
                {pending === generic.uid ? 'Check your wallet…' : 'Detected'}
              </span>
            </button>
          )}

          {announced.length === 0 && !showGeneric && (
            <div className="inner rounded-2xl p-4 text-sm" style={{ color: 'var(--ink-2)' }}>
              <p className="font-semibold">No browser wallet found</p>
              <p className="mt-1 text-pretty text-xs" style={{ color: 'var(--muted)' }}>
                Install a wallet extension, or open this page inside your wallet's browser. If you are using a wallet's built-in
                browser and it does not appear, use WalletConnect below.
              </p>
            </div>
          )}

          <button
            onClick={openWalletConnect}
            disabled={!walletConnectProjectId || pending !== null}
            className="inner flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left disabled:opacity-60"
          >
            <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: 'var(--surface-muted)' }}>
              <QrCode className="size-4" aria-hidden />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">WalletConnect</span>
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                {walletConnectProjectId ? 'Scan with a mobile wallet' : 'Not set up for this app yet'}
              </span>
            </span>
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-pretty text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
      </motion.section>
    </motion.div>
  )
}

function AccountMenu() {
  const { address, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!address) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inner flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm font-semibold"
      >
        {connector?.icon ? <img src={connector.icon} alt="" className="size-5 rounded" /> : <Wallet className="size-4" aria-hidden />}
        <span className="mono text-xs tabular-nums">{shortAddress(address)}</span>
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 z-50 mt-2 w-72 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.97)' }}>
          <div className="text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
            Connected{connector ? ` with ${connector.name}` : ''}
          </div>
          <div className="mono mt-1 break-all text-xs">{address}</div>
          <div className="mt-3 grid gap-1">
            <button role="menuitem" onClick={() => void copy()} className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-black/5">
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy address'}
            </button>
            <a
              role="menuitem"
              href={buildAddressExplorerUrl(CHAIN_ID, address)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-black/5"
            >
              <ExternalLink className="size-4" aria-hidden /> View on explorer
            </a>
            <button
              role="menuitem"
              onClick={() => {
                disconnect()
                setOpen(false)
              }}
              className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm hover:bg-black/5"
              style={{ color: 'var(--danger)' }}
            >
              <LogOut className="size-4" aria-hidden /> Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Connect button when disconnected, account menu when connected. */
export function WalletButton({ className = '' }: { className?: string }) {
  const { isConnected, isConnecting, isReconnecting } = useAccount()
  const [open, setOpen] = useState(false)

  if (isConnected) return <AccountMenu />

  return (
    <>
      <Button className={className} loading={isConnecting || isReconnecting} onClick={() => setOpen(true)}>
        <Wallet className="size-4" aria-hidden />
        Connect wallet
      </Button>
      {createPortal(
        <AnimatePresence>{open && <ConnectSheet onClose={() => setOpen(false)} />}</AnimatePresence>,
        document.body,
      )}
    </>
  )
}
