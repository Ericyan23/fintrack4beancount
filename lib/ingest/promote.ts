import { createHash } from 'crypto'
import { sqlite } from '../db'
import { classifyNewTransactions } from '@/lib/classify/rules'

type SqliteDatabase = import('better-sqlite3').Database

export interface PromoteStagedTransactionsInput {
  importRunId: string
  stagedTransactionIds?: string[]
}

export interface PromoteStagedTransactionsResult {
  promoted: number
  skipped: number
  enriched: number
  errors: Array<{ stagedTransactionId: string; error: string }>
}

export class ImportRunNotPromotableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportRunNotPromotableError'
  }
}

type CanonicalTransactionStatus = 'pending' | 'posted' | 'cancelled'

interface ImportRunStatusRow {
  status: string
}

interface StagedTransactionRow {
  id: string
  importRunId: string | null
  rawItemId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  accountId: string | null
  transactionId: string | null
  externalId: string | null
  sourceItemKey: string | null
  posted: number | null
  transactedAt: number | null
  amount: string | null
  description: string | null
  pending: number
  status: string
  category: string | null
  notes: string | null
  tags: string | null
  normalizedPayload: string | null
  normalizerVersion: string | null
  reconciliationStatus: string | null
  reconciliationTransactionId: string | null
  reconciliationReason: string | null
  source: string | null
}

interface ExistingTransactionRow {
  id: string
}

interface RequiredStagedTransactionRow extends StagedTransactionRow {
  accountId: string
  sourceConnectionId: string
  sourceAccountId: string
  sourceItemKey: string
  posted: number
  amount: string
  description: string
}

const PROMOTABLE_STATUSES = new Set(['staged', 'ready'])

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function canonicalTransactionId(sourceConnectionId: string, sourceItemKey: string): string {
  const hash = createHash('sha256')
    .update(`${sourceConnectionId}\0${sourceItemKey}`)
    .digest('hex')

  return `txn:ingest:${hash.slice(0, 32)}`
}

function present(value: string | null): value is string {
  return value !== null && value.trim() !== ''
}

function validateRequiredFields(row: StagedTransactionRow): string[] {
  const missing: string[] = []

  if (!present(row.accountId)) missing.push('account_id')
  if (!present(row.sourceConnectionId)) missing.push('source_connection_id')
  if (!present(row.sourceAccountId)) missing.push('source_account_id')
  if (!present(row.sourceItemKey)) missing.push('source_item_key')
  if (row.posted === null) missing.push('posted')
  if (!present(row.amount)) missing.push('amount')
  if (!present(row.description)) missing.push('description')

  return missing
}

