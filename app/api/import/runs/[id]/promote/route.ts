import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { ImportRunNotPromotableError, promoteStagedTransactions } from '@/lib/ingest/promote'
import { validatePromotedBeancountPreview } from '@/lib/ingest/promotion-validation'
import {
  configuredValidationMode,
  parsePromotionPeriod,
  parseStagedTransactionIds,
  parseValidateBeancount,
  parseValidationMode,
  sanitizePromotedPreview,
  sanitizeText,
} from '@/lib/ingest/promotion-validation-api'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface PromoteRequestBody {
  stagedTransactionIds?: unknown
  validateBeancount?: unknown
  period?: unknown
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

async function readBody(req: NextRequest): Promise<PromoteRequestBody | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as PromoteRequestBody
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

  const validateBeancount = parseValidateBeancount(body.validateBeancount)
  if (validateBeancount === null) {
    return NextResponse.json({ error: 'validateBeancount must be a boolean' }, { status: 400 })
  }

  const validationMode = parseValidationMode(body.validationMode)
  if (validationMode === null) {
    return NextResponse.json({ error: 'validationMode must be optional, required, or disabled' }, { status: 400 })
  }

  let result: ReturnType<typeof promoteStagedTransactions>
  try {
    let validation: unknown
    const envValidationMode = configuredValidationMode()
    const requiredValidation = validationMode === 'required' || envValidationMode === 'required'
    const shouldValidate = validateBeancount === true || requiredValidation
    if (shouldValidate) {
      const period = parsePromotionPeriod(body.period, id, stagedTransactionIds)
      if ('error' in period) {
        return NextResponse.json({ error: period.error }, { status: 400 })
      }

      const preview = validatePromotedBeancountPreview({
        importRunId: id,
        stagedTransactionIds,
        period: period.period,
        validationMode: requiredValidation ? 'required' : validationMode ?? 'required',
      })
      validation = sanitizePromotedPreview(preview, period.period)

      if (!preview.ok) {
        return NextResponse.json({
          error: 'Beancount validation failed; promotion was not run',
          validation,
        }, { status: 409 })
      }
    }

    result = promoteStagedTransactions({
      importRunId: id,
      stagedTransactionIds,
    })

    if (validation) {
      return NextResponse.json({
        ...result,
        validation,
      })
    }
  } catch (error) {
    if (error instanceof ImportRunNotPromotableError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({
      error: 'Beancount validation failed to run; promotion was not run',
      detail: sanitizeText(error instanceof Error ? error.message : String(error)),
    }, { status: 500 })
  }

  return NextResponse.json(result)
}
