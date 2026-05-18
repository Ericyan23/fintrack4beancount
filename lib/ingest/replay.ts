import { randomUUID } from 'crypto'
import { sqlite } from '../db'

type SqliteDatabase = import('better-sqlite3').Database

export interface ReplayImportRunResult {
  sourceImportRunId: string
  importRunId: string
  rawReplayed: number
  stagedReplayed: number
  skippedStagedRows: number
  itemCount: number
}

export interface ReplayImportRunInput {
  importRunId: string
  actor?: string | null
  reason?: string | null
}

export class ImportRunReplayNotFoundError extends Error {
  constructor(importRunId: string) {
    super(`Import run not found: ${importRunId}`)
    this.name = 'ImportRunReplayNotFoundError'
  }
}

export class ImportRunReplayConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportRunReplayConflictError'
  }
}

interface ImportRunRow {
  id: string
  sourceConnectionId: string | null
  importProfileId: string | null
  status: string
}

interface RawImportItemRow {
  id: string
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string
  rawPayload: string
  contentHash: string | null
  status: string
  receivedAt: number | null
}

interface StagedTransactionRow {
  id: string
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
  currency: string | null
  description: string | null
  pending: number
  status: string
  category: string | null
  notes: string | null
  tags: string | null
  normalizedPayload: string | null
  validationErrors: string | null
  normalizerVersion: string | null
  reconciliationStatus: string | null
  reconciliationTransactionId: string | null
  reconciliationReason: string | null
}

interface ExistingTransactionRow {
  id: string
}

interface SourceAccountMappingRow {
  fintrackAccountId: string | null
}

const FINAL_STAGED_STATUSES = new Set(['ignored', 'deleted'])

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function present(value: string | null): value is string {
  return value !== null && value.trim() !== ''
}

