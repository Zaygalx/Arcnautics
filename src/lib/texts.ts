import { keccak256, toBytes } from 'viem'
import type { Hex } from 'viem'

/**
 * The contract only stores hashes. The readable text behind a hash lives in this
 * browser, so a bounty posted elsewhere shows its hash until the text is known.
 */
const KEY = 'bounty-escrow-texts-v1'

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function hashText(text: string): Hex {
  return keccak256(toBytes(text.trim()))
}

/** Saves the text and returns the hash that goes onchain. */
export function rememberText(text: string): Hex {
  const hash = hashText(text)
  localStorage.setItem(KEY, JSON.stringify({ ...read(), [hash]: text.trim() }))
  return hash
}

export function lookupText(hash: string): string | undefined {
  return read()[hash]
}
