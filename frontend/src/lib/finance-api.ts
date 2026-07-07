/**
 * finance-api.ts — typed reads/writes for the personal-finance backend on the
 * thebes SDK. Reads use flat `*View` methods; writes pass the account/tx kind as
 * TEXT (the backend parses it — the SDK can't encode Candid variants).
 */
import { query, update, encodeArgs, decodeVecRecord } from '@thebes/sdk'
import { FINANCE_CID } from './config'

export interface Account {
  id: bigint
  name: string
  kind: string // checking | savings | cash | credit
  balanceCents: bigint // Int — credit accounts go negative
  creditLimitCents: bigint
  createdAt: bigint
}
export interface Tx {
  id: bigint
  accountId: bigint
  kind: string // income | expense
  amountCents: bigint
  category: string
  note: string
  receiptPath: string // "" when none
  timestamp: bigint
  transferId: bigint // 0 = standalone; >0 links the two legs of a transfer
}
export interface BudgetRow {
  category: string
  limitCents: bigint
  spentCents: bigint
}
export interface BalanceCheck {
  stored: bigint
  recomputed: bigint
  consistent: boolean
}

const ACCOUNT_FIELDS = [
  { name: 'id', type: 'nat' as const },
  { name: 'name', type: 'text' as const },
  { name: 'kind', type: 'text' as const },
  { name: 'balanceCents', type: 'int' as const },
  { name: 'creditLimitCents', type: 'nat' as const },
  { name: 'createdAt', type: 'int' as const },
]
const TX_FIELDS = [
  { name: 'id', type: 'nat' as const },
  { name: 'accountId', type: 'nat' as const },
  { name: 'kind', type: 'text' as const },
  { name: 'amountCents', type: 'nat' as const },
  { name: 'category', type: 'text' as const },
  { name: 'note', type: 'text' as const },
  { name: 'receiptPath', type: 'text' as const },
  { name: 'timestamp', type: 'int' as const },
  { name: 'transferId', type: 'nat' as const },
]
const BUDGET_FIELDS = [
  { name: 'category', type: 'text' as const },
  { name: 'limitCents', type: 'nat' as const },
  { name: 'spentCents', type: 'nat' as const },
]
const CHECK_FIELDS = [
  { name: 'stored', type: 'int' as const },
  { name: 'recomputed', type: 'int' as const },
  { name: 'consistent', type: 'bool' as const },
]

export const decodeAccounts = (h: string) => decodeVecRecord(h, ACCOUNT_FIELDS) as unknown as Account[]
export const decodeTxs = (h: string) => decodeVecRecord(h, TX_FIELDS) as unknown as Tx[]
export const decodeBudgets = (h: string) => decodeVecRecord(h, BUDGET_FIELDS) as unknown as BudgetRow[]
export const decodeCheck = (h: string) =>
  (decodeVecRecord(h, CHECK_FIELDS) as unknown as BalanceCheck[])[0]

export const M = {
  accounts: 'accountsView',
  txs: 'transactionsView',
  budgets: 'budgetsView',
  check: 'verifyBalanceView',
} as const

export const txsArgs = (accountId: bigint, offset = 0, limit = 100): string =>
  encodeArgs([
    { type: 'nat', value: accountId },
    { type: 'nat', value: BigInt(offset) },
    { type: 'nat', value: BigInt(limit) },
  ])
export const checkArgs = (accountId: bigint): string =>
  encodeArgs([{ type: 'nat', value: accountId }])
export const budgetsArgs = (startNs: bigint, endNs: bigint): string =>
  encodeArgs([{ type: 'int', value: startNs }, { type: 'int', value: endNs }])

// ── Writes ──
export async function createAccount(name: string, kind: string, creditLimitCents: bigint): Promise<void> {
  await update(FINANCE_CID, 'createAccount', encodeArgs([
    { type: 'text', value: name },
    { type: 'text', value: kind },
    { type: 'nat', value: creditLimitCents },
  ]))
}
// Calls postTransactionOrTrap: the OrTrap variant traps the overdraft /
// zero-amount guard message, which `update` turns into a thrown error the UI
// can catch (a clean success/failure for the frontend).
export async function postTransaction(
  accountId: bigint, kind: string, amountCents: bigint, category: string, note: string, receiptPath: string | null,
): Promise<void> {
  await update(FINANCE_CID, 'postTransactionOrTrap', encodeArgs([
    { type: 'nat', value: accountId },
    { type: 'text', value: kind },
    { type: 'nat', value: amountCents },
    { type: 'text', value: category },
    { type: 'text', value: note },
    { type: 'opt', inner: { type: 'text' }, value: receiptPath },
  ]))
}
export async function setBudget(category: string, limitCents: bigint): Promise<void> {
  await update(FINANCE_CID, 'setBudget', encodeArgs([
    { type: 'text', value: category },
    { type: 'nat', value: limitCents },
  ]))
}
export async function claimOwner(): Promise<void> {
  await update(FINANCE_CID, 'claimOwner')
}
/** Populate the signed-in user's own books with a demo set (idempotent). */
export async function seedDemo(): Promise<void> {
  await update(FINANCE_CID, 'seedDemo')
}

