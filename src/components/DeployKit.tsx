import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { keccak256 } from 'viem'
import type { Hex } from 'viem'
import { deployKit } from '@/generated/deployKit'
import { Button } from './ui'

const bytecode = deployKit.bytecode as Hex
// Every figure below is computed from the exact text shown in the box, so it always matches what you copy.
const byteLength = (bytecode.length - 2) / 2
const hash = keccak256(bytecode)
const withoutMetadata = bytecode.slice(0, bytecode.length - deployKit.metadataBytes * 2) as Hex
const hashWithoutMetadata = keccak256(withoutMetadata)

function CopyBlock({ label, value, rows }: { label: string; value: string; rows: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    ref.current?.focus()
    ref.current?.select()
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be blocked inside a frame. The text stays selected so you can copy it by hand.
      setCopied(false)
    }
  }

  return (
    <div className="mt-3">
      <textarea
        ref={ref}
        readOnly
        value={value}
        rows={rows}
        wrap="soft"
        spellCheck={false}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="inner mono w-full resize-y break-all rounded-2xl p-3 text-[11px] outline-none"
      />
      <Button className="mt-2" onClick={() => void copy()}>
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      </Button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
      <dt style={{ color: 'var(--muted)' }}>{label}</dt>
      <dd className="mono break-all text-xs tabular-nums">{value}</dd>
    </div>
  )
}

/** Temporary helper for deploying from your own wallet. Safe to delete: only App.tsx imports it. */
export function DeployKit() {
  return (
    <details className="glass mt-8 rounded-3xl p-5">
      <summary className="display cursor-pointer text-lg font-bold">Mainnet deploy kit</summary>

      <h3 className="mt-5 text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        1. Creation bytecode
      </h3>
      <p className="mt-1 text-pretty text-xs" style={{ color: 'var(--muted)' }}>
        Compiled creation code of BountyEscrow, without constructor arguments. The deployment tool appends them: usdc
        0x3600000000000000000000000000000000000000 and claim window 3600.
      </p>
      <CopyBlock label="Creation bytecode" value={bytecode} rows={8} />

      <h3 className="mt-6 text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        2. Build settings
      </h3>
      <dl className="mt-1">
        <Row label="Compiler" value={`solc ${deployKit.compiler}`} />
        <Row label="Optimizer" value={deployKit.optimizerEnabled ? 'enabled' : 'disabled'} />
        <Row label="Optimizer runs" value={String(deployKit.optimizerRuns)} />
        <Row label="EVM version" value={deployKit.evmVersion} />
      </dl>

      <h3 className="mt-6 text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        3 and 4. Length and hash
      </h3>
      <dl className="mt-1">
        <Row label="Length in bytes" value={byteLength.toLocaleString('en-US')} />
        <Row label="Length as hex characters (after 0x)" value={(bytecode.length - 2).toLocaleString('en-US')} />
        <Row label="keccak256 of the raw bytes" value={hash} />
        <Row
          label={`keccak256 without the final ${deployKit.metadataBytes} metadata bytes`}
          value={hashWithoutMetadata}
        />
      </dl>
      <p className="mt-2 text-pretty text-xs" style={{ color: 'var(--muted)' }}>
        The last {deployKit.metadataBytes} bytes are a compiler metadata stamp that depends on the file layout. If you compile the
        source below yourself, expect the second hash to match exactly and the first to differ only in that tail.
      </p>

      <h3 className="mt-6 text-xs font-semibold uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
        5. Solidity source (flattened, OpenZeppelin included)
      </h3>
      <p className="mt-1 text-pretty text-xs" style={{ color: 'var(--muted)' }}>
        One self-contained file. Compile it with the settings in section 2 and deploy the BountyEscrow contract.
      </p>
      <CopyBlock label="Solidity source" value={deployKit.flattenedSource} rows={16} />
    </details>
  )
}
