/**
 * Contract ids — injected at deploy via window globals; fallback 0 until then
 * (finance.mo is built but not yet deployed, so its cid is assigned at deploy).
 */
declare global {
  interface Window {
    FINANCE_CID?: number
    MEDIA_CID?: number
  }
}

export const FINANCE_CID: number =
  (typeof window !== 'undefined' && window.FINANCE_CID) || 0

export const MEDIA_CID: number =
  (typeof window !== 'undefined' && window.MEDIA_CID) || 0

/** Format integer cents → grouped 2-decimal string, with a leading minus. */
export function fmtCents(cents: bigint): string {
  const neg = cents < 0n
  const v = neg ? -cents : cents
  const whole = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = (v % 100n).toString().padStart(2, '0')
  return `${neg ? '−' : ''}${whole}.${frac}`
}

import { toChainNs } from './chainTime'

/** [startNs, endNs) for the current calendar month, in CHAIN time — the chain
 *  counts ns since genesis, so wall-epoch windows would never match. */
export function monthWindow(): [bigint, bigint] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  return [toChainNs(start), toChainNs(end)]
}

/** [startNs, endNs) for the trailing `days` days, in chain time. */
export function trailingWindow(days: number): [bigint, bigint] {
  const end = Date.now()
  return [toChainNs(end - days * 86_400_000), toChainNs(end)]
}