function auditText(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function selectImportRun(database: SqliteDatabase, importRunId: string): ImportRunRow | null {
  const row = database.prepare(`
    SELECT
      id,
      source_connection_id AS sourceConnectionId,
      import_profile_id AS importProfileId,
      status
    FROM import_runs
    WHERE id = ?
  `).get(importRunId) as ImportRunRow | undefined

  return row ?? null
}

function selectRawItems(database: SqliteDatabase, importRunId: string): RawImportItemRow[] {
  return database.prepare(`
    SELECT
      id,
      source_account_id AS sourceAccountId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      raw_payload AS rawPayload,
      content_hash AS contentHash,
      status,
      received_at AS receivedAt
    FROM raw_import_items
    WHERE import_run_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(importRunId) as RawImportItemRow[]
}

function selectStagedRows(database: SqliteDatabase, importRunId: string): StagedTransactionRow[] {
  return database.prepare(`
    SELECT
      id,
      raw_item_id AS rawItemId,
      source_connection_id AS sourceConnectionId,
      source_account_id AS sourceAccountId,
      account_id AS accountId,
      transaction_id AS transactionId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      posted,
      transacted_at AS transactedAt,
      amount,
      currency,
      description,
      pending,
      status,
      category,
      notes,
      tags,
      normalized_payload AS normalizedPayload,
      validation_errors AS validationErrors,
      normalizer_version AS normalizerVersion,
      reconciliation_status AS reconciliationStatus,
      reconciliation_transaction_id AS reconciliationTransactionId,
      reconciliation_reason AS reconciliationReason
    FROM staged_transactions
    WHERE import_run_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(importRunId) as StagedTransactionRow[]
}

function currentMappedAccountId(database: SqliteDatabase, sourceAccountId: string | null): string | null {
  if (!sourceAccountId) return null
  const row = database.prepare(`
    SELECT fintrack_account_id AS fintrackAccountId
    FROM source_accounts
    WHERE id = ?
  `).get(sourceAccountId) as SourceAccountMappingRow | undefined

  return row?.fintrackAccountId ?? null
}

function selectExistingTransaction(database: SqliteDatabase, row: StagedTransactionRow): ExistingTransactionRow | null {
  if (present(row.sourceConnectionId) && present(row.sourceItemKey)) {
    const bySourceItem = database.prepare(`
      SELECT id
      FROM transactions
      WHERE source_connection_id = ?
        AND source_item_key = ?
      LIMIT 1
    `).get(row.sourceConnectionId, row.sourceItemKey) as ExistingTransactionRow | undefined

    if (bySourceItem) return bySourceItem
  }

  if (!present(row.transactionId)) return null
  return database.prepare(`
    SELECT id
    FROM transactions
    WHERE id = ?
    LIMIT 1
  `).get(row.transactionId) as ExistingTransactionRow | undefined ?? null
}

function requiredValidationErrors(row: StagedTransactionRow, accountId: string | null): string[] {
  const missing: string[] = []
  if (!present(accountId)) missing.push('account_id')
  if (!present(row.sourceConnectionId)) missing.push('source_connection_id')
  if (!present(row.sourceAccountId)) missing.push('source_account_id')
  if (!present(row.sourceItemKey)) missing.push('source_item_key')
  if (row.posted === null) missing.push('posted')
  if (!present(row.amount)) missing.push('amount')
  if (!present(row.description)) missing.push('description')
  return missing.map(field => `Missing required field: ${field}`)
}

function replayedActiveStatus(sourceStatus: string, validationErrors: string[]): string {
  if (validationErrors.length > 0) return 'error'
  if (sourceStatus === 'staged') return 'staged'
  return 'ready'
}

function replayedRawStatus(stagedStatus: string, validationErrors: string[]): string {
  if (stagedStatus === 'ignored' || stagedStatus === 'deleted') return 'ignored'
  if (validationErrors.length > 0 || stagedStatus === 'error') return 'error'
  return 'staged'
}

export function replayImportRun(input: ReplayImportRunInput): ReplayImportRunResult {
  return sqlite.transaction(() => {
    const sourceRun = selectImportRun(sqlite, input.importRunId)
    if (!sourceRun) throw new ImportRunReplayNotFoundError(input.importRunId)
    if (sourceRun.status === 'running' || sourceRun.status === 'pending') {
      throw new ImportRunReplayConflictError(`Cannot replay ${sourceRun.status} import run: ${input.importRunId}`)
    }

    const rawRows = selectRawItems(sqlite, input.importRunId)
    if (rawRows.length === 0) {
      throw new ImportRunReplayConflictError(`Import run has no raw items to replay: ${input.importRunId}`)
    }

    const stagedRows = selectStagedRows(sqlite, input.importRunId)
    const timestamp = nowSeconds()
    const importRunId = randomUUID()

    sqlite.prepare(`
      INSERT INTO import_runs (
        id,
        source_connection_id,
        import_profile_id,
        status,
        started_at,
        finished_at,
        item_count,
        error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'running', ?, NULL, 0, NULL, ?, ?)
    `).run(
      importRunId,
      sourceRun.sourceConnectionId,
      sourceRun.importProfileId,
      timestamp,
      timestamp,
      timestamp,
    )

    const rawIdMap = new Map<string, string>()
    const stagedByRawId = new Map<string, StagedTransactionRow[]>()
    for (const row of stagedRows) {
      if (!row.rawItemId) continue
      stagedByRawId.set(row.rawItemId, [...(stagedByRawId.get(row.rawItemId) ?? []), row])
    }

    const insertRaw = sqlite.prepare(`
      INSERT INTO raw_import_items (
        id,
        import_run_id,
        source_account_id,
        external_id,
        source_item_key,
        raw_payload,
        content_hash,
        status,
        received_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const row of rawRows) {
      const newRawId = randomUUID()
      const firstStaged = stagedByRawId.get(row.id)?.[0]
      const rawStatus = firstStaged
        ? replayedRawStatus(firstStaged.status, requiredValidationErrors(
            firstStaged,
            currentMappedAccountId(sqlite, firstStaged.sourceAccountId) ?? firstStaged.accountId,
          ))
        : row.status

      insertRaw.run(
        newRawId,
        importRunId,
        row.sourceAccountId,
        row.externalId,
        row.sourceItemKey,
        row.rawPayload,
        row.contentHash,
        rawStatus,
        row.receivedAt,
        timestamp,
        timestamp,
      )
      rawIdMap.set(row.id, newRawId)
    }

    const insertStaged = sqlite.prepare(`
      INSERT INTO staged_transactions (
        id,
        import_run_id,
        raw_item_id,
        source_connection_id,
        source_account_id,
        account_id,
        transaction_id,
        external_id,
        source_item_key,
        posted,
        transacted_at,
        amount,
        currency,
        description,
        pending,
        status,
        category,
        notes,
        tags,
        normalized_payload,
        validation_errors,
        normalizer_version,
        reconciliation_status,
        reconciliation_transaction_id,
        reconciliation_reason,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let stagedReplayed = 0
    let skippedStagedRows = 0
    for (const row of stagedRows) {
      const newRawId = row.rawItemId ? rawIdMap.get(row.rawItemId) ?? null : null
      const mappedAccountId = currentMappedAccountId(sqlite, row.sourceAccountId) ?? row.accountId
      const existingTransaction = selectExistingTransaction(sqlite, row)
      const validationErrors = FINAL_STAGED_STATUSES.has(row.status) || existingTransaction
        ? []
        : requiredValidationErrors(row, mappedAccountId)
      const status = FINAL_STAGED_STATUSES.has(row.status)
        ? row.status
        : existingTransaction
          ? 'merged'
          : replayedActiveStatus(row.status, validationErrors)
      const transactionId = existingTransaction?.id ?? (
        status === 'merged' && present(row.transactionId) ? row.transactionId : null
      )

      if (row.rawItemId && !newRawId) {
        skippedStagedRows += 1
        continue
      }

      insertStaged.run(
        randomUUID(),
        importRunId,
        newRawId,
        row.sourceConnectionId,
        row.sourceAccountId,
        mappedAccountId,
        transactionId,
        row.externalId,
        row.sourceItemKey,
        row.posted,
        row.transactedAt,
        row.amount,
        row.currency,
        row.description,
        row.pending,
        status,
        row.category,
        row.notes,
        row.tags,
        row.normalizedPayload,
        JSON.stringify(validationErrors),
        row.normalizerVersion,
        row.reconciliationStatus,
        row.reconciliationTransactionId,
        row.reconciliationReason,
        timestamp,
        timestamp,
      )
      stagedReplayed += 1
    }

    sqlite.prepare(`
      UPDATE import_runs
      SET status = 'completed',
          finished_at = ?,
          item_count = ?,
          error = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      timestamp,
      rawRows.length,
      skippedStagedRows > 0 ? `${skippedStagedRows} staged row(s) skipped during replay` : null,
      timestamp,
      importRunId,
    )

    const result: ReplayImportRunResult = {
      sourceImportRunId: sourceRun.id,
      importRunId,
      rawReplayed: rawRows.length,
      stagedReplayed,
      skippedStagedRows,
      itemCount: rawRows.length,
    }

    sqlite.prepare(`
      INSERT INTO audit_log (
        entity_type,
        entity_id,
        action,
        actor,
        reason,
        before_values,
        after_values,
        metadata,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'import_run',
      importRunId,
      'import_run_replay',
      auditText(input.actor, 'local'),
      auditText(input.reason, 'import_run_replay'),
      JSON.stringify({}),
      JSON.stringify({ importRun: result }),
      JSON.stringify({
        sourceImportRunId: sourceRun.id,
        sourceConnectionId: sourceRun.sourceConnectionId,
        importProfileId: sourceRun.importProfileId,
      }),
      timestamp,
    )

    return result
  })()
}
