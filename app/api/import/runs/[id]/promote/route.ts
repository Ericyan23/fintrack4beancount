import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { ImportRunNotPromotableError, promoteStagedTransactions } from '@/lib/ingest/promote'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface PromoteRequestBody {
  stagedTransactionIds?: unknown
}

interface ImportRunStatusRow {
  status: string
}

function loadImportRunStatus(id: string): ImportRunStatusRow | null {
  const row = sqlite.prepare(`
    SELECT status
    FROM import_runs
    WHERE id = ?
  `).get(id) as ImportRunStatusRow | undefined

  return row ?? null
}

async function readBody(req: NextRequest): Promise<PromoteRequestBody | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as PromoteRequestBody
}

function parseStagedTransactionIds(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return null

  return value
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const run = loadImportRunStatus(id)

  if (!run) {
    return NextResponse.json({ error: 'Import run not found' }, { status: 404 })
  }
  if (run.status !== 'completed') {
    return NextResponse.json({ error: `Import run must be completed before promote: ${run.status}` }, { status: 409 })
  }

  let body: PromoteRequestBody | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const stagedTransactionIds = parseStagedTransactionIds(body.stagedTransactionIds)
  if (stagedTransactionIds === null) {
    return NextResponse.json({ error: 'stagedTransactionIds must be an array of strings' }, { status: 400 })
  }

  let result: ReturnType<typeof promoteStagedTransactions>
  try {
    result = promoteStagedTransactions({
      importRunId: id,
      stagedTransactionIds,
    })
  } catch (error) {
    if (error instanceof ImportRunNotPromotableError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json(result)
}
