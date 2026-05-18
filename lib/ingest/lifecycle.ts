import type { ImportRunStatus, RawImportItemStatus, StagedTransactionStatus } from '@/lib/ingest/types'

export const IMPORT_LIFECYCLE_STATES = [
  'raw_imported',
  'staged',
  'needs_review',
  'reviewed',
  'ignored',
  'deleted',
  'export_ready',
  'exported',
  'failed',
] as const

export type ImportLifecycleState = typeof IMPORT_LIFECYCLE_STATES[number]
export type ImportLifecycleCounts = Record<ImportLifecycleState, number>

export interface StagedLifecycleInput {
  status: StagedTransactionStatus | string
  validationErrors?: string[] | null
  transactionId?: string | null
  category?: string | null
}

export interface CanonicalLifecycleInput {
  id: string
  accountId: string
  status: string
  reviewStatus?: string | null
  ledgerAccount?: string | null
  category?: string | null
  exported?: boolean
}

function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== ''
}

function hasValidationErrors(errors: string[] | null | undefined): boolean {
  return Array.isArray(errors) && errors.some(error => error.trim() !== '')
}

function hasLedgerAccount(input: Pick<CanonicalLifecycleInput, 'ledgerAccount' | 'category'>): boolean {
  return present(input.ledgerAccount) || present(input.category)
}

export function zeroLifecycleCounts(): ImportLifecycleCounts {
  return Object.fromEntries(IMPORT_LIFECYCLE_STATES.map(state => [state, 0])) as ImportLifecycleCounts
}

export function incrementLifecycleCount(
  counts: ImportLifecycleCounts,
  state: ImportLifecycleState,
): ImportLifecycleCounts {
  counts[state] += 1
  return counts
}

export function rawImportItemLifecycleState(status: RawImportItemStatus | string): ImportLifecycleState {
  switch (status) {
    case 'ignored':
      return 'ignored'
    case 'error':
      return 'failed'
    case 'staged':
      return 'staged'
    case 'pending':
    default:
      return 'raw_imported'
  }
}

export function stagedTransactionLifecycleState(input: StagedLifecycleInput): ImportLifecycleState {
  switch (input.status) {
    case 'ignored':
      return 'ignored'
    case 'deleted':
      return 'deleted'
    case 'merged':
      return 'export_ready'
    case 'error':
      return 'needs_review'
    case 'ready':
      return hasValidationErrors(input.validationErrors) || !present(input.category)
        ? 'needs_review'
        : 'reviewed'
    case 'staged':
    default:
      return hasValidationErrors(input.validationErrors) ? 'needs_review' : 'staged'
  }
}

export function canonicalTransactionSourceId(input: Pick<CanonicalLifecycleInput, 'accountId' | 'id'>): string {
  return `fintrack:${input.accountId}:${input.id}`
}

export function canonicalTransactionLifecycleState(input: CanonicalLifecycleInput): ImportLifecycleState {
  if (input.status === 'cancelled') return 'deleted'
  if (input.exported) return 'exported'
  if (input.status === 'pending') return 'needs_review'
  if (input.reviewStatus === 'reviewed' && hasLedgerAccount(input)) return 'export_ready'
  return 'needs_review'
}

export function importRunLifecycleState(status: ImportRunStatus | string): ImportLifecycleState {
  switch (status) {
    case 'failed':
      return 'failed'
    case 'completed':
      return 'reviewed'
    case 'running':
    case 'pending':
    default:
      return 'raw_imported'
  }
}
