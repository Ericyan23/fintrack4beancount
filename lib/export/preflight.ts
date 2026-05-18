import crypto from 'crypto'
import path from 'path'
import { sqlite } from '@/lib/db'
import {
  accountStateOn,
  defaultBeancountRoot,
  loadLedgerSnapshot,
  type LedgerSnapshot,
  type LedgerPosting,
} from '@/lib/export/beancount-ledger'
import {
  ledgerIntentFromInvestmentActivity,
  ledgerIntentFromTransaction,
  ledgerIntentFromTransfer,
  type LedgerIntent,
  type LedgerIntentInvestmentActivityInput,
} from '@/lib/export/ledger-intents'
import { loadPreviouslyExportedSourceIds } from '@/lib/export/export-runs'
import { REVIEW_CATEGORY_NAMES } from '@/lib/classify/defaults'

export type PreflightSeverity = 'blocker' | 'review'

export interface PreflightIssue {
  severity: PreflightSeverity
  code: string
  message: string
  transactionId?: string
  investmentActivityId?: string
  splitId?: string
  transferMatchId?: number
  account?: string | null
  category?: string | null
  sourceId?: string
}

export interface PreflightSplitPosting {
  id: string
  parentTransactionId: string
  amount: string
  currency: string
  ledgerAccount: string
  memo: string | null
  notes: string | null
  sortOrder: number
}

export interface PreflightTransaction {
  id: string
  sourceId: string
  date: string
  description: string
  amount: string
  accountId: string
  accountName: string
  accountType: string
  accountTypeOverride: string | null
  beancountAccount: string | null
  category: string | null
  currency: string
  splitPostings?: PreflightSplitPosting[]
}

export interface PreflightTransfer {
  id: number
  sourceId: string
  date: string
  kind: string
  outflow: PreflightTransaction
  inflow: PreflightTransaction
}

export interface PreflightSkipped {
  transactionId?: string
  investmentActivityId?: string
  reason: string
  transferMatchId?: number
}

export interface PreflightInvestmentActivity {
  id: string
  sourceId: string
  date: string
  description: string
  accountId: string | null
  accountName: string | null
  beancountAccount: string | null
  activityType: string
  instrumentType: string
  positionEffect: string
  securityId: string | null
  sourceSymbol: string | null
  beancountCommodity: string | null
  quantity: string | null
  price: string | null
  amount: string | null
  currency: string | null
  commission: string | null
  fees: string | null
}

export interface BeancountPreflightResult {
  ok: boolean
  period: string
  dateRange: { start: string; end: string }
  beancountRoot: string
  ledger: {
    filesScanned: number
    openAccounts: number
    sourceIds: number
  }
  proposedStaging: string
  summary: {
    transactionsScanned: number
    exportableTransactions: number
    mergedTransfers: number
    skipped: number
    blockers: number
    reviewItems: number
    duplicateCandidates: number
    previouslyExported?: number
    investmentActivitiesScanned?: number
    exportableInvestmentActivities?: number
  }
  blockers: PreflightIssue[]
  reviewItems: PreflightIssue[]
  duplicateCandidates: PreflightIssue[]
  exportableTransactions: PreflightTransaction[]
  mergedTransfers: PreflightTransfer[]
  exportableInvestmentActivities?: PreflightInvestmentActivity[]
  exportableIntents: LedgerIntent[]
  skipped: PreflightSkipped[]
}

interface TransactionRow {
  id: string
  accountId: string
  sourceConnectionId: string | null
  sourceAccountId: string | null
  sourceItemKey: string | null
  accountName: string
  currency: string
  accountType: string
  accountTypeOverride: string | null
  beancountAccount: string | null
  posted: number
  amount: string
  description: string
  status: string
  category: string | null
}

interface TransferMatchRow {
  id: number
  kind: string
  outflow: TransactionRow
  inflow: TransactionRow
}

interface InvestmentActivityRow {
  id: string
  accountId: string | null
  accountName: string | null
  beancountAccount: string | null
  securityId: string | null
  sourceSymbol: string | null
  beancountCommodity: string | null
  tradeDate: number
  activityType: string
  instrumentType: string
  positionEffect: string
  quantity: string | null
  price: string | null
  amount: string | null
  currency: string | null
  commission: string | null
  fees: string | null
  action: string
  description: string | null
}

interface ParsedDecimal {
  unscaled: bigint
  scale: number
}

const REVIEW_CATEGORIES = new Set(REVIEW_CATEGORY_NAMES)
const DUPLICATE_POSTING_DATE_TOLERANCE_DAYS = 7
const SUPPORTED_EXPORT_ACCOUNT_TYPES = new Set(['depository', 'credit'])
const SUPPORTED_INVESTMENT_ACTIVITY_TYPES = new Set(['buy', 'sell', 'dividend', 'interest', 'reinvest_dividend'])
const INVESTMENT_FEE_ACCOUNT = process.env.FINTRACK_INVESTMENT_FEE_ACCOUNT ?? 'Expenses:Fees:Financial'
const INVESTMENT_PNL_ACCOUNT = process.env.FINTRACK_INVESTMENT_PNL_ACCOUNT ?? 'Income:Investments:Trading'
const INVESTMENT_DIVIDEND_ACCOUNT = process.env.FINTRACK_INVESTMENT_DIVIDEND_ACCOUNT ?? 'Income:Investment:Dividends'
const INVESTMENT_INTEREST_ACCOUNT = process.env.FINTRACK_INVESTMENT_INTEREST_ACCOUNT ?? 'Income:Investment:Interest'

