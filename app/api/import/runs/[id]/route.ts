import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface ImportRunRow {
  id: string
  sourceConnectionId: string | null
  status: string
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

function loadImportRun(id: string): ImportRunRow | null {
  const row = sqlite.prepare(`
    SELECT
      id,
      source_connection_id AS sourceConnectionId,
      status,
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

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const run = loadImportRun(id)

  if (!run) return NextResponse.json({ error: 'Import run not found' }, { status: 404 })

  return NextResponse.json({
    run,
    summary: loadSummary(id),
  })
}
