import { renderBeancountDraft } from '@/lib/export/beancount'
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
