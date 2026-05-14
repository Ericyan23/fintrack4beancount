import { sqlite } from '@/lib/db'
import type { Transaction } from '@/lib/db/schema'
import { REVIEW_CATEGORY_NAMES } from '@/lib/classify/defaults'

type SqlValue = string | number

export interface TransactionFilters {
  accountId?: string
  category?: string
  categoryGroup?: string
  unclassified?: boolean
  reviewOnly?: boolean
  startDate?: string
  endDate?: string
  search?: string
  status?: 'posted' | 'pending' | 'cancelled' | 'all'
  type?: 'income' | 'spending'
  amountMin?: number
  amountMax?: number
}

export interface TransactionWithSplitSummary extends Transaction {
  splitCount?: number
}

export interface TransactionExportRow extends TransactionWithSplitSummary {
  accountName: string | null
}

interface RawTransactionRow {
  id: string
  accountId: string
  source: string
  posted: number
  transactedAt: number | null
  amount: string
  description: string
  pending: number
  status: string
  category: string | null
  suggestedCat: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  suggestedLedgerAccount: string | null
  classifier: string | null
  confidence: number | null
  suggestedAt: number | null
  notes: string | null
  tags: string | null
  createdAt: number
  updatedBy: string | null
  accountName?: string | null
  splitCount?: number | null
}

export function parseTransactionFilters(searchParams: URLSearchParams): TransactionFilters {
  const amountMin = Number.parseFloat(searchParams.get('amountMin') ?? '')
  const amountMax = Number.parseFloat(searchParams.get('amountMax') ?? '')
  const status = searchParams.get('status')
  const type = searchParams.get('type')

  return {
    accountId: searchParams.get('accountId') || undefined,
    category: searchParams.get('category') || undefined,
    categoryGroup: searchParams.get('categoryGroup') || undefined,
    unclassified: searchParams.get('unclassified') === 'true',
    reviewOnly: searchParams.get('review') === 'true',
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    search: searchParams.get('search') || undefined,
    status: status === 'posted' || status === 'pending' || status === 'cancelled' || status === 'all'
      ? status
      : undefined,
    type: type === 'income' || type === 'spending' ? type : undefined,
    amountMin: Number.isFinite(amountMin) ? amountMin : undefined,
    amountMax: Number.isFinite(amountMax) ? amountMax : undefined,
  }
}