function dateFromUnix(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

function periodFromDate(date: string): string {
  return date.slice(0, 7)
}

function isRowInRange(row: TransactionRow, startTs: number, endTs: number): boolean {
  return row.posted >= startTs && row.posted <= endTs
}

function effectiveAccountType(row: Pick<PreflightTransaction, 'accountType' | 'accountTypeOverride'>): string {
  return row.accountTypeOverride || row.accountType
}

function parsePeriod(period: string): { start: string; end: string; startTs: number; endTs: number } {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('period must use YYYY-MM')
  }
  const startDate = new Date(`${period}-01T00:00:00Z`)
  if (Number.isNaN(startDate.getTime())) throw new Error('invalid period')
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0))
  const start = startDate.toISOString().slice(0, 10)
  const end = endDate.toISOString().slice(0, 10)
  return {
    start,
    end,
    startTs: Math.floor(startDate.getTime() / 1000),
    endTs: Math.floor(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 59, 59) / 1000),
  }
}

export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function sourceIdForTransaction(row: Pick<TransactionRow, 'accountId' | 'id' | 'sourceConnectionId' | 'sourceAccountId' | 'sourceItemKey'>): string {
  if (row.sourceConnectionId && row.sourceAccountId && row.sourceItemKey) {
    return [
      'fintrack',
      'source',
      encodeURIComponent(row.sourceConnectionId),
      encodeURIComponent(row.sourceAccountId),
      encodeURIComponent(row.sourceItemKey),
    ].join(':')
  }

  return `fintrack:${row.accountId}:${row.id}`
}

function sourceIdForPair(outflow: PreflightTransaction, inflow: PreflightTransaction): string {
  const digest = crypto
    .createHash('sha256')
    .update([outflow.sourceId, inflow.sourceId].sort().join('|'))
    .digest('hex')
    .slice(0, 24)
  return `fintrack:pair:${digest}`
}

function toPreflightTransaction(
  row: TransactionRow,
  splitPostings?: PreflightSplitPosting[],
): PreflightTransaction {
  return {
    id: row.id,
    sourceId: sourceIdForTransaction(row),
    date: dateFromUnix(row.posted),
    description: row.description,
    amount: row.amount,
    accountId: row.accountId,
    accountName: row.accountName,
    accountType: row.accountType,
    accountTypeOverride: row.accountTypeOverride,
    beancountAccount: row.beancountAccount,
    category: row.category,
    currency: row.currency,
    ...(splitPostings && splitPostings.length > 0 ? { splitPostings } : {}),
  }
}

function loadTransactions(startTs: number, endTs: number): TransactionRow[] {
  return sqlite.prepare(`
    SELECT
      t.id,
      t.account_id AS accountId,
      t.source_connection_id AS sourceConnectionId,
      t.source_account_id AS sourceAccountId,
      t.source_item_key AS sourceItemKey,
      a.name AS accountName,
      a.currency,
      a.account_type AS accountType,
      a.account_type_override AS accountTypeOverride,
      a.beancount_account AS beancountAccount,
      t.posted,
      t.amount,
      t.description,
      t.status,
      COALESCE(NULLIF(t.ledger_account, ''), t.category) AS category
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.posted BETWEEN ? AND ?
      AND t.status != 'cancelled'
    ORDER BY t.posted ASC, t.id ASC
  `).all(startTs, endTs) as TransactionRow[]
}

function loadSplitPostings(parentTransactionIds: string[]): Map<string, PreflightSplitPosting[]> {
  if (parentTransactionIds.length === 0) return new Map()

  const placeholders = parentTransactionIds.map(() => '?').join(', ')
  const rows = sqlite.prepare(`
    SELECT
      id,
      parent_transaction_id AS parentTransactionId,
      amount,
      currency,
      ledger_account AS ledgerAccount,
      memo,
      notes,
      sort_order AS sortOrder
    FROM transaction_splits
    WHERE parent_transaction_id IN (${placeholders})
    ORDER BY parent_transaction_id ASC, sort_order ASC, id ASC
  `).all(...parentTransactionIds) as PreflightSplitPosting[]

  const byParentId = new Map<string, PreflightSplitPosting[]>()
  for (const row of rows) {
    const existing = byParentId.get(row.parentTransactionId) ?? []
    existing.push(row)
    byParentId.set(row.parentTransactionId, existing)
  }
  return byParentId
}

