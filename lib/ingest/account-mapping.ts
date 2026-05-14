import { sqlite } from '../db'

type SqliteDatabase = import('better-sqlite3').Database

export interface ListImportRunSourceAccountsInput {
  importRunId: string
}

export interface UpdateSourceAccountMappingInput {
  importRunId: string
  sourceAccountId: string
  accountId: string | null
}

export interface SourceAccountMapping {
  id: string
  externalAccountId: string
  name: string | null
  currency: string | null
  fintrackAccountId: string | null
  fintrackAccountName: string | null
  stagedCount: number
  errorCount: number
}

export class ImportRunNotFoundError extends Error {
  constructor() {
    super('Import run not found')
    this.name = 'ImportRunNotFoundError'
  }
}

export class SourceAccountNotFoundInRunError extends Error {
  constructor() {
    super('Source account not found')
    this.name = 'SourceAccountNotFoundInRunError'
  }
}

export class AccountNotFoundError extends Error {
  constructor() {
    super('Account not found')
    this.name = 'AccountNotFoundError'
  }
}

interface ExistsRow {
  value: number
}

interface StagedRequiredRow {
  id: string
  accountId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  sourceItemKey: string | null
  posted: number | null
  amount: string | null
  description: string | null
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function importRunExists(database: SqliteDatabase, importRunId: string): boolean {
  const row = database.prepare(`
    SELECT 1 AS value
    FROM import_runs
    WHERE id = ?
  `).get(importRunId) as ExistsRow | undefined

  return Boolean(row)
}

function accountExists(database: SqliteDatabase, accountId: string): boolean {
  const row = database.prepare(`
    SELECT 1 AS value
    FROM accounts
    WHERE id = ?
  `).get(accountId) as ExistsRow | undefined

  return Boolean(row)
}

function requireImportRun(database: SqliteDatabase, importRunId: string): void {
  if (!importRunExists(database, importRunId)) throw new ImportRunNotFoundError()
}

function present(value: string | null): value is string {
  return value !== null && value.trim() !== ''
}

function missingRequiredFields(row: StagedRequiredRow): string[] {
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

function requiredValidationErrors(row: StagedRequiredRow): string[] {
  return missingRequiredFields(row).map(field => `Missing required field: ${field}`)
}

function sourceAccountQuery(filterBySourceAccount: boolean): string {
  const sourceAccountFilter = filterBySourceAccount ? 'WHERE sa.id = ?' : ''

  return `
    WITH run_source_accounts AS (
      SELECT source_account_id AS id
      FROM raw_import_items
      WHERE import_run_id = ?
        AND source_account_id IS NOT NULL
      UNION
      SELECT source_account_id AS id
      FROM staged_transactions
      WHERE import_run_id = ?
        AND source_account_id IS NOT NULL
    ),
    staged_counts AS (
      SELECT
        source_account_id AS id,
        COUNT(*) AS stagedCount,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errorCount
      FROM staged_transactions
      WHERE import_run_id = ?
        AND source_account_id IS NOT NULL
      GROUP BY source_account_id
    )
    SELECT
      sa.id,
      sa.external_account_id AS externalAccountId,
      sa.name,
      sa.currency,
      sa.fintrack_account_id AS fintrackAccountId,
      accounts.name AS fintrackAccountName,
      COALESCE(staged_counts.stagedCount, 0) AS stagedCount,
      COALESCE(staged_counts.errorCount, 0) AS errorCount
    FROM run_source_accounts
    INNER JOIN source_accounts sa
      ON sa.id = run_source_accounts.id
    LEFT JOIN accounts
      ON accounts.id = sa.fintrack_account_id
    LEFT JOIN staged_counts
      ON staged_counts.id = sa.id
    ${sourceAccountFilter}
    ORDER BY COALESCE(sa.name, sa.external_account_id) ASC, sa.id ASC
  `
}

function selectImportRunSourceAccount(
  database: SqliteDatabase,
  importRunId: string,
  sourceAccountId: string,
): SourceAccountMapping | null {
  const row = database.prepare(sourceAccountQuery(true))
    .get(importRunId, importRunId, importRunId, sourceAccountId) as SourceAccountMapping | undefined

  return row ?? null
}

function recalculateStagedValidation(
  database: SqliteDatabase,
  sourceAccountId: string,
  timestamp: number,
): void {
  const rows = database.prepare(`
    SELECT
      id,
      account_id AS accountId,
      source_connection_id AS sourceConnectionId,
      source_account_id AS sourceAccountId,
      source_item_key AS sourceItemKey,
      posted,
      amount,
      description
    FROM staged_transactions
    WHERE source_account_id = ?
      AND status NOT IN ('ignored', 'deleted', 'merged')
    ORDER BY created_at ASC, id ASC
  `).all(sourceAccountId) as StagedRequiredRow[]

  const update = database.prepare(`
    UPDATE staged_transactions
    SET status = ?,
        validation_errors = ?,
        updated_at = ?
    WHERE id = ?
  `)

  for (const row of rows) {
    const errors = requiredValidationErrors(row)
    update.run(errors.length > 0 ? 'error' : 'ready', JSON.stringify(errors), timestamp, row.id)
  }
}

export function listImportRunSourceAccounts(
  input: ListImportRunSourceAccountsInput,
  database: SqliteDatabase = sqlite,
): SourceAccountMapping[] {
  requireImportRun(database, input.importRunId)

  return database.prepare(sourceAccountQuery(false))
    .all(input.importRunId, input.importRunId, input.importRunId) as SourceAccountMapping[]
}

export function updateSourceAccountMapping(
  input: UpdateSourceAccountMappingInput,
  database: SqliteDatabase = sqlite,
): SourceAccountMapping {
  requireImportRun(database, input.importRunId)

  if (!selectImportRunSourceAccount(database, input.importRunId, input.sourceAccountId)) {
    throw new SourceAccountNotFoundInRunError()
  }
  if (input.accountId !== null && !accountExists(database, input.accountId)) {
    throw new AccountNotFoundError()
  }

  const timestamp = nowSeconds()

  return database.transaction(() => {
    database.prepare(`
      UPDATE source_accounts
      SET fintrack_account_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(input.accountId, timestamp, input.sourceAccountId)

    database.prepare(`
      UPDATE staged_transactions
      SET account_id = ?,
          updated_at = ?
      WHERE source_account_id = ?
        AND status NOT IN ('ignored', 'deleted', 'merged')
    `).run(input.accountId, timestamp, input.sourceAccountId)

    recalculateStagedValidation(database, input.sourceAccountId, timestamp)

    const updated = selectImportRunSourceAccount(database, input.importRunId, input.sourceAccountId)
    if (!updated) throw new SourceAccountNotFoundInRunError()

    return updated
  })()
}
