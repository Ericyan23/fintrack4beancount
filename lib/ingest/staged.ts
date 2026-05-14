import { sqlite } from '../db'
import type { StagedTransactionStatus } from './types'

type SqliteDatabase = import('better-sqlite3').Database

export interface UpdateStagedTransactionInput {
  importRunId: string
  stagedTransactionId: string
  patch: {
    accountId?: string | null
    posted?: number | null
    amount?: string | null
    description?: string | null
    category?: string | null
    notes?: string | null
    tags?: string[] | null
    pending?: boolean
  }
}

export interface StagedTransactionMutationResult {
  id: string
  status: 'staged' | 'ready' | 'merged' | 'ignored' | 'deleted' | 'error'
  validationErrors: string[]
  updatedAt: number
}

export class StagedTransactionNotFoundError extends Error {
  constructor(importRunId: string, stagedTransactionId: string) {
    super(`Staged transaction not found: ${stagedTransactionId} in import run ${importRunId}`)
    this.name = 'StagedTransactionNotFoundError'
  }
}

export class StagedTransactionConflictError extends Error {
  constructor(stagedTransactionId: string, status: StagedTransactionStatus) {
    super(`Cannot mutate ${status} staged transaction: ${stagedTransactionId}`)
    this.name = 'StagedTransactionConflictError'
  }
}

export class StagedTransactionInvalidInputError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'StagedTransactionInvalidInputError'
  }
}

interface StagedTransactionRow {
  id: string
  importRunId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  accountId: string | null
  sourceItemKey: string | null
  posted: number | null
  amount: string | null
  description: string | null
  pending: number
  status: StagedTransactionStatus
  category: string | null
  notes: string | null
  tags: string | null
  updatedAt: number
}

interface RequiredFieldValues {
  accountId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  sourceItemKey: string | null
  posted: number | null
  amount: string | null
  description: string | null
}