function loadConfirmedTransferMatches(startTs: number, endTs: number): TransferMatchRow[] {
  const rows = sqlite.prepare(`
    SELECT
      m.id,
      m.kind,
      out_t.id AS out_id,
      out_t.account_id AS out_accountId,
      out_t.source_connection_id AS out_sourceConnectionId,
      out_t.source_account_id AS out_sourceAccountId,
      out_t.source_item_key AS out_sourceItemKey,
      out_a.name AS out_accountName,
      out_a.currency AS out_currency,
      out_a.account_type AS out_accountType,
      out_a.account_type_override AS out_accountTypeOverride,
      out_a.beancount_account AS out_beancountAccount,
      out_t.posted AS out_posted,
      out_t.amount AS out_amount,
      out_t.description AS out_description,
      out_t.status AS out_status,
      COALESCE(NULLIF(out_t.ledger_account, ''), out_t.category) AS out_category,
      in_t.id AS in_id,
      in_t.account_id AS in_accountId,
      in_t.source_connection_id AS in_sourceConnectionId,
      in_t.source_account_id AS in_sourceAccountId,
      in_t.source_item_key AS in_sourceItemKey,
      in_a.name AS in_accountName,
      in_a.currency AS in_currency,
      in_a.account_type AS in_accountType,
      in_a.account_type_override AS in_accountTypeOverride,
      in_a.beancount_account AS in_beancountAccount,
      in_t.posted AS in_posted,
      in_t.amount AS in_amount,
      in_t.description AS in_description,
      in_t.status AS in_status,
      COALESCE(NULLIF(in_t.ledger_account, ''), in_t.category) AS in_category
    FROM transfer_matches m
    JOIN transactions out_t ON out_t.id = m.outflow_transaction_id
    JOIN accounts out_a ON out_a.id = out_t.account_id
    JOIN transactions in_t ON in_t.id = m.inflow_transaction_id
    JOIN accounts in_a ON in_a.id = in_t.account_id
    WHERE m.status = 'confirmed'
      AND (out_t.posted BETWEEN ? AND ? OR in_t.posted BETWEEN ? AND ?)
    ORDER BY MIN(out_t.posted, in_t.posted), m.id
  `).all(startTs, endTs, startTs, endTs) as Array<{
    id: number
    kind: string
    out_id: string
    out_accountId: string
    out_sourceConnectionId: string | null
    out_sourceAccountId: string | null
    out_sourceItemKey: string | null
    out_accountName: string
    out_currency: string
    out_accountType: string
    out_accountTypeOverride: string | null
    out_beancountAccount: string | null
    out_posted: number
    out_amount: string
    out_description: string
    out_status: string
    out_category: string | null
    in_id: string
    in_accountId: string
    in_sourceConnectionId: string | null
    in_sourceAccountId: string | null
    in_sourceItemKey: string | null
    in_accountName: string
    in_currency: string
    in_accountType: string
    in_accountTypeOverride: string | null
    in_beancountAccount: string | null
    in_posted: number
    in_amount: string
    in_description: string
    in_status: string
    in_category: string | null
  }>

  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    outflow: {
      id: row.out_id,
      accountId: row.out_accountId,
      sourceConnectionId: row.out_sourceConnectionId,
      sourceAccountId: row.out_sourceAccountId,
      sourceItemKey: row.out_sourceItemKey,
      accountName: row.out_accountName,
      currency: row.out_currency,
      accountType: row.out_accountType,
      accountTypeOverride: row.out_accountTypeOverride,
      beancountAccount: row.out_beancountAccount,
      posted: row.out_posted,
      amount: row.out_amount,
      description: row.out_description,
      status: row.out_status,
      category: row.out_category,
    },
    inflow: {
      id: row.in_id,
      accountId: row.in_accountId,
      sourceConnectionId: row.in_sourceConnectionId,
      sourceAccountId: row.in_sourceAccountId,
      sourceItemKey: row.in_sourceItemKey,
      accountName: row.in_accountName,
      currency: row.in_currency,
      accountType: row.in_accountType,
      accountTypeOverride: row.in_accountTypeOverride,
      beancountAccount: row.in_beancountAccount,
      posted: row.in_posted,
      amount: row.in_amount,
      description: row.in_description,
      status: row.in_status,
      category: row.in_category,
    },
  }))
}

function sourceIdForInvestmentActivity(row: Pick<InvestmentActivityRow, 'id'>): string {
  return `fintrack:investment:${row.id}`
}

function toPreflightInvestmentActivity(row: InvestmentActivityRow): PreflightInvestmentActivity {
  return {
    id: row.id,
    sourceId: sourceIdForInvestmentActivity(row),
    date: dateFromUnix(row.tradeDate),
    description: row.description || row.action,
    accountId: row.accountId,
    accountName: row.accountName,
    beancountAccount: row.beancountAccount,
    activityType: row.activityType,
    instrumentType: row.instrumentType,
    positionEffect: row.positionEffect,
    securityId: row.securityId,
    sourceSymbol: row.sourceSymbol,
    beancountCommodity: row.beancountCommodity,
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    currency: row.currency,
    commission: row.commission,
    fees: row.fees,
  }
}

function loadReviewedInvestmentActivities(startTs: number, endTs: number): InvestmentActivityRow[] {
  return sqlite.prepare(`
    SELECT
      ia.id,
      ia.account_id AS accountId,
      accounts.name AS accountName,
      accounts.beancount_account AS beancountAccount,
      ia.security_id AS securityId,
      securities.source_symbol AS sourceSymbol,
      securities.beancount_commodity AS beancountCommodity,
      ia.trade_date AS tradeDate,
      ia.activity_type AS activityType,
      ia.instrument_type AS instrumentType,
      ia.position_effect AS positionEffect,
      ia.quantity,
      ia.price,
      ia.amount,
      ia.currency,
      ia.commission,
      ia.fees,
      ia.action,
      ia.description
    FROM investment_activities ia
    LEFT JOIN accounts
      ON accounts.id = ia.account_id
    LEFT JOIN securities
      ON securities.id = ia.security_id
    WHERE ia.status = 'reviewed'
      AND ia.trade_date BETWEEN ? AND ?
    ORDER BY ia.trade_date ASC, ia.created_at ASC, ia.id ASC
  `).all(startTs, endTs) as InvestmentActivityRow[]
}

function addIssue(target: PreflightIssue[], issue: Omit<PreflightIssue, 'severity'>, severity: PreflightSeverity): void {
  target.push({ ...issue, severity })
}

function validateLedgerAccount(
  snapshot: LedgerSnapshot,
  account: string | null,
  date: string,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
): boolean {
  const state = accountStateOn(snapshot, account, date)
  if (state.ok) return true

  const code = !account
    ? 'missing_beancount_mapping'
    : state.reason === 'missing'
    ? 'beancount_account_not_open'
    : state.reason === 'not_yet_open'
      ? 'beancount_account_not_yet_open'
      : 'beancount_account_closed'
  addIssue(blockers, {
    ...issueBase,
    code,
    account,
    message: account
      ? `${account} is not open on ${date}`
      : 'FinTrack account is missing beancountAccount mapping',
  }, 'blocker')
  return false
}

function validateAccountType(
  txn: PreflightTransaction,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
): boolean {
  const accountType = effectiveAccountType(txn)
  if (SUPPORTED_EXPORT_ACCOUNT_TYPES.has(accountType)) return true

  addIssue(blockers, {
    ...issueBase,
    code: 'unsupported_account_type',
    account: txn.beancountAccount,
    message: `${txn.accountName} has account type ${accountType}; Beancount handoff currently supports depository and credit accounts only`,
  }, 'blocker')
  return false
}

