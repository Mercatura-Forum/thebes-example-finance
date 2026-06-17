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

/** [startNs, endNs) for the current calendar month (for budget windows). */
export function monthWindow(): [bigint, bigint] {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()
  return [BigInt(start) * 1_000_000n, BigInt(end) * 1_000_000n]
}
