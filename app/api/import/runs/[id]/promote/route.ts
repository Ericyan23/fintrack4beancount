import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { ImportRunNotPromotableError, promoteStagedTransactions } from '@/lib/ingest/promote'
import {
  validatePromotedBeancountPreview,
  type PromotedBeancountPreviewResult,
  type PromotionBeancountValidationResult,
} from '@/lib/ingest/promotion-validation'
import type { BeancountValidationMode } from '@/lib/export/beancount-validation'

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

interface PromotionPeriodRow {
  minPosted: number | null
  maxPosted: number | null
}

const VALIDATION_MODES = new Set<BeancountValidationMode>(['optional', 'required', 'disabled'])
const MAX_RETURNED_BLOCKERS = 20
const MAX_MESSAGE_LENGTH = 600

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

function parseValidateBeancount(value: unknown): boolean | undefined | null {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  return null
}

function parseValidationMode(value: unknown): BeancountValidationMode | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase() as BeancountValidationMode
  return VALIDATION_MODES.has(normalized) ? normalized : null
}

function configuredValidationMode(): BeancountValidationMode {
  const raw = process.env.FINTRACK_BEANCOUNT_VALIDATION?.trim().toLowerCase()
  if (!raw) return 'optional'
  if (['required', 'require', 'strict', '1', 'true', 'on'].includes(raw)) return 'required'
  if (['0', 'false', 'off', 'disabled', 'disable', 'skip', 'skipped'].includes(raw)) return 'disabled'
  return 'optional'
}

function periodFromTimestamp(value: number): string {
  return new Date(value * 1000).toISOString().slice(0, 7)
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function inferPromotionPeriod(
  importRunId: string,
  stagedTransactionIds?: string[],
): { period: string } | { error: string } {
  if (stagedTransactionIds?.length === 0) return { period: currentPeriod() }

  const idFilter = stagedTransactionIds
    ? `AND id IN (${stagedTransactionIds.map(() => '?').join(', ')})`
    : ''
  const row = sqlite.prepare(`
    SELECT MIN(posted) AS minPosted,
           MAX(posted) AS maxPosted
    FROM staged_transactions
    WHERE import_run_id = ?
      AND status IN ('staged', 'ready')
      AND posted IS NOT NULL
      ${idFilter}
  `).get(importRunId, ...(stagedTransactionIds ?? [])) as PromotionPeriodRow

  if (row.minPosted === null || row.maxPosted === null) {
    return { period: currentPeriod() }
  }

  const minPeriod = periodFromTimestamp(row.minPosted)
  const maxPeriod = periodFromTimestamp(row.maxPosted)
  if (minPeriod !== maxPeriod) {
    return { error: 'period is required when promotable staged rows span multiple months' }
  }

  return { period: minPeriod }
}

function parsePeriod(value: unknown, importRunId: string, stagedTransactionIds?: string[]): { period: string } | { error: string } {
  if (value === undefined) return inferPromotionPeriod(importRunId, stagedTransactionIds)
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value.trim())) {
    return { error: 'period must use YYYY-MM' }
  }

  return { period: value.trim() }
}

function sanitizeText(value: string | null | undefined): string | null {
  if (!value) return null

  return value
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s"']+/g, '[redacted-url]')
    .replace(/Basic\s+[A-Za-z0-9+/=]{12,}/g, 'Basic [redacted]')
    .replace(/\/(?:Users|private|var|tmp)\/[^\s"']+/g, '[path]')
    .replace(/fintrack:source:[^\s"']+/g, '[source_id]')
    .slice(0, MAX_MESSAGE_LENGTH)
}

function checkerMessage(validation: PromotionBeancountValidationResult['validation']): string | null {
  if (!validation) return null
  return sanitizeText(validation.error || validation.stderr || validation.stdout)
}

function sanitizeValidation(validation: PromotionBeancountValidationResult | null): unknown {
  if (!validation) return null

  return {
    ok: validation.ok,
    stage: validation.stage,
    summary: {
      period: validation.summary.period,
      exportableTransactions: validation.summary.exportableTransactions,
      mergedTransfers: validation.summary.mergedTransfers,
      blockers: validation.summary.blockers,
      reviewItems: validation.summary.reviewItems,
      previouslyExported: validation.summary.previouslyExported,
      exportableInvestmentActivities: validation.summary.exportableInvestmentActivities,
    },
    blockers: validation.blockers.slice(0, MAX_RETURNED_BLOCKERS).map(issue => ({
      code: issue.code,
      message: sanitizeText(issue.message),
      transactionId: issue.transactionId,
      investmentActivityId: issue.investmentActivityId,
      splitId: issue.splitId,
      transferMatchId: issue.transferMatchId,
      account: issue.account,
      category: issue.category,
    })),
    checker: validation.validation
      ? {
        ok: validation.validation.ok,
        status: validation.validation.status,
        mode: validation.validation.mode,
        exitCode: validation.validation.exitCode,
        signal: validation.validation.signal,
        message: checkerMessage(validation.validation),
      }
      : null,
  }
}

function sanitizePreview(result: PromotedBeancountPreviewResult, period: string): unknown {
  return {
    ok: result.ok,
    period,
    promotion: {
      promoted: result.promotion.promoted,
      skipped: result.promotion.skipped,
      enriched: result.promotion.enriched,
      errors: result.promotion.errors.map(error => ({
        stagedTransactionId: error.stagedTransactionId,
        error: sanitizeText(error.error),
      })),
    },
    validation: sanitizeValidation(result.validation),
  }
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
      const period = parsePeriod(body.period, id, stagedTransactionIds)
      if ('error' in period) {
        return NextResponse.json({ error: period.error }, { status: 400 })
      }

      const preview = validatePromotedBeancountPreview({
        importRunId: id,
        stagedTransactionIds,
        period: period.period,
        validationMode: requiredValidation ? 'required' : validationMode ?? 'required',
      })
      validation = sanitizePreview(preview, period.period)

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
