import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { loadPreviouslyExportedSourceIds } from '@/lib/export/export-runs'
import {
  canonicalTransactionLifecycleState,
  canonicalTransactionSourceId,
  incrementLifecycleCount,
  rawImportItemLifecycleState,
  stagedTransactionLifecycleState,
  zeroLifecycleCounts,
  type ImportLifecycleCounts,
} from '@/lib/ingest/lifecycle'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface ImportRunRow {
  id: string
  sourceConnectionId: string | null
  status: string
  lifecycleState: string
  startedAt: number | null
  finishedAt: number | null
  itemCount: number
  error: string | null
  createdAt: number
  updatedAt: number
}

interface CountRow {
  value: number
}

interface StatusCountRow {
  status: string
  value: number
}

interface ImportRunSummary {
  raw: number
  staged: number
  ready: number
  merged: number
  ignored: number
  deleted: number
  error: number
  canonical: number
}

interface RawLifecycleRow {
  status: string
}

interface StagedLifecycleRow {
  status: string
  category: string | null
  transactionId: string | null
  validationErrors: string | null
}

interface CanonicalLifecycleRow {
  id: string
  accountId: string
  status: string
  reviewStatus: string | null
  ledgerAccount: string | null
  category: string | null
}

interface ImportRunLifecycleSummary {
  raw: ImportLifecycleCounts
  staged: ImportLifecycleCounts
  canonical: ImportLifecycleCounts
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

function loadImportRun(id: string): ImportRunRow | null {
  const row = sqlite.prepare(`
    SELECT
      id,
      source_connection_id AS sourceConnectionId,
      status,
      CASE
        WHEN status = 'failed' THEN 'failed'
        WHEN status = 'completed' THEN 'reviewed'
        ELSE 'raw_imported'
      END AS lifecycleState,
      started_at AS startedAt,
      finished_at AS finishedAt,
      item_count AS itemCount,
      error,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM import_runs
    WHERE id = ?
  `).get(id) as ImportRunRow | undefined

  return row ?? null
}

function countRawItems(importRunId: string): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM raw_import_items
    WHERE import_run_id = ?
  `).get(importRunId) as CountRow

  return row.value
}

function countCanonicalTransactions(importRunId: string): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
    WHERE import_run_id = ?
  `).get(importRunId) as CountRow

  return row.value
}

function loadSummary(importRunId: string): ImportRunSummary {
  const summary: ImportRunSummary = {
    raw: countRawItems(importRunId),
    staged: 0,
    ready: 0,
    merged: 0,
    ignored: 0,
    deleted: 0,
    error: 0,
    canonical: countCanonicalTransactions(importRunId),
  }
  const statusRows = sqlite.prepare(`
    SELECT status, COUNT(*) AS value
    FROM staged_transactions
    WHERE import_run_id = ?
    GROUP BY status
  `).all(importRunId) as StatusCountRow[]

  for (const row of statusRows) {
    if (
      Object.prototype.hasOwnProperty.call(summary, row.status)
      && row.status !== 'raw'
      && row.status !== 'canonical'
    ) {
      summary[row.status as keyof Omit<ImportRunSummary, 'raw' | 'canonical'>] = row.value
    }
  }

  return summary
}

function loadLifecycleSummary(importRunId: string): ImportRunLifecycleSummary {
  const lifecycle: ImportRunLifecycleSummary = {
    raw: zeroLifecycleCounts(),
    staged: zeroLifecycleCounts(),
    canonical: zeroLifecycleCounts(),
  }

  const rawRows = sqlite.prepare(`
    SELECT status
    FROM raw_import_items
    WHERE import_run_id = ?
  `).all(importRunId) as RawLifecycleRow[]
  for (const row of rawRows) {
    incrementLifecycleCount(lifecycle.raw, rawImportItemLifecycleState(row.status))
  }

  const stagedRows = sqlite.prepare(`
    SELECT status,
           category,
           transaction_id AS transactionId,
           validation_errors AS validationErrors
    FROM staged_transactions
    WHERE import_run_id = ?
  `).all(importRunId) as StagedLifecycleRow[]
  for (const row of stagedRows) {
    incrementLifecycleCount(lifecycle.staged, stagedTransactionLifecycleState({
      status: row.status,
      category: row.category,
      transactionId: row.transactionId,
      validationErrors: parseValidationErrors(row.validationErrors),
    }))
  }

  const exportedSourceIds = loadPreviouslyExportedSourceIds({ exportTarget: 'beancount_handoff' })
  const canonicalRows = sqlite.prepare(`
    SELECT id,
           account_id AS accountId,
           status,
           review_status AS reviewStatus,
           ledger_account AS ledgerAccount,
           category
    FROM transactions
    WHERE import_run_id = ?
  `).all(importRunId) as CanonicalLifecycleRow[]
  for (const row of canonicalRows) {
    incrementLifecycleCount(lifecycle.canonical, canonicalTransactionLifecycleState({
      ...row,
      exported: exportedSourceIds.has(canonicalTransactionSourceId(row)),
    }))
  }

  return lifecycle
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const run = loadImportRun(id)

  if (!run) return NextResponse.json({ error: 'Import run not found' }, { status: 404 })

  return NextResponse.json({
    run,
    summary: loadSummary(id),
    lifecycle: loadLifecycleSummary(id),
  })
}
