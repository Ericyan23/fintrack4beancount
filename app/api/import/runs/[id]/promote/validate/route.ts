import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { ImportRunNotPromotableError } from '@/lib/ingest/promote'
import { validatePromotedBeancountPreview } from '@/lib/ingest/promotion-validation'
import {
  parsePromotionPeriod,
  parseStagedTransactionIds,
  parseValidationMode,
  sanitizePromotedPreview,
  sanitizeText,
} from '@/lib/ingest/promotion-validation-api'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface PromoteValidationRequestBody {
  period?: unknown
  stagedTransactionIds?: unknown
  validationMode?: unknown
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

async function readBody(req: NextRequest): Promise<PromoteValidationRequestBody | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as PromoteValidationRequestBody
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const run = loadImportRunStatus(id)

  if (!run) {
    return NextResponse.json({ error: 'Import run not found' }, { status: 404 })
  }
  if (run.status !== 'completed') {
    return NextResponse.json({ error: `Import run must be completed before validate: ${run.status}` }, { status: 409 })
  }

  let body: PromoteValidationRequestBody | null
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

  const validationMode = parseValidationMode(body.validationMode)
  if (validationMode === null) {
    return NextResponse.json({ error: 'validationMode must be optional, required, or disabled' }, { status: 400 })
  }

  const period = parsePromotionPeriod(body.period, id, stagedTransactionIds)
  if ('error' in period) {
    return NextResponse.json({ error: period.error }, { status: 400 })
  }

  try {
    const result = validatePromotedBeancountPreview({
      importRunId: id,
      stagedTransactionIds,
      period: period.period,
      validationMode,
    })

    return NextResponse.json(sanitizePromotedPreview(result, period.period))
  } catch (error) {
    if (error instanceof ImportRunNotPromotableError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    return NextResponse.json({
      error: 'Beancount promotion validation failed to run',
      detail: sanitizeText(error instanceof Error ? error.message : String(error)),
    }, { status: 500 })
  }
}