function validateCategory(
  snapshot: LedgerSnapshot,
  category: string | null,
  date: string,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
): boolean {
  if (!category) {
    addIssue(blockers, {
      ...issueBase,
      code: 'missing_category',
      category,
      message: 'Transaction is missing category',
    }, 'blocker')
    return false
  }

  if (category.startsWith('Transfer:')) return true

  const state = accountStateOn(snapshot, category, date)
  if (!state.ok) {
    addIssue(blockers, {
      ...issueBase,
      code: REVIEW_CATEGORIES.has(category) ? 'review_account_not_open' : 'category_not_open',
      category,
      message: `${category} is not open on ${date}`,
    }, 'blocker')
    return false
  }

  if (REVIEW_CATEGORIES.has(category)) {
    addIssue(blockers, {
      ...issueBase,
      code: 'review_category',
      category,
      message: `${category} requires human review before Beancount handoff`,
    }, 'blocker')
    return false
  }
  return true
}

function validateSplitPostingAccounts(
  snapshot: LedgerSnapshot,
  txn: PreflightTransaction,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
): boolean {
  let valid = true

  for (const split of txn.splitPostings ?? []) {
    const account = split.ledgerAccount || null
    const state = accountStateOn(snapshot, account, txn.date)
    if (state.ok) continue

    const code = !account
      ? 'missing_split_account'
      : state.reason === 'missing'
      ? 'split_account_not_open'
      : state.reason === 'not_yet_open'
        ? 'split_account_not_yet_open'
        : 'split_account_closed'

    addIssue(blockers, {
      ...issueBase,
      splitId: split.id,
      code,
      account,
      category: account,
      message: account
        ? `${account} is not open on ${txn.date}`
        : 'Split posting is missing ledger account',
    }, 'blocker')
    valid = false
  }

  return valid
}

function validateSplitPostingTotals(
  txn: PreflightTransaction,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
): boolean {
  const splits = txn.splitPostings ?? []
  if (splits.length === 0) return true

  let valid = true
  if (splits.length < 2) {
    addIssue(blockers, {
      ...issueBase,
      code: 'split_count_invalid',
      message: 'Split transactions require at least two split postings',
    }, 'blocker')
    valid = false
  }

  for (const split of splits) {
    if (split.currency !== txn.currency) {
      addIssue(blockers, {
        ...issueBase,
        splitId: split.id,
        code: 'split_currency_mismatch',
        account: split.ledgerAccount,
        category: split.ledgerAccount,
        message: `Split posting currency ${split.currency} does not match parent transaction currency ${txn.currency}`,
      }, 'blocker')
      valid = false
    }
  }

  try {
    const parent = parseDecimalString(txn.amount, 'Parent transaction amount')
    const parsedSplits = splits.map(split => parseDecimalString(split.amount, `Split posting ${split.id} amount`))
    const scale = Math.max(parent.scale, ...parsedSplits.map(split => split.scale))
    const parentValue = scaleDecimal(parent, scale)
    const splitValue = parsedSplits.reduce(
      (total, split) => total + scaleDecimal(split, scale),
      BigInt(0),
    )

    if (splitValue !== parentValue) {
      addIssue(blockers, {
        ...issueBase,
        code: 'split_amount_mismatch',
        message: 'Split posting amounts must sum exactly to the parent transaction amount',
      }, 'blocker')
      valid = false
    }
  } catch (error) {
    addIssue(blockers, {
      ...issueBase,
      code: 'split_amount_invalid',
      message: error instanceof Error ? error.message : 'Split posting amount is invalid',
    }, 'blocker')
    valid = false
  }

  return valid
}

function validateSplitPostingsNotOnConfirmedTransfer(
  splitPostingsByParentId: Map<string, PreflightSplitPosting[]>,
  transaction: PreflightTransaction,
  transferMatchId: number,
  blockers: PreflightIssue[],
): boolean {
  const splits = splitPostingsByParentId.get(transaction.id) ?? []
  if (splits.length === 0) return true

  addIssue(blockers, {
    code: 'confirmed_transfer_has_splits',
    transactionId: transaction.id,
    splitId: splits[0]?.id,
    transferMatchId,
    message: 'Confirmed transfer sides cannot have split postings; clear the split or unconfirm the transfer before export',
  }, 'blocker')
  return false
}

function validateDuplicateSourceId(
  snapshot: LedgerSnapshot,
  sourceId: string,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
  duplicateCandidates: PreflightIssue[],
): boolean {
  const existing = snapshot.sourceIds.get(sourceId)
  if (!existing) return true
  const issue = {
    ...issueBase,
    code: 'duplicate_source_id',
    sourceId,
    message: `${sourceId} already exists in ${path.relative(snapshot.root, existing.file)}:${existing.line}`,
  }
  addIssue(blockers, issue, 'blocker')
  addIssue(duplicateCandidates, issue, 'review')
  return false
}

function daysBetween(a: string, b: string): number {
  const aMs = Date.parse(`${a}T00:00:00Z`)
  const bMs = Date.parse(`${b}T00:00:00Z`)
  return Math.abs(Math.round((aMs - bMs) / 86_400_000))
}

function ledgerPostingKey(posting: LedgerPosting): string {
  return `${posting.file}:${posting.line}`
}

function findDuplicatePosting(
  snapshot: LedgerSnapshot,
  txn: PreflightTransaction,
  usedPostings: Set<string>,
): LedgerPosting | null {
  if (!txn.beancountAccount) return null
  const candidates = snapshot.postings
    .filter(posting =>
      !usedPostings.has(ledgerPostingKey(posting)) &&
      posting.account === txn.beancountAccount &&
      posting.amount === txn.amount &&
      posting.currency === txn.currency &&
      daysBetween(posting.date, txn.date) <= DUPLICATE_POSTING_DATE_TOLERANCE_DAYS,
    )
    .sort((a, b) => daysBetween(a.date, txn.date) - daysBetween(b.date, txn.date))
  return candidates[0] ?? null
}