export { query, FINANCE_CID }

// ── v2 surface: transfers, net worth, cashflow, the seal, the oracle ──
import { calibrate } from './chainTime'
import { decodeNat } from '@thebes/sdk'

export interface NetWorth {
  assetsCents: bigint; creditCents: bigint; netCents: bigint; accounts: bigint; nowNs: bigint
}
export interface CashflowBucket { bucketStartNs: bigint; incomeCents: bigint; expenseCents: bigint }
export interface FinanceSeal {
  accounts: bigint; transactions: bigint; storedSumCents: bigint; ledgerSumCents: bigint
  inconsistentAccounts: bigint; checkedAt: bigint
}
export interface ViolationRow { rule: string; detail: string }

const NETWORTH_FIELDS = [
  { name: 'assetsCents', type: 'int' as const }, { name: 'creditCents', type: 'int' as const },
  { name: 'netCents', type: 'int' as const }, { name: 'accounts', type: 'nat' as const },
  { name: 'nowNs', type: 'int' as const },
]
const CASHFLOW_FIELDS = [
  { name: 'bucketStartNs', type: 'int' as const }, { name: 'incomeCents', type: 'nat' as const },
  { name: 'expenseCents', type: 'nat' as const },
]
const SEAL_FIELDS = [
  { name: 'accounts', type: 'nat' as const }, { name: 'transactions', type: 'nat' as const },
  { name: 'storedSumCents', type: 'int' as const }, { name: 'ledgerSumCents', type: 'int' as const },
  { name: 'inconsistentAccounts', type: 'nat' as const }, { name: 'checkedAt', type: 'int' as const },
]
const VIOLATION_FIELDS = [{ name: 'rule', type: 'text' as const }, { name: 'detail', type: 'text' as const }]

export const decodeNetWorth = (h: string) => {
  const rows = decodeVecRecord(h, NETWORTH_FIELDS) as unknown as NetWorth[]
  if (rows.length > 0) calibrate(rows[0].nowNs)
  return rows[0]
}
export const decodeCashflow = (h: string) => decodeVecRecord(h, CASHFLOW_FIELDS) as unknown as CashflowBucket[]
export const decodeSeal = (h: string) => {
  const rows = decodeVecRecord(h, SEAL_FIELDS) as unknown as FinanceSeal[]
  if (rows.length > 0) calibrate(rows[0].checkedAt)
  return rows[0]
}
export const decodeViolations = (h: string) => decodeVecRecord(h, VIOLATION_FIELDS) as unknown as ViolationRow[]

export const M2 = {
  netWorth: 'netWorthView', cashflow: 'cashflowView', seal: 'financeSealView', invariants: 'invariantReportView',
} as const

export const cashflowArgs = (startNs: bigint, endNs: bigint, buckets: number) =>
  encodeArgs([{ type: 'int', value: startNs }, { type: 'int', value: endNs }, { type: 'nat', value: BigInt(buckets) }])

/** Move money between two of YOUR accounts — double-entry, atomic, oracle-checked. */
export async function transfer(fromId: bigint, toId: bigint, amountCents: bigint, note: string): Promise<bigint> {
  const r = await update(FINANCE_CID, 'transferOrTrap', encodeArgs([
    { type: 'nat', value: fromId }, { type: 'nat', value: toId },
    { type: 'nat', value: amountCents }, { type: 'text', value: note },
  ]))
  return decodeNat(r.reply_hex ?? r.reply ?? '')
}

/** One-shot chain-clock calibration (net worth carries nowNs). */
export async function calibrateChainClock(): Promise<void> {
  const r = await query(FINANCE_CID, 'netWorthView')
  decodeNetWorth(r.reply_hex ?? r.reply ?? '')
}
