import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@thebes/sdk'
import { FINANCE_CID, M, decodeAccounts, createAccount, seedDemo, type Account } from '../lib/finance-api'
import { Money, Button, Spinner, EmptyState, ErrorNote } from '../components/ui'

const KINDS = ['checking', 'savings', 'cash', 'credit'] as const

export function Dashboard() {
  const { data, loading, error, refetch } = useQuery<Account[]>(FINANCE_CID, M.accounts, undefined, decodeAccounts)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('checking')
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [formErr, setFormErr] = useState<string>()

  async function seed() {
    setSeeding(true); setFormErr(undefined)
    try {
      await seedDemo()
      refetch()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <Spinner label="Loading your accounts" />
  if (error) return <ErrorNote message={error} />
  const accounts = data ?? []
  const netWorth = accounts.reduce((acc, a) => acc + a.balanceCents, 0n)

  async function create() {
    setBusy(true); setFormErr(undefined)
    try {
      await createAccount(name.trim() || 'Account', kind, kind === 'credit' ? BigInt(Math.round(Number(limit || '0') * 100)) : 0n)
      setName(''); setLimit(''); setKind('checking'); setOpen(false)
      refetch()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Net-worth hero — the number first; accounts beneath (the Maybe pattern). */}
      <section className="card p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">Net worth</p>
        <p className="font-display mt-1 text-4xl font-bold md:text-5xl">
          <Money cents={netWorth} />
        </p>
        <p className="mt-1 text-sm text-ink-soft nums">{accounts.length} account{accounts.length === 1 ? '' : 's'}</p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Accounts</h2>
          <Button variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : '+ Account'}</Button>
        </div>

        {open && (
          <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto_auto]">
            <input className="rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm" placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input className="w-28 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm nums disabled:opacity-40" placeholder="credit limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={kind !== 'credit'} />
            <Button onClick={create} disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
            {formErr && <div className="sm:col-span-4"><ErrorNote message={formErr} /></div>}
          </div>
        )}

        {formErr && !open && <div className="mb-4"><ErrorNote message={formErr} /></div>}

        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            hint="Add your first account to start tracking money in and out — or load a demo set to explore."
            action={<Button onClick={seed} disabled={seeding}>{seeding ? 'Loading…' : 'Load demo data'}</Button>}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <Link key={a.id.toString()} to={`/a/${a.id}`} className="card p-4 transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(14,23,38,0.3)]">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[11px] font-medium capitalize text-ink-soft ring-1 ring-[var(--color-line)]">{a.kind}</span>
                </div>
                <p className="mt-3 truncate font-display font-semibold">{a.name}</p>
                <p className="mt-1 font-display text-2xl font-bold"><Money cents={a.balanceCents} /></p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