function validateDuplicatePosting(
  snapshot: LedgerSnapshot,
  txn: PreflightTransaction,
  issueBase: Omit<PreflightIssue, 'severity' | 'code' | 'message'>,
  blockers: PreflightIssue[],
  duplicateCandidates: PreflightIssue[],
  usedPostings: Set<string>,
): boolean {
  const existing = findDuplicatePosting(snapshot, txn, usedPostings)
  if (!existing) return true
  usedPostings.add(ledgerPostingKey(existing))

  const issue = {
    ...issueBase,
    code: 'duplicate_existing_posting',
    account: txn.beancountAccount,
    message: `${txn.beancountAccount} ${txn.amount} ${txn.currency} on ${txn.date} matches existing ${existing.date} posting in ${path.relative(snapshot.root, existing.file)}:${existing.line}`,
  }
  addIssue(blockers, issue, 'blocker')
  addIssue(duplicateCandidates, issue, 'review')
  return false
}

function validateTransactionSign(
  txn: PreflightTransaction,
  reviewItems: PreflightIssue[],
): void {
  const amount = Number.parseFloat(txn.amount)
  if (!txn.category || !Number.isFinite(amount)) return
  if (amount > 0 && txn.category.startsWith('Expenses:')) {
    addIssue(reviewItems, {
      code: 'positive_expense',
      transactionId: txn.id,
      category: txn.category,
      message: 'Positive amount uses an Expenses category; confirm this is a refund or correction',
    }, 'review')
  }
  if (amount < 0 && txn.category.startsWith('Income:')) {
    addIssue(reviewItems, {
      code: 'negative_income',
      transactionId: txn.id,
      category: txn.category,
      message: 'Negative amount uses an Income category; confirm this is a reversal or correction',
    }, 'review')
  }
}

function validateSplitPostingSigns(
  txn: PreflightTransaction,
  reviewItems: PreflightIssue[],
): void {
  for (const split of txn.splitPostings ?? []) {
    const amount = Number.parseFloat(split.amount)
    if (!Number.isFinite(amount)) continue
    if (amount > 0 && split.ledgerAccount.startsWith('Expenses:')) {
      addIssue(reviewItems, {
        code: 'positive_expense',
        transactionId: txn.id,
        splitId: split.id,
        category: split.ledgerAccount,
        message: 'Positive split amount uses an Expenses account; confirm this is a refund or correction',
      }, 'review')
    }
    if (amount < 0 && split.ledgerAccount.startsWith('Income:')) {
      addIssue(reviewItems, {
        code: 'negative_income',
        transactionId: txn.id,
        splitId: split.id,
        category: split.ledgerAccount,
        message: 'Negative split amount uses an Income account; confirm this is a reversal or correction',
      }, 'review')
    }
  }
}

function formatMoneyNumber(value: number): string {
  const rounded = Math.abs(value) < 0.0000005 ? 0 : value
  const fixed = rounded.toFixed(6)
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return trimmed.includes('.') ? trimmed : `${trimmed}.00`
}

