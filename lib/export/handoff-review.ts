import fs from 'fs'
import path from 'path'
import {
  HandoffConfigError,
  assertIndependentHandoffRoot,
  handoffTargetPath,
  resolveHandoffRoot,
} from '@/lib/export/handoff-writer'

export type HandoffDecisionValue = 'approve' | 'reject'

export interface HandoffWorkerStatus {
  schemaVersion?: number
  source?: string
  status: string
  ok?: boolean
  message?: string
  updatedAt?: string
  stagingDir?: string
  checkLog?: string
  commit?: string
  errors?: string[]
}

export interface HandoffDecision {
  schemaVersion: 1
  source: 'fintrack'
  period: string
  decision: HandoffDecisionValue
  note: string | null
  requestedAt: string
  requestedBy: 'fintrack-ui'
}

export interface HandoffReviewState {
  period: string
  handoffRoot: string
  directory: string
  paths: {
    manifest: string
    combinedDraft: string
    status: string
    decision: string
  }
  exists: {
    manifest: boolean
    combinedDraft: boolean
    status: boolean
    decision: boolean
  }
  status: HandoffWorkerStatus | null
  decision: HandoffDecision | null
  readyForApproval: boolean
  canReject: boolean
}

export class HandoffReviewError extends Error {}

function validatePeriod(period: string): string {
  const normalized = period.trim()
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new HandoffReviewError('period must use YYYY-MM')
  }
  return normalized
}

function handoffDirectory(period: string): string {
  return path.posix.join(validatePeriod(period), 'fintrack')
}

function readJsonFile<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new HandoffReviewError(`Invalid handoff JSON ${path.basename(file)}: ${message}`)
  }
}

function statusAllowsApproval(status: HandoffWorkerStatus | null): boolean {
  if (!status) return false
  if (status.status === 'ready_for_approval') return status.ok === true
  return status.status === 'checked' && status.ok === true
}

function statusAllowsRejection(status: HandoffWorkerStatus | null): boolean {
  if (!status) return false
  return !['merged', 'approved', 'rejected'].includes(status.status)
}

export function readHandoffReviewState(options: {
  period: string
  handoffRoot?: string | null
}): HandoffReviewState {
  const period = validatePeriod(options.period)
  const handoffRoot = resolveHandoffRoot(options.handoffRoot)
  assertIndependentHandoffRoot(handoffRoot)
  const directoryRelative = handoffDirectory(period)
  const directory = handoffTargetPath(handoffRoot, directoryRelative)
  const paths = {
    manifest: handoffTargetPath(handoffRoot, path.posix.join(directoryRelative, 'manifest.json')),
    combinedDraft: handoffTargetPath(handoffRoot, path.posix.join(directoryRelative, `${period}.bean`)),
    status: handoffTargetPath(handoffRoot, path.posix.join(directoryRelative, 'status.json')),
    decision: handoffTargetPath(handoffRoot, path.posix.join(directoryRelative, 'decision.json')),
  }
  const status = readJsonFile<HandoffWorkerStatus>(paths.status)
  const decision = readJsonFile<HandoffDecision>(paths.decision)

  return {
    period,
    handoffRoot,
    directory,
    paths,
    exists: {
      manifest: fs.existsSync(paths.manifest),
      combinedDraft: fs.existsSync(paths.combinedDraft),
      status: fs.existsSync(paths.status),
      decision: fs.existsSync(paths.decision),
    },
    status,
    decision,
    readyForApproval: !decision && statusAllowsApproval(status),
    canReject: !decision && statusAllowsRejection(status),
  }
}

export function writeHandoffDecision(options: {
  period: string
  decision: HandoffDecisionValue
  note?: string | null
  requestedAt?: Date
  handoffRoot?: string | null
}): HandoffReviewState {
  const state = readHandoffReviewState({
    period: options.period,
    handoffRoot: options.handoffRoot,
  })

  if (!state.exists.manifest || !state.exists.combinedDraft) {
    throw new HandoffReviewError('Handoff files have not been written yet')
  }
  if (state.exists.decision) {
    throw new HandoffReviewError('Handoff decision has already been recorded')
  }
  if (options.decision === 'approve' && !state.readyForApproval) {
    throw new HandoffReviewError('Beancount worker status is not ready for approval')
  }
  if (options.decision === 'reject' && !state.canReject) {
    throw new HandoffReviewError('Beancount worker status cannot be rejected')
  }

  const decision: HandoffDecision = {
    schemaVersion: 1,
    source: 'fintrack',
    period: state.period,
    decision: options.decision,
    note: options.note?.trim() || null,
    requestedAt: (options.requestedAt ?? new Date()).toISOString(),
    requestedBy: 'fintrack-ui',
  }

  try {
    fs.writeFileSync(state.paths.decision, `${JSON.stringify(decision, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      throw new HandoffReviewError('Handoff decision has already been recorded')
    }
    throw err
  }
  return readHandoffReviewState({
    period: state.period,
    handoffRoot: state.handoffRoot,
  })
}

export function reviewErrorStatus(err: unknown): number {
  if (err instanceof HandoffConfigError) return 400
  if (err instanceof HandoffReviewError) return 409
  return 400
}