interface ScopedStagedTransactionInput {
  importRunId: string
  stagedTransactionId: string
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function present(value: string | null): value is string {
  return value !== null && value.trim() !== ''
}

function stringifyJson(value: string[] | null): string | null {
  if (value === null) return null
  return JSON.stringify(value)
}

function accountExists(database: SqliteDatabase, accountId: string): boolean {
  const row = database.prepare(`
    SELECT 1 AS value
    FROM accounts
    WHERE id = ?
  `).get(accountId) as { value: number } | undefined

  return Boolean(row)
}

function normalizeAccountId(value: string | null): string | null {
  if (value === null) return null

  const trimmed = value.trim()
  return trimmed || null
}

function validateRequiredFields(row: RequiredFieldValues): string[] {
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

function selectScopedStagedTransaction(
  database: SqliteDatabase,
  input: ScopedStagedTransactionInput,
): StagedTransactionRow | null {
  const row = database.prepare(`
    SELECT
      id,
      import_run_id AS importRunId,
      source_connection_id AS sourceConnectionId,
      source_account_id AS sourceAccountId,
      account_id AS accountId,
      source_item_key AS sourceItemKey,
      posted,
      amount,
      description,
      pending,
      status,
      category,
      notes,
      tags,
      updated_at AS updatedAt
    FROM staged_transactions
    WHERE id = ?
      AND import_run_id = ?
  `).get(input.stagedTransactionId, input.importRunId) as StagedTransactionRow | undefined

  return row ?? null
}

function requireMutableStagedTransaction(
  database: SqliteDatabase,
  input: ScopedStagedTransactionInput,
): StagedTransactionRow {
  const row = selectScopedStagedTransaction(database, input)
  if (!row) {
    throw new StagedTransactionNotFoundError(input.importRunId, input.stagedTransactionId)
  }
  if (row.status === 'merged') {
    throw new StagedTransactionConflictError(input.stagedTransactionId, row.status)
  }

  return row
}

function requireEditableStagedTransaction(
  database: SqliteDatabase,
  input: ScopedStagedTransactionInput,
): StagedTransactionRow {
  const row = requireMutableStagedTransaction(database, input)
  if (row.status === 'ignored' || row.status === 'deleted') {
    throw new StagedTransactionConflictError(input.stagedTransactionId, row.status)
  }

  return row
}

export function updateStagedTransaction(
  input: UpdateStagedTransactionInput,
): StagedTransactionMutationResult {
  return sqlite.transaction(() => {
    const row = requireEditableStagedTransaction(sqlite, input)
    const next = {
      accountId: input.patch.accountId === undefined ? row.accountId : normalizeAccountId(input.patch.accountId),
      posted: input.patch.posted === undefined ? row.posted : input.patch.posted,
      amount: input.patch.amount === undefined ? row.amount : input.patch.amount,
      description: input.patch.description === undefined ? row.description : input.patch.description,
      pending: input.patch.pending === undefined ? row.pending : input.patch.pending ? 1 : 0,
      category: input.patch.category === undefined ? row.category : input.patch.category,
      notes: input.patch.notes === undefined ? row.notes : input.patch.notes,
      tags: input.patch.tags === undefined ? row.tags : stringifyJson(input.patch.tags),
      sourceConnectionId: row.sourceConnectionId,
      sourceAccountId: row.sourceAccountId,
      sourceItemKey: row.sourceItemKey,
    }
    if (next.accountId !== null && !accountExists(sqlite, next.accountId)) {
      throw new StagedTransactionInvalidInputError(`Account not found: ${next.accountId}`)
    }
    const validationErrors = validateRequiredFields(next)
    const status: 'error' | 'ready' = validationErrors.length > 0 ? 'error' : 'ready'
    const updatedAt = nowSeconds()

    sqlite.prepare(`
      UPDATE staged_transactions
      SET account_id = ?,
          posted = ?,
          amount = ?,
          description = ?,
          pending = ?,
          category = ?,
          notes = ?,
          tags = ?,
          validation_errors = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
        AND import_run_id = ?
    `).run(
      next.accountId,
      next.posted,
      next.amount,
      next.description,
      next.pending,
      next.category,
      next.notes,
      next.tags,
      JSON.stringify(validationErrors),
      status,
      updatedAt,
      input.stagedTransactionId,
      input.importRunId,
    )

    return {
      id: row.id,
      status,
      validationErrors,
      updatedAt,
    }
  })()
}

function setStagedStatus(
  input: ScopedStagedTransactionInput,
  status: 'ignored' | 'deleted',
): StagedTransactionMutationResult {
  return sqlite.transaction(() => {
    const row = requireMutableStagedTransaction(sqlite, input)
    if (row.status === 'ignored' || row.status === 'deleted') {
      throw new StagedTransactionConflictError(input.stagedTransactionId, row.status)
    }
    const updatedAt = nowSeconds()

    sqlite.prepare(`
      UPDATE staged_transactions
      SET status = ?,
          validation_errors = ?,
          updated_at = ?
      WHERE id = ?
        AND import_run_id = ?
    `).run(
      status,
      JSON.stringify([]),
      updatedAt,
      input.stagedTransactionId,
      input.importRunId,
    )

    return {
      id: row.id,
      status,
      validationErrors: [],
      updatedAt,
    }
  })()
}

export function ignoreStagedTransaction(
  input: ScopedStagedTransactionInput,
): StagedTransactionMutationResult {
  return setStagedStatus(input, 'ignored')
}

export function deleteStagedTransaction(
  input: ScopedStagedTransactionInput,
): StagedTransactionMutationResult {
  return setStagedStatus(input, 'deleted')
}

export function restoreStagedTransaction(
  input: ScopedStagedTransactionInput,
): StagedTransactionMutationResult {
  return sqlite.transaction(() => {
    const row = selectScopedStagedTransaction(sqlite, input)
    if (!row) {
      throw new StagedTransactionNotFoundError(input.importRunId, input.stagedTransactionId)
    }
    if (row.status !== 'ignored' && row.status !== 'deleted') {
      throw new StagedTransactionConflictError(input.stagedTransactionId, row.status)
    }

    const validationErrors = validateRequiredFields(row)
    const status: 'error' | 'ready' = validationErrors.length > 0 ? 'error' : 'ready'
    const updatedAt = nowSeconds()

    sqlite.prepare(`
      UPDATE staged_transactions
      SET status = ?,
          validation_errors = ?,
          updated_at = ?
      WHERE id = ?
        AND import_run_id = ?
    `).run(
      status,
      JSON.stringify(validationErrors),
      updatedAt,
      input.stagedTransactionId,
      input.importRunId,
    )

    return {
      id: row.id,
      status,
      validationErrors,
      updatedAt,
    }
  })()
}