export function buildTransactionWhere(
  filters: TransactionFilters,
  options: { alias?: string; defaultStatus?: 'posted' | 'exclude_cancelled' } = {},
): { where: string; params: SqlValue[] } {
  const alias = options.alias ?? 't'
  const defaultStatus = options.defaultStatus ?? 'exclude_cancelled'
  const clauses: string[] = []
  const params: SqlValue[] = []

  if (filters.status && filters.status !== 'all') {
    clauses.push(`${alias}.status = ?`)
    params.push(filters.status)
  } else if (!filters.status) {
    clauses.push(defaultStatus === 'posted' ? `${alias}.status = 'posted'` : `${alias}.status != 'cancelled'`)
  }

  if (filters.accountId) {
    clauses.push(`${alias}.account_id = ?`)
    params.push(filters.accountId)
  }
  if (filters.category) {
    clauses.push(`COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) = ?`)
    params.push(filters.category)
  }
  if (filters.categoryGroup) {
    clauses.push(`(
      COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) = ?
      OR COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) LIKE ?
    )`)
    params.push(filters.categoryGroup, `${filters.categoryGroup}:%`)
  }
  if (filters.unclassified && filters.reviewOnly) {
    clauses.push(`(
      ${alias}.ledger_account IS NULL
      OR ${alias}.ledger_account = ''
      OR ${alias}.review_status = 'needs_review'
      OR (
        ${alias}.review_status IS NULL
        AND (
          ${alias}.category IS NULL
          OR ${alias}.category = ''
          OR ${alias}.category IN (${REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')})
        )
      )
    )`)
    params.push(...REVIEW_CATEGORY_NAMES)
  } else if (filters.unclassified) {
    clauses.push(`(${alias}.ledger_account IS NULL OR ${alias}.ledger_account = '')`)
  } else if (filters.reviewOnly) {
    clauses.push(`(
      ${alias}.review_status = 'needs_review'
      OR ${alias}.category IN (${REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')})
    )`)
    params.push(...REVIEW_CATEGORY_NAMES)
  }
  if (filters.startDate) {
    clauses.push(`${alias}.posted >= ?`)
    params.push(Math.floor(new Date(filters.startDate).getTime() / 1000))
  }
  if (filters.endDate) {
    clauses.push(`${alias}.posted <= ?`)
    params.push(Math.floor(new Date(filters.endDate).getTime() / 1000) + 86400 - 1)
  }
  if (filters.search) {
    clauses.push(`${alias}.description LIKE ?`)
    params.push(`%${filters.search}%`)
  }
  if (filters.type === 'income') {
    clauses.push(`CAST(${alias}.amount AS REAL) > 0`)
    clauses.push(`(
      COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) IS NULL
      OR COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) NOT LIKE 'Transfer:%'
    )`)
  }
  if (filters.type === 'spending') {
    clauses.push(`CAST(${alias}.amount AS REAL) < 0`)
    clauses.push(`(
      COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) IS NULL
      OR COALESCE(NULLIF(${alias}.ledger_account, ''), ${alias}.category) NOT LIKE 'Transfer:%'
    )`)
  }
  if (filters.amountMin !== undefined) {
    clauses.push(`CAST(${alias}.amount AS REAL) >= ?`)
    params.push(filters.amountMin)
  }
  if (filters.amountMax !== undefined) {
    clauses.push(`CAST(${alias}.amount AS REAL) <= ?`)
    params.push(filters.amountMax)
  }

  return { where: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1', params }
}

function parseTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function mapTransactionRow(row: RawTransactionRow): TransactionWithSplitSummary {
  const splitCount = row.splitCount ?? 0

  return {
    id: row.id,
    accountId: row.accountId,
    source: row.source,
    posted: row.posted,
    transactedAt: row.transactedAt,
    amount: row.amount,
    description: row.description,
    pending: Boolean(row.pending),
    status: row.status,
    category: row.category,
    suggestedCat: row.suggestedCat,
    ledgerAccount: row.ledgerAccount,
    reviewStatus: row.reviewStatus,
    suggestedLedgerAccount: row.suggestedLedgerAccount,
    classifier: row.classifier,
    confidence: row.confidence,
    suggestedAt: row.suggestedAt,
    notes: row.notes,
    tags: parseTags(row.tags),
    createdAt: row.createdAt,
    updatedBy: row.updatedBy,
    ...(splitCount > 0 ? { splitCount } : {}),
  }
}

const SELECT_TRANSACTION_FIELDS = `
  t.id,
  t.account_id AS accountId,
  t.source,
  t.posted,
  t.transacted_at AS transactedAt,
  t.amount,
  t.description,
  t.pending,
  t.status,
  COALESCE(NULLIF(t.ledger_account, ''), t.category) AS category,
  COALESCE(NULLIF(t.suggested_ledger_account, ''), t.suggested_cat) AS suggestedCat,
  t.ledger_account AS ledgerAccount,
  t.review_status AS reviewStatus,
  t.suggested_ledger_account AS suggestedLedgerAccount,
  t.classifier,
  t.confidence,
  t.suggested_at AS suggestedAt,
  t.notes,
  t.tags,
  t.created_at AS createdAt,
  t.updated_by AS updatedBy,
  COALESCE(split_counts.splitCount, 0) AS splitCount
`

const SPLIT_COUNT_JOIN = `
  LEFT JOIN (
    SELECT parent_transaction_id,
           COUNT(*) AS splitCount
    FROM transaction_splits
    GROUP BY parent_transaction_id
  ) split_counts ON split_counts.parent_transaction_id = t.id
`

export function listTransactions(
  filters: TransactionFilters,
  limit: number,
  offset: number,
): { transactions: TransactionWithSplitSummary[]; total: number; hasMore: boolean } {
  const { where, params } = buildTransactionWhere(filters)
  const rows = sqlite.prepare(`
    SELECT ${SELECT_TRANSACTION_FIELDS}
    FROM transactions t
    ${SPLIT_COUNT_JOIN}
    WHERE ${where}
    ORDER BY t.posted DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as RawTransactionRow[]

  const totalRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM transactions t
    WHERE ${where}
  `).get(...params) as { total: number }

  const total = totalRow.total
  return {
    transactions: rows.map(mapTransactionRow),
    total,
    hasMore: offset + rows.length < total,
  }
}

export function listTransactionsForExport(filters: TransactionFilters): TransactionExportRow[] {
  const { where, params } = buildTransactionWhere(filters)
  const rows = sqlite.prepare(`
    SELECT ${SELECT_TRANSACTION_FIELDS}, a.name AS accountName
    FROM transactions t
    ${SPLIT_COUNT_JOIN}
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE ${where}
    ORDER BY t.posted DESC
  `).all(...params) as RawTransactionRow[]

  return rows.map(row => ({
    ...mapTransactionRow(row),
    accountName: row.accountName ?? null,
  }))
}

export function countActiveUnclassified(): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM transactions
    WHERE (ledger_account IS NULL OR ledger_account = '') AND status != 'cancelled'
  `).get() as { total: number }
  return row.total
}

export function countActiveReviewCategory(): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM transactions
    WHERE (
        review_status = 'needs_review'
        OR category IN (${REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')})
      )
      AND status != 'cancelled'
  `).get(...REVIEW_CATEGORY_NAMES) as { total: number }
  return row.total
}
