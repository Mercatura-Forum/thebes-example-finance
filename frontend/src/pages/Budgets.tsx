import { useState } from 'react'
import { useQuery } from '@thebes/sdk'
import { FINANCE_CID, M, decodeBudgets, budgetsArgs, setBudget, type BudgetRow } from '../lib/finance-api'
import { monthWindow } from '../lib/config'
import { useCalibrated } from '../lib/useCalibrated'
import { Money, ProgressBar, Button, Spinner, EmptyState, ErrorNote } from '../components/ui'

export function Budgets() {
  // The wall→chain window is meaningless before calibration — re-derive when it lands.
  const cal = useCalibrated()
  const [start, end] = monthWindow()
  const { data, loading, error, refetch } = useQuery<BudgetRow[]>(
    FINANCE_CID, M.budgets, budgetsArgs(start, end), decodeBudgets, [cal ? 1 : 0],
  )
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()

  async function save() {
    setBusy(true); setErr(undefined)
    try {
      await setBudget(category.trim(), BigInt(Math.round(Number(limit || '0') * 100)))
      setCategory(''); setLimit('')
      refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = data ?? []
  // The window IS the current calendar month — label it from the wall clock
  // (the chain-ns window value is not an epoch timestamp).
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Budgets</h1>
        <p className="mt-1 text-sm text-ink-soft">Spending against your limits for {monthName}.</p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <input className="flex-1 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm" placeholder="category (e.g. groceries)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <input className="w-32 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm nums" placeholder="monthly limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <Button onClick={save} disabled={busy || !category.trim() || !limit}>{busy ? 'Saving…' : 'Set budget'}</Button>
        {err && <div className="w-full"><ErrorNote message={err} /></div>}
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No budgets set" hint="Set a monthly limit for a category to track your spending against it." />
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => {
            const spent = Number(b.spentCents)
            const lim = Number(b.limitCents)
            const over = spent > lim
            return (
              <li key={b.category} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium capitalize">{b.category}</span>
                  <span className="text-sm nums">
                    <Money cents={b.spentCents} className={over ? 'neg' : ''} />
                    <span className="text-ink-soft"> / </span>
                    <Money cents={b.limitCents} />
                  </span>
                </div>
                <div className="mt-2"><ProgressBar value={spent} max={lim} /></div>
                {over && <p className="mt-1 text-xs neg">Over budget by <Money cents={b.spentCents - b.limitCents} /></p>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
