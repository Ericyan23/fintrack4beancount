import { sqlite } from '../db'

const DEFAULT_SPLIT_CREATED_FROM = 'manual_split'

export interface TransactionSplitInput {
  amount: string
  currency?: string
  ledgerAccount: string
  memo?: string | null
  notes?: string | null
}

export interface TransactionSplitAuditMetadata {
  actor?: string | null
  reason?: string | null
}

export interface TransactionSplitRecord {
  id: string
  parentTransactionId: string
  splitGroupId: string
  amount: string
  currency: string
  ledgerAccount: string
  memo: string | null
  notes: string | null
  sortOrder: number
  createdFrom: string
  createdAt: number
  updatedAt: number
}

interface ParentTransactionRow {
  id: string
  amount: string
  currency: string | null
}

interface ParsedDecimal {
  unscaled: bigint
  scale: number
}

interface NormalizedSplitInput {
  amount: string
  currency: string
  ledgerAccount: string
  memo: string | null
  notes: string | null
  parsedAmount: ParsedDecimal
}

interface TransactionSplitAuditSnapshot {
  id: string
  splitGroupId: string
  amount: string
  currency: string
  ledgerAccount: string
  memo: string | null
  notes: string | null
  sortOrder: number
  createdFrom: string
}

type TransactionSplitAuditOperation = 'split_create' | 'split_update' | 'split_delete'

export class ParentTransactionNotFoundError extends Error {
  constructor(parentTransactionId: string) {
    super(`Parent transaction not found: ${parentTransactionId}`)
    this.name = 'ParentTransactionNotFoundError'
  }
}

export class TransactionSplitConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransactionSplitConflictError'
  }
}

const splitSelectSql = `
  SELECT id,
         parent_transaction_id AS parentTransactionId,
         split_group_id AS splitGroupId,
         amount,
         currency,
         ledger_account AS ledgerAccount,
         memo,
         notes,
         sort_order AS sortOrder,
         created_from AS createdFrom,
         created_at AS createdAt,
         updated_at AS updatedAt
  FROM transaction_splits
  WHERE parent_transaction_id = ?
  ORDER BY sort_order ASC, id ASC
`

const selectSplits = sqlite.prepare(splitSelectSql)

const parentSelect = sqlite.prepare(`
  SELECT t.id,
         t.amount,
         COALESCE(a.currency, 'USD') AS currency
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  WHERE t.id = ?
`)

const deleteSplits = sqlite.prepare(`
  DELETE FROM transaction_splits
  WHERE parent_transaction_id = ?
`)