function requirePromotable(row: StagedTransactionRow): RequiredStagedTransactionRow {
  const missing = validateRequiredFields(row)
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`)
  }

  return row as RequiredStagedTransactionRow
}

function requireCompletedImportRun(database: SqliteDatabase, importRunId: string): void {
  const row = database.prepare(`
    SELECT status
    FROM import_runs
    WHERE id = ?
  `).get(importRunId) as ImportRunStatusRow | undefined

  if (!row) {
    throw new ImportRunNotPromotableError(`Import run not found: ${importRunId}`)
  }
  if (row.status !== 'completed') {
    throw new ImportRunNotPromotableError(`Import run must be completed before promote: ${row.status}`)
  }
}

function selectStagedRows(
  database: SqliteDatabase,
  input: PromoteStagedTransactionsInput,
): StagedTransactionRow[] {
  if (input.stagedTransactionIds?.length === 0) return []

  const idFilter = input.stagedTransactionIds
    ? `AND st.id IN (${input.stagedTransactionIds.map(() => '?').join(', ')})`
    : ''

  return database.prepare(`
    SELECT
      st.id,
      st.import_run_id AS importRunId,
      st.raw_item_id AS rawItemId,
      st.source_connection_id AS sourceConnectionId,
      st.source_account_id AS sourceAccountId,
      st.account_id AS accountId,
      st.external_id AS externalId,
      st.source_item_key AS sourceItemKey,
      st.posted,
      st.transacted_at AS transactedAt,
      st.amount,
      st.description,
      st.pending,
      st.status,
      st.category,
      st.notes,
      st.tags,
      st.normalized_payload AS normalizedPayload,
      st.normalizer_version AS normalizerVersion,
      st.reconciliation_status AS reconciliationStatus,
      st.reconciliation_transaction_id AS reconciliationTransactionId,
      st.reconciliation_reason AS reconciliationReason,
      sources.kind AS source
    FROM staged_transactions st
    LEFT JOIN source_connections sc
      ON sc.id = st.source_connection_id
    LEFT JOIN sources
      ON sources.id = sc.source_id
    WHERE st.import_run_id = ?
      ${idFilter}
    ORDER BY st.created_at ASC, st.id ASC
  `).all(input.importRunId, ...(input.stagedTransactionIds ?? [])) as StagedTransactionRow[]
}

function transactionStatus(row: StagedTransactionRow): CanonicalTransactionStatus {
  if (row.normalizedPayload) {
    try {
      const payload = JSON.parse(row.normalizedPayload) as { status?: unknown }
      if (payload.status === 'pending' || payload.status === 'posted' || payload.status === 'cancelled') {
        return payload.status
      }
    } catch {
      // Fall back to the staged pending flag when legacy payloads are malformed.
    }
  }

  return row.pending ? 'pending' : 'posted'
}

function selectExistingTransaction(
  database: SqliteDatabase,
  sourceConnectionId: string,
  sourceItemKey: string,
): ExistingTransactionRow | null {
  return database.prepare(`
    SELECT id
    FROM transactions
    WHERE source_connection_id = ?
      AND source_item_key = ?
    LIMIT 1
  `).get(sourceConnectionId, sourceItemKey) as ExistingTransactionRow | undefined ?? null
}

function markStagedMerged(
  database: SqliteDatabase,
  stagedTransactionId: string,
  transactionId: string,
  timestamp: number,
): void {
  database.prepare(`
    UPDATE staged_transactions
    SET status = 'merged',
        transaction_id = ?,
        updated_at = ?
    WHERE id = ?
  `).run(transactionId, timestamp, stagedTransactionId)
}

interface PromoteRowResult {
  status: 'promoted' | 'skipped'
  transactionId?: string
}

function promotePendingMatch(
  database: SqliteDatabase,
  row: RequiredStagedTransactionRow,
  timestamp: number,
): PromoteRowResult {
  const transactionId = row.reconciliationTransactionId ?? row.transactionId
  if (!present(transactionId)) {
    throw new Error('Missing pending reconciliation transaction id')
  }

  const status = transactionStatus(row)
  if (status !== 'posted') {
    throw new Error(`Pending reconciliation requires posted status, got ${status}`)
  }

  const result = database.prepare(`
    UPDATE transactions
    SET
      source_connection_id = ?,
      source_account_id = ?,
      external_id = ?,
      source_item_key = ?,
      import_run_id = ?,
      raw_item_id = ?,
      normalizer_version = ?,
      source = ?,
      posted = ?,
      transacted_at = ?,
      amount = ?,
      description = ?,
      pending = 0,
      status = 'posted',
      category = CASE WHEN category = ledger_account THEN NULL ELSE category END,
      ledger_account = COALESCE(?, ledger_account),
      review_status = CASE
        WHEN ? IS NOT NULL THEN 'reviewed'
        ELSE COALESCE(review_status, 'needs_review')
      END,
      notes = COALESCE(?, notes),
      tags = COALESCE(?, tags),
      updated_at = ?
    WHERE id = ?
      AND pending = 1
      AND status = 'pending'
  `).run(
    row.sourceConnectionId,
    row.sourceAccountId,
    row.externalId,
    row.sourceItemKey,
    row.importRunId,
    row.rawItemId,
    row.normalizerVersion,
    row.source ?? 'ingest',
    row.posted,
    row.transactedAt,
    row.amount,
    row.description,
    row.category,
    row.category,
    row.notes,
    row.tags,
    timestamp,
    transactionId,
  )

  if (result.changes === 0) {
    throw new Error(`Pending transaction not found or no longer pending: ${transactionId}`)
  }

  markStagedMerged(database, row.id, transactionId, timestamp)
  return { status: 'promoted', transactionId }
}

function promoteRow(database: SqliteDatabase, row: StagedTransactionRow): PromoteRowResult {
  if (!PROMOTABLE_STATUSES.has(row.status)) {
    return { status: 'skipped' }
  }

  const promotable = requirePromotable(row)
  const timestamp = nowSeconds()

  return database.transaction((): PromoteRowResult => {
    if (promotable.reconciliationStatus === 'pending_matched_to_posted') {
      return promotePendingMatch(database, promotable, timestamp)
    }

    const existing = selectExistingTransaction(
      database,
      promotable.sourceConnectionId,
      promotable.sourceItemKey,
    )

    if (existing) {
      markStagedMerged(database, promotable.id, existing.id, timestamp)
      return { status: 'skipped' }
    }

    const transactionId = canonicalTransactionId(
      promotable.sourceConnectionId,
      promotable.sourceItemKey,
    )
    const status = transactionStatus(promotable)

    database.prepare(`
      INSERT INTO transactions
        (id, account_id, source_connection_id, source_account_id, external_id,
         source_item_key, import_run_id, raw_item_id, normalizer_version, source,
         posted, transacted_at, amount, description, pending, status, category,
         suggested_cat, ledger_account, review_status, notes, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId,
      promotable.accountId,
      promotable.sourceConnectionId,
      promotable.sourceAccountId,
      promotable.externalId,
      promotable.sourceItemKey,
      promotable.importRunId,
      promotable.rawItemId,
      promotable.normalizerVersion,
      promotable.source ?? 'ingest',
      promotable.posted,
      promotable.transactedAt,
      promotable.amount,
      promotable.description,
      status === 'pending' ? 1 : 0,
      status,
      promotable.category,
      promotable.category ? 'reviewed' : 'needs_review',
      promotable.notes,
      promotable.tags,
      timestamp,
      timestamp,
    )

    markStagedMerged(database, promotable.id, transactionId, timestamp)

    return { status: 'promoted', transactionId }
  })()
}

export function promoteStagedTransactions(
  input: PromoteStagedTransactionsInput,
): PromoteStagedTransactionsResult {
  requireCompletedImportRun(sqlite, input.importRunId)

  const result: PromoteStagedTransactionsResult = {
    promoted: 0,
    skipped: 0,
    enriched: 0,
    errors: [],
  }

  const rows = selectStagedRows(sqlite, input)
  const promotedTransactionIds: string[] = []

  for (const row of rows) {
    try {
      const promoted = promoteRow(sqlite, row)
      if (promoted.status === 'promoted') {
        result.promoted += 1
        if (promoted.transactionId) promotedTransactionIds.push(promoted.transactionId)
      } else {
        result.skipped += 1
      }
    } catch (error) {
      result.errors.push({
        stagedTransactionId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  result.enriched = classifyNewTransactions(promotedTransactionIds)

  return result
}
