import { renderBeancountDraft } from '@/lib/export/beancount'
import { sqlite } from '@/lib/db'
import {
  runBeancountPreflight,
  type BeancountPreflightResult,
  type PreflightIssue,
} from '@/lib/export/preflight'
import {
  summarizeBeancountValidation,
  validateBeancountDraft,
  type BeancountValidationMode,
  type BeancountValidationSummary,
} from '@/lib/export/beancount-validation'
import {
  promoteStagedTransactions,
  type PromoteStagedTransactionsResult,
} from '@/lib/ingest/promote'

export type PromotionBeancountValidationStage = 'preflight' | 'external'

export interface PromotionBeancountValidationSummary {
  ok: boolean
  period: string
  beancountRoot: string
  proposedStaging: string
  transactionsScanned: number
  exportableTransactions: number
  mergedTransfers: number
  skipped: number
  blockers: number
  reviewItems: number
  duplicateCandidates: number
  previouslyExported: number
  investmentActivitiesScanned: number
  exportableInvestmentActivities: number
}

export interface PromotionBeancountValidationResult {
  ok: boolean
  stage: PromotionBeancountValidationStage
  summary: PromotionBeancountValidationSummary
  blockers: PreflightIssue[]
  validation: BeancountValidationSummary | null
}

export interface ValidatePromotionBeancountExportOptions {
  period: string
  beancountRoot?: string
  excludeExported?: boolean
  generatedAt?: Date
  validationMode?: BeancountValidationMode
  validatorCommand?: string
  validatorArgs?: string[]
  timeoutMs?: number
  keepTempFile?: boolean
}

export interface ValidatePromotedBeancountPreviewOptions extends ValidatePromotionBeancountExportOptions {
  importRunId: string
  stagedTransactionIds?: string[]
}

export interface PromotedBeancountPreviewResult {
  ok: boolean
  promotion: PromoteStagedTransactionsResult
  validation: PromotionBeancountValidationResult | null
}

class PromotionPreviewRollback extends Error {
  constructor() {
    super('rollback promotion validation preview')
    this.name = 'PromotionPreviewRollback'
  }
}

function summarizePreflight(preflight: BeancountPreflightResult): PromotionBeancountValidationSummary {
  return {
    ok: preflight.ok,
    period: preflight.period,
    beancountRoot: preflight.beancountRoot,
    proposedStaging: preflight.proposedStaging,
    transactionsScanned: preflight.summary.transactionsScanned,
    exportableTransactions: preflight.summary.exportableTransactions,
    mergedTransfers: preflight.summary.mergedTransfers,
    skipped: preflight.summary.skipped,
    blockers: preflight.summary.blockers,
    reviewItems: preflight.summary.reviewItems,
    duplicateCandidates: preflight.summary.duplicateCandidates,
    previouslyExported: preflight.summary.previouslyExported ?? 0,
    investmentActivitiesScanned: preflight.summary.investmentActivitiesScanned ?? 0,
    exportableInvestmentActivities: preflight.summary.exportableInvestmentActivities ?? 0,
  }
}

function previewResultOk(
  promotion: PromoteStagedTransactionsResult,
  validation: PromotionBeancountValidationResult | null,
): boolean {
  return promotion.errors.length === 0 && validation !== null && validation.ok
}

export function validatePromotionBeancountExport(
  options: ValidatePromotionBeancountExportOptions,
): PromotionBeancountValidationResult {
  const preflight = runBeancountPreflight({
    period: options.period,
    beancountRoot: options.beancountRoot,
    excludeExported: options.excludeExported ?? true,
  })
  const summary = summarizePreflight(preflight)

  if (!preflight.ok) {
    return {
      ok: false,
      stage: 'preflight',
      summary,
      blockers: preflight.blockers,
      validation: null,
    }
  }

  const draft = renderBeancountDraft(preflight, { generatedAt: options.generatedAt })
  const validation = validateBeancountDraft({
    draft,
    beancountRoot: preflight.beancountRoot,
    mode: options.validationMode,
    validatorCommand: options.validatorCommand,
    validatorArgs: options.validatorArgs,
    timeoutMs: options.timeoutMs,
    keepTempFile: options.keepTempFile,
  })

  return {
    ok: validation.ok,
    stage: 'external',
    summary,
    blockers: [],
    validation: summarizeBeancountValidation(validation),
  }
}

export function validatePromotedBeancountPreview(
  options: ValidatePromotedBeancountPreviewOptions,
): PromotedBeancountPreviewResult {
  let preview: PromotedBeancountPreviewResult | null = null

  try {
    sqlite.transaction(() => {
      const promotion = promoteStagedTransactions({
        importRunId: options.importRunId,
        stagedTransactionIds: options.stagedTransactionIds,
      })
      const validation = promotion.errors.length > 0
        ? null
        : validatePromotionBeancountExport(options)

      preview = {
        ok: previewResultOk(promotion, validation),
        promotion,
        validation,
      }

      throw new PromotionPreviewRollback()
    })()
  } catch (error) {
    if (!(error instanceof PromotionPreviewRollback)) throw error
  }

  if (!preview) {
    throw new Error('Promotion validation preview did not produce a result')
  }

  return preview
}
