import { useQuery } from '@thebes/sdk'
import { FINANCE_CID, M2, decodeSeal, type FinanceSeal as Seal } from '../lib/finance-api'
import { fmtCents } from '../lib/config'

/**
 * FinanceSeal — the footer's live proof, with zero personal data: across the
 * WHOLE contract, the sum of every stored balance must equal the sum of every
 * signed transaction, and no account's log may disagree with its balance.
 */
export function FinanceSeal() {
  const { data, loading } = useQuery<Seal>(FINANCE_CID, M2.seal, undefined, decodeSeal)
  if (loading || !data) return null
  const ok = data.storedSumCents === data.ledgerSumCents && Number(data.inconsistentAccounts) === 0
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] nums" data-testid="finance-seal">
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-[var(--color-pos)]' : 'bg-[var(--color-neg)]'}`} />
      {ok ? (
        <span className="text-ink-soft">
          <b className="text-ink">Every balance equals its ledger, contract-wide</b> ·
          Σ balances = Σ postings = ${fmtCents(data.storedSumCents)} across {data.accounts.toString()} accounts
          and {data.transactions.toString()} transactions · 0 inconsistencies
        </span>
      ) : (
        <span className="font-semibold text-[var(--color-neg)]">
          The seal is broken: {data.inconsistentAccounts.toString()} account(s) disagree with their ledger.
        </span>
      )}
    </div>
  )
}
