import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { fmtCents } from '../lib/config'

/** Money: tabular, sign-encoded by COLOUR + glyph (never colour alone — a11y).
 *  `signed` shows an explicit +/− (for tx amounts); otherwise just the value
 *  with a minus when negative (for balances). */
export function Money({ cents, signed = false, className = '' }: { cents: bigint; signed?: boolean; className?: string }) {
  const neg = cents < 0n
  const cls = neg ? 'neg' : signed ? 'pos' : ''
  const glyph = signed ? (neg ? '−' : '+') : neg ? '−' : ''
  const abs = neg ? -cents : cents
  return <span className={`nums ${cls} ${className}`}>{glyph}{fmtCents(abs).replace('−', '')}</span>
}

/** A tiny deterministic SVG sparkline over a series (no chart dependency). */
export function Sparkline({ points, width = 120, height = 32, color = 'var(--color-act)' }: { points: number[]; width?: number; height?: number; color?: string }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden />
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((p - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Budget progress — green under limit, red over. Width capped at 100%. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max <= 0 ? 0 : Math.min(100, (value / max) * 100)
  const over = value > max
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: over ? 'var(--color-neg)' : 'var(--color-pos)' }} />
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }
export function Button({ variant = 'primary', className = '', ...props }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed'
  const styles: Record<string, string> = {
    primary: 'bg-[var(--color-act)] text-white hover:brightness-110 active:brightness-95',
    ghost: 'bg-transparent text-ink ring-1 ring-[var(--color-line)] hover:bg-[var(--color-paper)]',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-soft text-sm" role="status">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-line)] border-t-[var(--color-act)]" />
      {label}…
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="card p-10 text-center border-dashed">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{hint}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg bg-[var(--color-neg)]/8 px-3 py-2 text-sm neg">{message}</p>
}
