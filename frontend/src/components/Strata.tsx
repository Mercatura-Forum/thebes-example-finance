import { useEffect, useRef } from 'react'

/** One posting, already merged + time-ordered across the caller's accounts. */
export interface StrataTx {
  kind: string // income | expense
  amountCents: bigint
  category: string
  transferId: bigint
}

/**
 * Strata — the ledger's emblem: the caller's REAL postings as terraced
 * sediment, one column per transaction in ledger order. Income lays emerald
 * strata above the baseline, spending cuts red strata below, transfers are
 * hatched (they conserve, never create), and the gold ridge walking across is
 * the running net — the exact sequence the oracle re-proves. The dashed
 * bedrock line is the no-overdraft floor the contract enforces. Crisp steps,
 * not smooth curves: this is a ledger, not a mood chart. Static under
 * prefers-reduced-motion; pauses offscreen.
 */
export function Strata({ txs, className = '' }: { txs: StrataTx[]; className?: string }) {
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

    const amounts = txs.map((t) => Number(t.amountCents))
    const signs = txs.map((t) => (t.kind === 'income' ? 1 : -1))
    let run = 0
    const nets = txs.map((_t, i) => (run += signs[i] * amounts[i]))
    const maxBar = Math.max(...amounts, 1)
    const maxNet = Math.max(...nets.map(Math.abs), 1)

    function draw(tMs: number) {
      if (!ctx || txs.length === 0) return
      const isDark = dark()
      ctx.clearRect(0, 0, W, H)
      const padL = 8
      const padR = 8
      const baseY = H * 0.56
      const bw = Math.min((W - padL - padR) / txs.length, 90)
      const x0all = padL + ((W - padL - padR) - bw * txs.length) / 2
      const ink = isDark ? 'rgba(226,232,240,' : 'rgba(14,23,38,'
      const pos = isDark ? '16,185,129' : '14,159,110'
      const neg = isDark ? '248,113,113' : '224,36,36'
      const act = isDark ? '124,154,255' : '48,86,211'

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

      // One stratum per posting, growing in from the left.
      const grow = reduced ? txs.length : Math.min((tMs / 140), txs.length)
      for (let i = 0; i < Math.ceil(grow); i++) {
        const x = x0all + i * bw
        const local = Math.min(grow - i, 1)
        const h = (amounts[i] / maxBar) * H * 0.32 * local
        const isTransfer = txs[i].transferId > 0n
        const color = isTransfer ? act : signs[i] > 0 ? pos : neg
        for (let s = 0; s < 3; s++) {
          const frac = (3 - s) / 3
          ctx.fillStyle = `rgba(${color},${(isTransfer ? 0.12 : 0.15) + s * 0.13})`
          if (signs[i] > 0) ctx.fillRect(x + 1.5, baseY - h * frac, bw - 3, h * frac)
          else ctx.fillRect(x + 1.5, baseY, bw - 3, h * frac)
        }
        // Category label on wider columns.
        if (bw > 46 && local === 1) {
          ctx.font = '600 9px Space Grotesk Variable, sans-serif'
          ctx.fillStyle = ink + '0.55)'
          ctx.textAlign = 'center'
          const y = signs[i] > 0 ? baseY - h - 5 : baseY + h + 11
          ctx.fillText(txs[i].category.slice(0, 12), x + bw / 2, y)
        }
      }

      // The gold ridge: running net, stepped, drawn to the growth frontier.
      ctx.beginPath()
      for (let i = 0; i < Math.min(Math.ceil(grow), txs.length); i++) {
        const x = x0all + i * bw
        const y = baseY - (nets[i] / maxNet) * H * 0.28
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        ctx.lineTo(x + bw, y)
      }
      ctx.strokeStyle = isDark ? '#fbbf24' : '#b45309'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = ink + '0.5)'
      ctx.font = '600 10px Space Grotesk Variable, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('first posting', padL + 2, H - 4)
      ctx.textAlign = 'right'
      ctx.fillText('latest', W - padR - 2, H - 4)
    }

    function loop(t: number) {
      if (!running) return
      if (visible && !document.hidden) draw(t)
      raf = requestAnimationFrame(loop)
    }
    if (reduced) draw(0)
    else raf = requestAnimationFrame(loop)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
    }
  }, [txs])

  return (
    <div ref={host} className={className} role="img"
      aria-label="Ledger strata: every posting as a column — income above the line, spending below, transfers hatched blue — with the running net as a stepped gold ridge.">
      <canvas ref={canvas} />
    </div>
  )
}
