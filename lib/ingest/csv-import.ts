import { createHash } from 'crypto'
import { sqlite } from '@/lib/db'
import {
  buildCsvSourceItemKey,
  normalizeCsvTransactions,
  type CsvImportMapping,
  type CsvNormalizedTransaction,
} from '@/lib/ingest/csv'
import { stableStringify } from '@/lib/ingest/identity'
import {
  createImportRun,
  ensureSource,
  ensureSourceAccount,
  ensureSourceConnection,
  finishImportRun,
  insertRawImportItem,
  insertStagedTransaction,
} from '@/lib/ingest/store'
import type { IngestionJsonObject, StagedTransactionStatus } from '@/lib/ingest/types'

type FinalStagedDisposition = Extract<StagedTransactionStatus, 'ignored' | 'deleted'>

export interface CsvStageImportError {
  rowNumber: number
  error: string
}

export interface CsvStageImportResult {
  importRunId: string
  totalRows: number
  rawInserted: number
  staged: number
  duplicates: number
  errors: CsvStageImportError[]
}

interface AccountRow {
  id: string
  name: string
  currency: string
}

interface AccountLookup {
  byId: Map<string, AccountRow>
  byName: Map<string, AccountRow>
}

interface FinalStagedDispositionRow {
  status: StagedTransactionStatus
}

function lookupAccounts(): AccountLookup {
  const rows = sqlite.prepare(`
    SELECT id, name, currency
    FROM accounts
  `).all() as AccountRow[]

  return {
    byId: new Map(rows.map(row => [row.id, row])),
    byName: new Map(rows.map(row => [row.name.trim().toLowerCase(), row])),
  }
}

function resolveAccount(rowAccountName: string, defaultAccountId: string | undefined, lookup: AccountLookup): AccountRow | null {
  if (defaultAccountId) return lookup.byId.get(defaultAccountId) ?? null

  const accountName = rowAccountName.trim()
  if (!accountName) return null
  return lookup.byId.get(accountName) ?? lookup.byName.get(accountName.toLowerCase()) ?? null
}

function rawRowSourceItemKey(row: CsvNormalizedTransaction): string {
  const digest = createHash('sha256')
    .update(stableStringify({
      accountName: row.accountName,
      amount: row.amount,
      date: row.date,
      description: row.description,
      externalId: row.externalId,
    }))
    .digest('hex')
    .slice(0, 32)

  return `csv-row:${digest}`
}

function rowErrors(row: CsvNormalizedTransaction, account: AccountRow | null): string[] {
  const errors = [...row.validationErrors]
  if (!account && !errors.includes('Missing account')) errors.push('Unable to match account')
  return errors
}

function normalizedPayload(row: CsvNormalizedTransaction): IngestionJsonObject {
  return {
    rowNumber: row.rowNumber,
    date: row.date,
    posted: row.posted,
    amount: row.amount,
    description: row.description,
    accountName: row.accountName,
    externalAccountId: row.externalAccountId,
    pending: row.pending,
    status: row.status,
    category: row.category,
    notes: row.notes,
    tags: row.tags,
    externalId: row.externalId,
    sourceItemKey: row.sourceItemKey,
  }
}

function selectHistoricalFinalDisposition(
  sourceConnectionId: string,
  sourceItemKey: string,
  currentImportRunId: string,
): FinalStagedDisposition | null {
  const row = sqlite.prepare(`
    SELECT status
    FROM staged_transactions
    WHERE source_connection_id = ?
      AND source_item_key = ?
      AND (import_run_id IS NULL OR import_run_id != ?)
    ORDER BY updated_at DESC, created_at DESC, rowid DESC
    LIMIT 1
  `).get(sourceConnectionId, sourceItemKey, currentImportRunId) as FinalStagedDispositionRow | undefined

  return row?.status === 'ignored' || row?.status === 'deleted' ? row.status : null
}

export function stageTransactionsCsv(
  csvText: string,
  mappingInput: CsvImportMapping,
  defaultAccountId?: string,
): CsvStageImportResult {
  const lookup = lookupAccounts()
  const defaultAccount = defaultAccountId ? lookup.byId.get(defaultAccountId) ?? null : null
  const source = ensureSource({
    id: 'csv',
    kind: 'csv',
    name: 'CSV Import',
  })
  const connection = ensureSourceConnection({
    id: 'csv:manual',
    sourceId: source.id,
    name: 'Manual CSV Uploads',
  })
  const run = createImportRun({
    sourceConnectionId: connection.id,
  })
  const normalized = normalizeCsvTransactions(csvText, {
    mapping: mappingInput,
    defaultAccountName: defaultAccount?.name,
    defaultExternalAccountId: defaultAccount?.id,
  })

  let rawInserted = 0
  let staged = 0
  let duplicates = 0
  const errors: CsvStageImportError[] = []

  for (const row of normalized.rows) {
    const account = resolveAccount(row.accountName, defaultAccountId, lookup)
    const sourceAccount = account
      ? ensureSourceAccount({
          sourceConnectionId: connection.id,
          fintrackAccountId: account.id,
          externalAccountId: account.id,
          name: account.name,
          currency: account.currency,
          rawPayload: {
            accountName: row.accountName,
            defaultAccountId: defaultAccountId ?? null,
          },
        })
      : null
    const sourceItemKey = sourceAccount
      ? buildCsvSourceItemKey(row, sourceAccount.id)
      : null
    const validationErrors = rowErrors(row, account)
    const finalDisposition = sourceItemKey
      ? selectHistoricalFinalDisposition(connection.id, sourceItemKey, run.id)
      : null
    const effectiveValidationErrors = finalDisposition ? [] : validationErrors
    const raw = insertRawImportItem({
      importRunId: run.id,
      sourceAccountId: sourceAccount?.id ?? null,
      externalId: row.externalId,
      sourceItemKey: sourceItemKey ?? rawRowSourceItemKey(row),
      rawPayload: row.rawPayload,
      status: finalDisposition ? 'ignored' : validationErrors.length > 0 ? 'error' : 'staged',
    })

    if (raw.status === 'duplicate') {
      duplicates++
      continue
    }

    rawInserted++
    if (!finalDisposition && (validationErrors.length > 0 || !sourceItemKey)) {
      errors.push(...validationErrors.map(error => ({ rowNumber: row.rowNumber, error })))
    }

    insertStagedTransaction({
      importRunId: run.id,
      rawItemId: raw.item.id,
      sourceConnectionId: connection.id,
      sourceAccountId: sourceAccount?.id ?? null,
      accountId: account?.id ?? null,
      externalId: row.externalId,
      sourceItemKey,
      posted: row.posted,
      amount: row.amount,
      currency: account?.currency ?? null,
      description: row.description || null,
      pending: row.pending,
      status: finalDisposition ?? (validationErrors.length > 0 || !sourceItemKey ? 'error' : 'staged'),
      category: row.category,
      notes: row.notes,
      tags: row.tags,
      normalizedPayload: normalizedPayload({ ...row, sourceItemKey }),
      validationErrors: effectiveValidationErrors,
      normalizerVersion: 'csv-normalizer-v1',
    })
    if (!finalDisposition && validationErrors.length === 0 && sourceItemKey) staged++
  }

  finishImportRun({
    id: run.id,
    status: 'completed',
    error: errors.length > 0 ? `${errors.length} row validation error(s)` : null,
  })

  return {
    importRunId: run.id,
    totalRows: normalized.totalRows,
    rawInserted,
    staged,
    duplicates,
    errors,
  }
}
