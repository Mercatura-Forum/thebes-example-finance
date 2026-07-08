import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMediaUpload } from '@thebes/sdk'
import {
  FINANCE_CID, M, decodeAccounts, decodeTxs, decodeCheck,
  txsArgs, checkArgs, postTransaction, transfer,
  type Account as Acct, type Tx, type BalanceCheck,
} from '../lib/finance-api'
import { MEDIA_CID } from '../lib/config'
import { wallDate } from '../lib/chainTime'
import { MediaImage } from '../components/MediaImage'
import { Money, Sparkline, Button, Spinner, EmptyState, ErrorNote } from '../components/ui'

function when(ns: bigint): string {
  // Chain timestamps count from genesis — convert through the calibrated clock.
  return wallDate(ns).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AccountPage() {
  const { id } = useParams()
  const accountId = BigInt(id ?? '0')
  const accounts = useQuery<Acct[]>(FINANCE_CID, M.accounts, undefined, decodeAccounts)
  const txs = useQuery<Tx[]>(FINANCE_CID, M.txs, txsArgs(accountId), decodeTxs, [id])
  const check = useQuery<BalanceCheck | undefined>(FINANCE_CID, M.check, checkArgs(accountId), decodeCheck, [id])

  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [xferTo, setXferTo] = useState('')
  const [xferAmt, setXferAmt] = useState('')
  const [err, setErr] = useState<string>()
  const media = useMediaUpload(MEDIA_CID)

  const account = (accounts.data ?? []).find((a) => a.id === accountId)
  const list = txs.data ?? []

  // Net-worth-style trajectory: cumulative signed deltas, oldest → newest.
  const series = useMemo(() => {
    const chrono = [...list].reverse()
    let run = 0
    return chrono.map((t) => {
      run += (t.kind === 'income' ? 1 : -1) * Number(t.amountCents)
      return run / 100
    })
  }, [list])

  async function add() {
    setBusy(true); setErr(undefined)
    try {
      // Optional receipt: upload to the media contract first (it transcodes
      // server-side, pass-3), then attach the returned path to the transaction.
      let receiptPath: string | null = null
      if (receiptFile) receiptPath = (await media.upload(receiptFile, 'photo')).path
      await postTransaction(accountId, kind, BigInt(Math.round(Number(amount || '0') * 100)), category.trim() || 'uncategorized', note.trim(), receiptPath)
      setAmount(''); setCategory(''); setNote(''); setReceiptFile(null)
      txs.refetch(); check.refetch(); accounts.refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function doTransfer() {
    setBusy(true); setErr(undefined)
    try {
      await transfer(accountId, BigInt(xferTo), BigInt(Math.round(Number(xferAmt || '0') * 100)), 'Internal transfer')
      setXferAmt('')
      txs.refetch(); check.refetch(); accounts.refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  if (accounts.loading) return <Spinner label="Loading account" />
  if (accounts.error) return <ErrorNote message={accounts.error} />
  if (!account) return <EmptyState title="Account not found" hint="It may not be yours." action={<Link to="/"><Button>Back</Button></Link>} />

  const consistent = check.data?.consistent ?? true

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-[var(--color-act)] hover:underline">← All accounts</Link>

      <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <span className="rounded-full bg-[var(--color-paper)] px-2 py-0.5 text-[11px] font-medium capitalize text-ink-soft ring-1 ring-[var(--color-line)]">{account.kind}</span>
          <h1 className="font-display mt-2 text-2xl font-bold">{account.name}</h1>
          <p className="font-display mt-1 text-4xl font-bold"><Money cents={account.balanceCents} /></p>
          {/* Integrity badge — stored balance == recomputed from the ledger. */}
          <p className={`mt-2 text-xs ${consistent ? 'pos' : 'neg'}`}>
            {consistent ? '✓ balance verified against the ledger' : '⚠ balance mismatch'}
          </p>
        </div>
        <Sparkline points={series} width={180} height={56} color={account.balanceCents < 0n ? 'var(--color-neg)' : 'var(--color-pos)'} />
      </section>

      {/* Add transaction */}
      <section className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg ring-1 ring-[var(--color-line)]">
            {(['expense', 'income'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`px-3 py-2 text-sm font-semibold capitalize ${kind === k ? (k === 'income' ? 'bg-[var(--color-pos)]/12 pos' : 'bg-[var(--color-neg)]/12 neg') : 'text-ink-soft'}`}>
                {k}
              </button>
            ))}
          </div>
          <input className="w-28 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm nums" placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="w-36 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm" placeholder="category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="flex-1 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--color-line)] px-3 py-2 text-sm text-ink-soft hover:bg-paper">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
            <span className="truncate max-w-[10rem]">{receiptFile ? `📎 ${receiptFile.name}` : '📎 Receipt'}</span>
          </label>
          <Button onClick={add} disabled={busy || !amount}>{busy ? (media.busy ? 'Uploading…' : 'Posting…') : 'Post'}</Button>
        </div>
        {err && <div className="mt-3"><ErrorNote message={err} /></div>}
      </section>

      {/* Transfer between own accounts — double-entry, oracle-checked */}
      {(accounts.data ?? []).length > 1 && (
        <section className="card p-4" data-testid="transfer-form">
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm font-semibold">Move money to</p>
            <select className="rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm"
              value={xferTo} onChange={(e) => setXferTo(e.target.value)}>
              <option value="">pick an account…</option>
              {(accounts.data ?? []).filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id.toString()} value={a.id.toString()}>{a.name}</option>
              ))}
            </select>
            <input className="w-28 rounded-lg border border-[var(--color-line)] bg-paper px-3 py-2 text-sm nums"
              placeholder="0.00" inputMode="decimal" value={xferAmt} onChange={(e) => setXferAmt(e.target.value)} />
            <Button onClick={doTransfer} disabled={busy || !xferTo || !xferAmt}>Transfer</Button>
            <p className="text-[11px] text-ink-soft">Two legs, one atomic step — the pair always nets zero on the oracle.</p>
          </div>
        </section>
      )}

      {/* Ledger */}
      <section>
        <h2 className="mb-2 font-display text-lg font-bold">Transactions</h2>
        {txs.loading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <EmptyState title="No transactions yet" hint="Post income or an expense above — the balance updates instantly." />
        ) : (
          <ul className="card divide-y divide-[var(--color-line)]">
            {list.map((t) => (
              <li key={t.id.toString()} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  {t.receiptPath && <MediaImage path={t.receiptPath} alt="receipt" ratio="1 / 1" className="h-10 w-10 shrink-0 rounded-md" />}
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {t.category}
                      {t.transferId > 0n && <span className="ml-2 rounded-full bg-[var(--color-act)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-act-ink)]">TRANSFER #{t.transferId.toString()}</span>}
                    </p>
                    {t.note && <p className="truncate text-xs text-ink-soft">{t.note}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <Money cents={t.kind === 'income' ? t.amountCents : -t.amountCents} signed className="font-display font-semibold" />
                  <p className="text-[11px] text-ink-soft nums">{when(t.timestamp)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
