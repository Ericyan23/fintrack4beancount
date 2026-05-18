import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { stagedTransactionLifecycleState } from '@/lib/ingest/lifecycle'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface StagedImportRunRow {
  id: string
  status: string
  lifecycleState: string
  accountId: string | null
  accountName: string | null
  sourceAccountId: string | null
  sourceAccountName: string | null
  externalId: string | null
  posted: number | null
  amount: string | null
  description: string | null
  pending: boolean
  category: string | null
  notes: string | null
  tags: string[]
  transactionId: string | null
  rawItemId: string | null
  sourceItemKey: string | null
  reconciliationStatus: string | null
  reconciliationTransactionId: string | null
  reconciliationReason: string | null
  validationErrors: string[]
  updatedAt: number
}

interface StagedImportRunDbRow extends Omit<StagedImportRunRow, 'lifecycleState' | 'pending' | 'tags' | 'validationErrors'> {
  pending: number
  tags: string | null
  validationErrors: string | null
}

function importRunExists(id: string): boolean {
  return Boolean(sqlite.prepare(`
    SELECT 1
    FROM import_runs
    WHERE id = ?
  `).get(id))
}

function loadStagedRows(importRunId: string): StagedImportRunRow[] {
  const rows = sqlite.prepare(`
    SELECT
      staged_transactions.id,
      staged_transactions.status,
      staged_transactions.account_id AS accountId,
      accounts.name AS accountName,
      staged_transactions.source_account_id AS sourceAccountId,
      source_accounts.name AS sourceAccountName,
      staged_transactions.external_id AS externalId,
      staged_transactions.posted,
      staged_transactions.amount,
      staged_transactions.description,
      staged_transactions.pending,
      staged_transactions.category,
      staged_transactions.notes,
      staged_transactions.tags,
      staged_transactions.transaction_id AS transactionId,
      staged_transactions.raw_item_id AS rawItemId,
      staged_transactions.source_item_key AS sourceItemKey,
      staged_transactions.reconciliation_status AS reconciliationStatus,
      staged_transactions.reconciliation_transaction_id AS reconciliationTransactionId,
      staged_transactions.reconciliation_reason AS reconciliationReason,
      staged_transactions.validation_errors AS validationErrors,
      staged_transactions.updated_at AS updatedAt
    FROM staged_transactions
    LEFT JOIN accounts
      ON accounts.id = staged_transactions.account_id
    LEFT JOIN source_accounts
      ON source_accounts.id = staged_transactions.source_account_id
    WHERE staged_transactions.import_run_id = ?
    ORDER BY
      COALESCE(staged_transactions.posted, 0) ASC,
      staged_transactions.created_at ASC,
      staged_transactions.id ASC
  `).all(importRunId) as StagedImportRunDbRow[]

  return rows.map(row => ({
    ...row,
    pending: Boolean(row.pending),
    tags: parseTags(row.tags),
    validationErrors: parseValidationErrors(row.validationErrors),
  })).map(row => ({
    ...row,
    lifecycleState: stagedTransactionLifecycleState(row),
  }))
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

function parseValidationErrors(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params

  if (!importRunExists(id)) {
    return NextResponse.json({ error: 'Import run not found' }, { status: 404 })
  }

  return NextResponse.json({ rows: loadStagedRows(id) })
}