const insertSplit = sqlite.prepare(`
  INSERT INTO transaction_splits (
    id,
    parent_transaction_id,
    split_group_id,
    amount,
    currency,
    ledger_account,
    memo,
    notes,
    sort_order,
    created_from,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertSplitAudit = sqlite.prepare(`
  INSERT INTO transaction_edit_history (
    transaction_id,
    actor,
    reason,
    fields,
    before_values,
    after_values,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

export function listTransactionSplits(parentTransactionId: string): TransactionSplitRecord[] {
  assertParentTransactionExists(parentTransactionId)
  return selectTransactionSplits(parentTransactionId)
}

export function replaceTransactionSplits(input: {
  parentTransactionId: string
  splits: TransactionSplitInput[]
  createdFrom?: string
  audit?: TransactionSplitAuditMetadata
}): TransactionSplitRecord[] {
  const parent = getParentTransaction(input.parentTransactionId)
  if (!parent) {
    throw new ParentTransactionNotFoundError(input.parentTransactionId)
  }
  assertParentCanHaveSplits(input.parentTransactionId)
  if (input.splits.length < 2) {
    throw new Error('Transaction splits require at least 2 rows')
  }

  const normalizedSplits = normalizeSplits(input.splits, parent.currency ?? 'USD')
  assertSplitTotalMatchesParent(parent.amount, normalizedSplits)

  const now = Math.floor(Date.now() / 1000)
  const splitGroupId = `split:${input.parentTransactionId}`
  const createdFrom = input.createdFrom?.trim() || DEFAULT_SPLIT_CREATED_FROM
  const rows = normalizedSplits.map((split, index) => ({
    id: splitRowId(input.parentTransactionId, index),
    parentTransactionId: input.parentTransactionId,
    splitGroupId,
    amount: split.amount,
    currency: split.currency,
    ledgerAccount: split.ledgerAccount,
    memo: split.memo,
    notes: split.notes,
    sortOrder: index,
    createdFrom,
    createdAt: now,
    updatedAt: now,
  }))

  let storedRows: TransactionSplitRecord[] = []
  sqlite.transaction((transactionRows: typeof rows) => {
    const beforeRows = selectTransactionSplits(input.parentTransactionId)
    deleteSplits.run(input.parentTransactionId)
    for (const row of transactionRows) {
      insertSplit.run(
        row.id,
        row.parentTransactionId,
        row.splitGroupId,
        row.amount,
        row.currency,
        row.ledgerAccount,
        row.memo,
        row.notes,
        row.sortOrder,
        row.createdFrom,
        row.createdAt,
        row.updatedAt,
      )
    }
    storedRows = selectTransactionSplits(input.parentTransactionId)
    recordSplitAudit({
      parentTransactionId: input.parentTransactionId,
      beforeRows,
      afterRows: storedRows,
      audit: input.audit,
      timestamp: now,
    })
  })(rows)

  return storedRows
}

export function clearTransactionSplits(
  parentTransactionId: string,
  audit?: TransactionSplitAuditMetadata,
): TransactionSplitRecord[] {
  const parent = getParentTransaction(parentTransactionId)
  if (!parent) {
    throw new ParentTransactionNotFoundError(parentTransactionId)
  }

  let storedRows: TransactionSplitRecord[] = []
  const now = Math.floor(Date.now() / 1000)

  sqlite.transaction(() => {
    const beforeRows = selectTransactionSplits(parentTransactionId)
    deleteSplits.run(parentTransactionId)
    storedRows = selectTransactionSplits(parentTransactionId)
    recordSplitAudit({
      parentTransactionId,
      beforeRows,
      afterRows: storedRows,
      audit,
      timestamp: now,
    })
  })()

  return storedRows
}

export function hasTransactionSplits(parentTransactionId: string): boolean {
  const row = sqlite.prepare(`
    SELECT 1 AS value
    FROM transaction_splits
    WHERE parent_transaction_id = ?
    LIMIT 1
  `).get(parentTransactionId) as { value: number } | undefined

  return Boolean(row)
}

function getParentTransaction(parentTransactionId: string): ParentTransactionRow | undefined {
  return parentSelect.get(parentTransactionId) as ParentTransactionRow | undefined
}

function selectTransactionSplits(parentTransactionId: string): TransactionSplitRecord[] {
  return selectSplits.all(parentTransactionId) as TransactionSplitRecord[]
}

function assertParentTransactionExists(parentTransactionId: string): void {
  if (!getParentTransaction(parentTransactionId)) {
    throw new ParentTransactionNotFoundError(parentTransactionId)
  }
}

function assertParentCanHaveSplits(parentTransactionId: string): void {
  const confirmedTransfer = sqlite.prepare(`
    SELECT id
    FROM transfer_matches
    WHERE status = 'confirmed'
      AND (outflow_transaction_id = ? OR inflow_transaction_id = ?)
    LIMIT 1
  `).get(parentTransactionId, parentTransactionId) as { id: number } | undefined

  if (confirmedTransfer) {
    throw new TransactionSplitConflictError(
      `Transaction ${parentTransactionId} is part of confirmed transfer match ${confirmedTransfer.id}; clear the transfer before adding split postings`,
    )
  }
}

function splitAuditSnapshot(rows: TransactionSplitRecord[]): TransactionSplitAuditSnapshot[] {
  return rows.map(row => ({
    id: row.id,
    splitGroupId: row.splitGroupId,
    amount: row.amount,
    currency: row.currency,
    ledgerAccount: row.ledgerAccount,
    memo: row.memo,
    notes: row.notes,
    sortOrder: row.sortOrder,
    createdFrom: row.createdFrom,
  }))
}

function splitAuditOperation(
  beforeSplits: TransactionSplitAuditSnapshot[],
  afterSplits: TransactionSplitAuditSnapshot[],
): TransactionSplitAuditOperation {
  if (beforeSplits.length === 0 && afterSplits.length > 0) return 'split_create'
  if (beforeSplits.length > 0 && afterSplits.length === 0) return 'split_delete'
  return 'split_update'
}

function auditActor(audit: TransactionSplitAuditMetadata | undefined): string {
  const trimmed = audit?.actor?.trim()
  return trimmed || 'local'
}

function auditReason(
  audit: TransactionSplitAuditMetadata | undefined,
  operation: TransactionSplitAuditOperation,
): string {
  const trimmed = audit?.reason?.trim()
  return trimmed || operation
}

function recordSplitAudit(input: {
  parentTransactionId: string
  beforeRows: TransactionSplitRecord[]
  afterRows: TransactionSplitRecord[]
  audit?: TransactionSplitAuditMetadata
  timestamp: number
}): void {
  const beforeSplits = splitAuditSnapshot(input.beforeRows)
  const afterSplits = splitAuditSnapshot(input.afterRows)
  if (JSON.stringify(beforeSplits) === JSON.stringify(afterSplits)) return

  const operation = splitAuditOperation(beforeSplits, afterSplits)
  insertSplitAudit.run(
    input.parentTransactionId,
    auditActor(input.audit),
    auditReason(input.audit, operation),
    JSON.stringify([operation, 'splits']),
    JSON.stringify({ operation, splits: beforeSplits }),
    JSON.stringify({ operation, splits: afterSplits }),
    input.timestamp,
  )
}

function normalizeSplits(
  splits: TransactionSplitInput[],
  parentCurrency: string,
): NormalizedSplitInput[] {
  const fallbackCurrency = normalizeCurrency(parentCurrency || 'USD', 'parent account')
  const normalized = splits.map((split, index) => {
    const ledgerAccount = split.ledgerAccount.trim()
    if (!ledgerAccount) {
      throw new Error(`Split ${index + 1} ledgerAccount is required`)
    }

    const currency = split.currency === undefined
      ? fallbackCurrency
      : normalizeCurrency(split.currency, `Split ${index + 1}`)
    if (currency !== fallbackCurrency) {
      throw new Error(`Split ${index + 1} currency must match parent transaction currency ${fallbackCurrency}`)
    }

    return {
      amount: split.amount,
      currency,
      ledgerAccount,
      memo: split.memo ?? null,
      notes: split.notes ?? null,
      parsedAmount: parseDecimalString(split.amount, `Split ${index + 1} amount`),
    }
  })

  const currencies = new Set(normalized.map(split => split.currency))
  if (currencies.size > 1) {
    throw new Error('Split currencies must all match')
  }

  return normalized
}

function assertSplitTotalMatchesParent(
  parentAmount: string,
  splits: NormalizedSplitInput[],
): void {
  const parent = parseDecimalString(parentAmount, 'Parent transaction amount')
  const scale = Math.max(parent.scale, ...splits.map(split => split.parsedAmount.scale))
  const parentValue = scaleDecimal(parent, scale)
  const splitValue = splits.reduce(
    (total, split) => total + scaleDecimal(split.parsedAmount, scale),
    BigInt(0),
  )

  if (splitValue !== parentValue) {
    throw new Error('Split amounts must sum exactly to parent transaction amount')
  }
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

function normalizeCurrency(value: string, label: string): string {
  const currency = value.trim().toUpperCase()
  if (!currency) {
    throw new Error(`${label} currency is required`)
  }
  return currency
}

function splitRowId(parentTransactionId: string, sortOrder: number): string {
  return `split:${parentTransactionId}:${sortOrder}`
}
