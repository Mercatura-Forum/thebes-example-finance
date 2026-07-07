import { useEffect, useRef } from 'react'
import type { CashflowBucket } from '../lib/finance-api'
import { wallDate } from '../lib/chainTime'

/**
 * Strata — the ledger's emblem: thirty days of REAL cashflow as terraced
 * sediment. Income lays emerald strata above the baseline, spending cuts red
 * strata below it, and the gold ridge walking across is the running net —
 * every step drawn from the transaction log the oracle audits. The dashed
 * bedrock line is the no-overdraft floor the contract enforces. Crisp steps,
 * not smooth curves: this is a ledger, not a mood chart. Static under
 * prefers-reduced-motion; pauses offscreen.
 */
export function Strata({ buckets, className = '' }: { buckets: CashflowBucket[]; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = host.current
    const cv = canvas.current
    if (!el || !cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dark = () => document.documentElement.classList.contains('dark')
    let raf = 0
    let running = true
    let visible = true
    let W = 0
    let H = 0

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(el)
    function resize() {
      if (!el || !cv || !ctx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = el.clientWidth; H = el.clientHeight
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
      cv.style.width = `${W}px`; cv.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const inc = buckets.map((b) => Number(b.incomeCents))
    const exp = buckets.map((b) => Number(b.expenseCents))
    let net = 0
    const nets = buckets.map((_b, i) => (net += inc[i] - exp[i]))
    const maxBar = Math.max(...inc, ...exp, 1)
    const maxNet = Math.max(...nets.map(Math.abs), 1)

    function draw(tMs: number) {
      if (!ctx || buckets.length === 0) return
      const isDark = dark()
      ctx.clearRect(0, 0, W, H)
      const padL = 8
      const padR = 8
      const baseY = H * 0.56
      const bw = (W - padL - padR) / buckets.length
      const grow = reduced ? 1 : Math.min(tMs / 900, 1)

      const ink = isDark ? 'rgba(226,232,240,' : 'rgba(14,23,38,'
      const pos = isDark ? '16,185,129' : '14,159,110'
      const neg = isDark ? '248,113,113' : '224,36,36'

      // Bedrock: the no-overdraft floor.
      const floorY = H * 0.94
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(padL, floorY)
      ctx.lineTo(W - padR, floorY)
      ctx.strokeStyle = ink + '0.35)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '600 9.5px Space Grotesk Variable, sans-serif'
      ctx.fillStyle = ink + '0.5)'
      ctx.textAlign = 'left'
      ctx.fillText('THE NO-OVERDRAFT FLOOR — enforced by the contract, not the chart', padL + 2, floorY - 5)

      // Baseline.
      ctx.beginPath()
      ctx.moveTo(padL, baseY)
      ctx.lineTo(W - padR, baseY)
      ctx.strokeStyle = ink + '0.25)'
      ctx.stroke()

      // Terraces: income up, spending down, in 3 shade steps each.
      for (let i = 0; i < buckets.length; i++) {
        const x = padL + i * bw
        const hInc = (inc[i] / maxBar) * H * 0.34 * grow
        const hExp = (exp[i] / maxBar) * H * 0.30 * grow
        for (let s = 0; s < 3; s++) {
          const frac = (3 - s) / 3
          ctx.fillStyle = `rgba(${pos},${0.16 + s * 0.14})`
          ctx.fillRect(x + 1, baseY - hInc * frac, bw - 2, hInc * frac)
          ctx.fillStyle = `rgba(${neg},${0.14 + s * 0.12})`
          ctx.fillRect(x + 1, baseY, bw - 2, hExp * frac)
        }
      }

      // The gold ridge: running net, stepped.
      ctx.beginPath()
      for (let i = 0; i < buckets.length; i++) {
        const x0 = padL + i * bw
        const y = baseY - (nets[i] / maxNet) * H * 0.3 * grow
        if (i === 0) ctx.moveTo(x0, y)
        else ctx.lineTo(x0, y)
        ctx.lineTo(x0 + bw, y)
      }
      ctx.strokeStyle = isDark ? '#fbbf24' : '#b45309'
      ctx.lineWidth = 2
      ctx.stroke()

      // First / last bucket dates.
      ctx.fillStyle = ink + '0.5)'
      ctx.font = '600 10px Space Grotesk Variable, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(label(buckets[0].bucketStartNs), padL + 2, H - 4)
      ctx.textAlign = 'right'
      ctx.fillText('today', W - padR - 2, H - 4)
    }

    function loop(t: number) {
      if (!running) return
      if (visible && !document.hidden) draw(t)
      if (t < 1200 || !reduced) raf = requestAnimationFrame(loop)
    }
    if (reduced) draw(1000)
    else raf = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
    }
  }, [buckets])

  return (
    <div ref={host} className={className} role="img"
      aria-label="Cashflow strata: thirty days of income above the line, spending below, and the running net as a stepped ridge.">
      <canvas ref={canvas} />
    </div>
  )
}

function label(ns: bigint): string {
  return wallDate(ns).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