function decimalNumber(value: string | null, label: string): number {
  if (value === null) throw new Error(`${label} is missing`)
  parseDecimalString(value, label)
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`)
  return parsed
}

function optionalPositiveMoney(value: string | null, label: string): number {
  if (!value) return 0
  return Math.abs(decimalNumber(value, label))
}

function feeAmountForInvestment(activity: PreflightInvestmentActivity): string | null {
  const total = optionalPositiveMoney(activity.commission, 'Investment commission')
    + optionalPositiveMoney(activity.fees, 'Investment fees')
  return total > 0 ? formatMoneyNumber(total) : null
}

function unitInvestmentPrice(activity: PreflightInvestmentActivity, feeAmount: string | null): string | null {
  if (!activity.quantity) return activity.price
  const quantity = Math.abs(decimalNumber(activity.quantity, 'Investment quantity'))
  if (quantity === 0) return activity.price
  if (!activity.amount) return activity.price

  const cash = decimalNumber(activity.amount, 'Investment cash amount')
  const fees = feeAmount ? decimalNumber(feeAmount, 'Investment fee amount') : 0
  const gross = activity.activityType === 'sell'
    ? Math.abs(cash) + fees
    : Math.abs(cash) - fees
  if (gross <= 0) return activity.price

  return formatMoneyNumber(gross / quantity)
}

function isTradeInvestmentActivity(activity: PreflightInvestmentActivity): boolean {
  return activity.activityType === 'buy' || activity.activityType === 'sell'
}

function isInvestmentIncomeActivity(activity: PreflightInvestmentActivity): boolean {
  return activity.activityType === 'dividend' || activity.activityType === 'interest'
}

function isReinvestDividendActivity(activity: PreflightInvestmentActivity): boolean {
  return activity.activityType === 'reinvest_dividend'
}

function requiresInvestmentSecurity(activity: PreflightInvestmentActivity): boolean {
  return isTradeInvestmentActivity(activity) || isReinvestDividendActivity(activity)
}

function requiresInvestmentPnlPosting(activity: PreflightInvestmentActivity): boolean {
  return activity.activityType === 'sell' || activity.positionEffect === 'close'
}

function incomeAccountForInvestment(activity: PreflightInvestmentActivity): string | null {
  if (activity.activityType === 'dividend' || activity.activityType === 'reinvest_dividend') {
    return INVESTMENT_DIVIDEND_ACCOUNT
  }
  if (activity.activityType === 'interest') {
    return INVESTMENT_INTEREST_ACCOUNT
  }
  return null
}

function investmentIntentFromPreflight(
  activity: PreflightInvestmentActivity,
): LedgerIntentInvestmentActivityInput {
  const feeAmount = feeAmountForInvestment(activity)
  const unitPrice = unitInvestmentPrice(activity, feeAmount)
  const requiresPnl = requiresInvestmentPnlPosting(activity)
  const incomeAccount = incomeAccountForInvestment(activity)

  if (isInvestmentIncomeActivity(activity)) {
    return {
      id: activity.id,
      sourceId: activity.sourceId,
      date: activity.date,
      description: activity.description,
      activityType: activity.activityType as 'dividend' | 'interest',
      positionEffect: activity.positionEffect,
      investmentAccount: activity.beancountAccount,
      cashAmount: activity.amount ?? '',
      cashCurrency: activity.currency ?? 'USD',
      incomeAccount,
    }
  }

  if (isReinvestDividendActivity(activity)) {
    return {
      id: activity.id,
      sourceId: activity.sourceId,
      date: activity.date,
      description: activity.description,
      activityType: 'reinvest_dividend',
      positionEffect: activity.positionEffect,
      investmentAccount: activity.beancountAccount,
      commodity: activity.beancountCommodity ?? '',
      quantity: activity.quantity ?? '',
      cashAmount: activity.amount ?? '',
      cashCurrency: activity.currency ?? 'USD',
      unitCost: unitPrice,
      incomeAccount,
    }
  }

  return {
    id: activity.id,
    sourceId: activity.sourceId,
    date: activity.date,
    description: activity.description,
    activityType: activity.activityType as 'buy' | 'sell',
    positionEffect: activity.positionEffect,
    investmentAccount: activity.beancountAccount,
    commodity: activity.beancountCommodity ?? '',
    quantity: activity.quantity ?? '',
    cashAmount: activity.amount ?? '',
    cashCurrency: activity.currency ?? 'USD',
    unitCost: requiresPnl ? null : unitPrice,
    unitPrice,
    feeAmount,
    feeAccount: feeAmount ? INVESTMENT_FEE_ACCOUNT : null,
    pnlAccount: requiresPnl ? INVESTMENT_PNL_ACCOUNT : null,
  }
}

function validateInvestmentActivity(
  snapshot: LedgerSnapshot,
  activity: PreflightInvestmentActivity,
  blockers: PreflightIssue[],
  reviewItems: PreflightIssue[],
  duplicateCandidates: PreflightIssue[],
): boolean {
  const issueBase = {
    investmentActivityId: activity.id,
    sourceId: activity.sourceId,
  }
  let valid = true

  valid = validateDuplicateSourceId(snapshot, activity.sourceId, issueBase, blockers, duplicateCandidates) && valid
  valid = validateLedgerAccount(snapshot, activity.beancountAccount, activity.date, issueBase, blockers) && valid

  if (!SUPPORTED_INVESTMENT_ACTIVITY_TYPES.has(activity.activityType)) {
    addIssue(blockers, {
      ...issueBase,
      code: 'unsupported_investment_activity_type',
      message: `Investment activity type ${activity.activityType} is not exportable yet`,
    }, 'blocker')
    valid = false
  }

  const requiresSecurity = requiresInvestmentSecurity(activity)
  const incomeAccount = incomeAccountForInvestment(activity)

  if (requiresSecurity && !activity.beancountCommodity) {
    addIssue(blockers, {
      ...issueBase,
      code: 'missing_security_mapping',
      message: `Security ${activity.sourceSymbol ?? activity.securityId ?? activity.id} is missing Beancount commodity mapping`,
    }, 'blocker')
    valid = false
  }

  if (requiresSecurity && !activity.quantity) {
    addIssue(blockers, {
      ...issueBase,
      code: 'missing_investment_quantity',
      message: 'Investment activity is missing quantity',
    }, 'blocker')
    valid = false
  }
  if (!activity.amount) {
    addIssue(blockers, {
      ...issueBase,
      code: 'missing_investment_cash_amount',
      message: 'Investment activity is missing cash amount',
    }, 'blocker')
    valid = false
  }
  if (!activity.currency) {
    addIssue(blockers, {
      ...issueBase,
      code: 'missing_investment_currency',
      message: 'Investment activity is missing cash currency',
    }, 'blocker')
    valid = false
  }

  let feeAmount: string | null = null
  try {
    if (activity.quantity) decimalNumber(activity.quantity, 'Investment quantity')
    if (activity.amount) decimalNumber(activity.amount, 'Investment cash amount')
    if (activity.price) decimalNumber(activity.price, 'Investment price')
    feeAmount = feeAmountForInvestment(activity)
    if (requiresSecurity) unitInvestmentPrice(activity, feeAmount)
  } catch (error) {
    addIssue(blockers, {
      ...issueBase,
      code: 'invalid_investment_amount',
      message: error instanceof Error ? error.message : 'Investment amount is invalid',
    }, 'blocker')
    valid = false
  }

  if (feeAmount && !isTradeInvestmentActivity(activity)) {
    addIssue(blockers, {
      ...issueBase,
      code: 'unsupported_investment_income_fee',
      message: 'Investment income and reinvested dividend rows with fees are not exportable yet',
    }, 'blocker')
    valid = false
  }

  if (isReinvestDividendActivity(activity) && activity.amount) {
    try {
      const cashAmount = decimalNumber(activity.amount, 'Reinvested dividend amount')
      if (cashAmount <= 0) {
        addIssue(blockers, {
          ...issueBase,
          code: 'invalid_reinvest_dividend_amount',
          message: 'Reinvested dividend export requires a positive dividend amount',
        }, 'blocker')
        valid = false
      }
    } catch {
      // The generic amount validation above already records the decimal parsing issue.
    }
  }

  if (feeAmount && isTradeInvestmentActivity(activity)) {
    valid = validateLedgerAccount(snapshot, INVESTMENT_FEE_ACCOUNT, activity.date, {
      ...issueBase,
      account: INVESTMENT_FEE_ACCOUNT,
    }, blockers) && valid
  }

  if (incomeAccount) {
    valid = validateLedgerAccount(snapshot, incomeAccount, activity.date, {
      ...issueBase,
      account: incomeAccount,
    }, blockers) && valid
  }

  if (requiresInvestmentPnlPosting(activity)) {
    valid = validateLedgerAccount(snapshot, INVESTMENT_PNL_ACCOUNT, activity.date, {
      ...issueBase,
      account: INVESTMENT_PNL_ACCOUNT,
    }, blockers) && valid
    addIssue(blockers, {
      ...issueBase,
      code: 'investment_pnl_requires_lot_review',
      account: INVESTMENT_PNL_ACCOUNT,
      message: 'Investment sell/close export requires explicit lot, cost basis, or manual override before Beancount handoff',
    }, 'blocker')
    valid = false
  }

  if (isReinvestDividendActivity(activity)) {
    addIssue(reviewItems, {
      ...issueBase,
      code: 'reinvest_dividend_requires_review',
      account: incomeAccount,
      message: 'Reinvested dividend export uses the row amount as dividend income and security cost; confirm before handoff',
    }, 'review')
  }

  return valid
}


function parseDecimalString(value: string, label: string): ParsedDecimal {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`${label} must be a decimal string`)
  }

  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  const digits = `${whole}${fraction}`
  const unscaled = BigInt(digits) * (negative ? BigInt(-1) : BigInt(1))

  return { unscaled, scale: fraction.length }
}

function scaleDecimal(value: ParsedDecimal, targetScale: number): bigint {
  return value.unscaled * BigInt(10) ** BigInt(targetScale - value.scale)
}

export function runBeancountPreflight(options: {
  period?: string
  beancountRoot?: string
  excludeExported?: boolean
} = {}): BeancountPreflightResult {
  const period = options.period ?? currentPeriod()
  const range = parsePeriod(period)
  const beancountRoot = options.beancountRoot ?? defaultBeancountRoot()
  const snapshot = loadLedgerSnapshot(beancountRoot)
  const rows = loadTransactions(range.startTs, range.endTs)
  const investmentRows = loadReviewedInvestmentActivities(range.startTs, range.endTs)
  const confirmedTransferMatches = loadConfirmedTransferMatches(range.startTs, range.endTs)
  const splitParentIds = new Set(rows.map(row => row.id))
  for (const match of confirmedTransferMatches) {
    splitParentIds.add(match.outflow.id)
    splitParentIds.add(match.inflow.id)
  }
  const splitPostingsByParentId = loadSplitPostings([...splitParentIds])
  const blockers: PreflightIssue[] = []
  const reviewItems: PreflightIssue[] = []
  const duplicateCandidates: PreflightIssue[] = []
  const skipped: PreflightSkipped[] = []
  const mergedTransfers: PreflightTransfer[] = []
  const exportableTransactions: PreflightTransaction[] = []
  const exportableInvestmentActivities: PreflightInvestmentActivity[] = []
  const previouslyExportedSourceIds = options.excludeExported
    ? loadPreviouslyExportedSourceIds({ exportTarget: 'beancount_handoff' })
    : new Set<string>()
  const occupiedTransactionIds = new Set<string>()
  const duplicateLedgerPostings = new Set<string>()
  let previouslyExported = 0

  for (const match of confirmedTransferMatches) {
    const outRow = match.outflow
    const inRow = match.inflow
    const outflow = toPreflightTransaction(outRow)
    const inflow = toPreflightTransaction(inRow)
    const outflowInPeriod = isRowInRange(outRow, range.startTs, range.endTs)
    const inflowInPeriod = isRowInRange(inRow, range.startTs, range.endTs)
    const pairSourceId = sourceIdForPair(outflow, inflow)
    const date = outflow.date <= inflow.date ? outflow.date : inflow.date
    const exportPeriod = periodFromDate(date)

    if (previouslyExportedSourceIds.has(pairSourceId)) {
      previouslyExported += 1
      if (outflowInPeriod) {
        occupiedTransactionIds.add(outflow.id)
        skipped.push({ transactionId: outflow.id, reason: 'already_exported', transferMatchId: match.id })
      }
      if (inflowInPeriod) {
        occupiedTransactionIds.add(inflow.id)
        skipped.push({ transactionId: inflow.id, reason: 'already_exported', transferMatchId: match.id })
      }
      continue
    }

    if (exportPeriod !== period) {
      if (outflowInPeriod) {
        occupiedTransactionIds.add(outflow.id)
        skipped.push({ transactionId: outflow.id, reason: `confirmed_transfer_exports_in_${exportPeriod}`, transferMatchId: match.id })
      }
      if (inflowInPeriod) {
        occupiedTransactionIds.add(inflow.id)
        skipped.push({ transactionId: inflow.id, reason: `confirmed_transfer_exports_in_${exportPeriod}`, transferMatchId: match.id })
      }
      continue
    }

    let valid = true
    if (outRow.status !== 'posted') {
      addIssue(blockers, {
        code: 'confirmed_transfer_side_not_posted',
        transactionId: outflow.id,
        transferMatchId: match.id,
        message: `Confirmed transfer side is ${outRow.status}, not posted`,
      }, 'blocker')
      valid = false
    }
    if (inRow.status !== 'posted') {
      addIssue(blockers, {
        code: 'confirmed_transfer_side_not_posted',
        transactionId: inflow.id,
        transferMatchId: match.id,
        message: `Confirmed transfer side is ${inRow.status}, not posted`,
      }, 'blocker')
      valid = false
    }
    valid = validateAccountType(outflow, {
      transactionId: outflow.id,
      transferMatchId: match.id,
    }, blockers) && valid
    valid = validateAccountType(inflow, {
      transactionId: inflow.id,
      transferMatchId: match.id,
    }, blockers) && valid
    valid = validateLedgerAccount(snapshot, outflow.beancountAccount, outflow.date, {
      transactionId: outflow.id,
      transferMatchId: match.id,
    }, blockers) && valid
    valid = validateLedgerAccount(snapshot, inflow.beancountAccount, inflow.date, {
      transactionId: inflow.id,
      transferMatchId: match.id,
    }, blockers) && valid
    valid = validateDuplicateSourceId(snapshot, pairSourceId, {
      transferMatchId: match.id,
      sourceId: pairSourceId,
    }, blockers, duplicateCandidates) && valid
    valid = validateDuplicatePosting(snapshot, outflow, {
      transactionId: outflow.id,
      transferMatchId: match.id,
    }, blockers, duplicateCandidates, duplicateLedgerPostings) && valid
    valid = validateDuplicatePosting(snapshot, inflow, {
      transactionId: inflow.id,
      transferMatchId: match.id,
    }, blockers, duplicateCandidates, duplicateLedgerPostings) && valid
    valid = validateSplitPostingsNotOnConfirmedTransfer(
      splitPostingsByParentId,
      outflow,
      match.id,
      blockers,
    ) && valid
    valid = validateSplitPostingsNotOnConfirmedTransfer(
      splitPostingsByParentId,
      inflow,
      match.id,
      blockers,
    ) && valid

    if (outflow.currency !== inflow.currency) {
      addIssue(blockers, {
        code: 'confirmed_transfer_currency_mismatch',
        transferMatchId: match.id,
        message: `Confirmed transfer currencies do not match: ${outflow.currency} vs ${inflow.currency}`,
      }, 'blocker')
      valid = false
    }

    const outAmount = Number.parseFloat(outflow.amount)
    const inAmount = Number.parseFloat(inflow.amount)
    if (!Number.isFinite(outAmount) || !Number.isFinite(inAmount) || Math.abs(outAmount + inAmount) > 0.005) {
      addIssue(blockers, {
        code: 'confirmed_transfer_amount_mismatch',
        transferMatchId: match.id,
        message: 'Confirmed transfer amounts do not net to zero',
      }, 'blocker')
      valid = false
    }

    const skippedReason = valid ? 'merged_into_confirmed_transfer' : 'confirmed_transfer_blocked'
    if (outflowInPeriod) {
      occupiedTransactionIds.add(outflow.id)
      skipped.push({ transactionId: outflow.id, reason: skippedReason, transferMatchId: match.id })
    }
    if (inflowInPeriod) {
      occupiedTransactionIds.add(inflow.id)
      skipped.push({ transactionId: inflow.id, reason: skippedReason, transferMatchId: match.id })
    }
    if (valid) {
      mergedTransfers.push({
        id: match.id,
        sourceId: pairSourceId,
        date,
        kind: match.kind,
        outflow,
        inflow,
      })
    }
  }

  for (const row of rows) {
    if (occupiedTransactionIds.has(row.id)) continue
    const txn = toPreflightTransaction(row, splitPostingsByParentId.get(row.id))
    const hasSplitPostings = Boolean(txn.splitPostings?.length)

    if (previouslyExportedSourceIds.has(txn.sourceId)) {
      previouslyExported += 1
      skipped.push({ transactionId: txn.id, reason: 'already_exported' })
      continue
    }

    if (row.status !== 'posted') {
      skipped.push({ transactionId: row.id, reason: `status_${row.status}` })
      continue
    }

    let valid = true
    valid = validateLedgerAccount(snapshot, txn.beancountAccount, txn.date, {
      transactionId: txn.id,
    }, blockers) && valid
    valid = validateAccountType(txn, {
      transactionId: txn.id,
    }, blockers) && valid
    valid = validateDuplicateSourceId(snapshot, txn.sourceId, {
      transactionId: txn.id,
      sourceId: txn.sourceId,
    }, blockers, duplicateCandidates) && valid
    valid = validateSplitPostingAccounts(snapshot, txn, {
      transactionId: txn.id,
    }, blockers) && valid
    valid = validateSplitPostingTotals(txn, {
      transactionId: txn.id,
    }, blockers) && valid
    const isNotExistingPosting = validateDuplicatePosting(snapshot, txn, {
      transactionId: txn.id,
    }, blockers, duplicateCandidates, duplicateLedgerPostings)

    if (!hasSplitPostings && txn.category?.startsWith('Transfer:')) {
      if (!isNotExistingPosting) continue
      addIssue(blockers, {
        code: 'unmatched_transfer',
        transactionId: txn.id,
        category: txn.category,
        message: 'Transfer transaction is not part of a confirmed transfer pair',
      }, 'blocker')
      continue
    }

    if (!hasSplitPostings) {
      valid = validateCategory(snapshot, txn.category, txn.date, {
        transactionId: txn.id,
      }, blockers) && valid
      validateTransactionSign(txn, reviewItems)
    } else {
      validateSplitPostingSigns(txn, reviewItems)
    }
    valid = isNotExistingPosting && valid

    if (valid) exportableTransactions.push(txn)
  }

  for (const row of investmentRows) {
    const activity = toPreflightInvestmentActivity(row)

    if (previouslyExportedSourceIds.has(activity.sourceId)) {
      previouslyExported += 1
      continue
    }

    const valid = validateInvestmentActivity(
      snapshot,
      activity,
      blockers,
      reviewItems,
      duplicateCandidates,
    )

    if (valid) exportableInvestmentActivities.push(activity)
  }

  const proposedStaging = path.join('staging', period, 'fintrack', 'draft', `${period}.bean`)
  const exportableIntents: LedgerIntent[] = [
    ...exportableTransactions.map(ledgerIntentFromTransaction),
    ...mergedTransfers.map(ledgerIntentFromTransfer),
    ...exportableInvestmentActivities
      .map(investmentIntentFromPreflight)
      .map(ledgerIntentFromInvestmentActivity),
  ]

  return {
    ok: blockers.length === 0,
    period,
    dateRange: { start: range.start, end: range.end },
    beancountRoot,
    ledger: {
      filesScanned: snapshot.files.length,
      openAccounts: snapshot.accounts.size,
      sourceIds: snapshot.sourceIds.size,
    },
    proposedStaging,
    summary: {
      transactionsScanned: rows.length,
      exportableTransactions: exportableTransactions.length,
      mergedTransfers: mergedTransfers.length,
      investmentActivitiesScanned: investmentRows.length,
      exportableInvestmentActivities: exportableInvestmentActivities.length,
      skipped: skipped.length,
      blockers: blockers.length,
      reviewItems: reviewItems.length,
      duplicateCandidates: duplicateCandidates.length,
      previouslyExported,
    },
    blockers,
    reviewItems,
    duplicateCandidates,
    exportableTransactions,
    mergedTransfers,
    exportableInvestmentActivities,
    exportableIntents,
    skipped,
  }
}
