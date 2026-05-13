import fs from 'fs'
import path from 'path'
import { renderBalanceAssertionDraft, runBalanceAssertionPreflight } from '@/lib/export/balance-assertions'
import { defaultBeancountRoot } from '@/lib/export/beancount-ledger'
import { renderBeancountDraft } from '@/lib/export/beancount'
import {
  type BeancountHandoffManifest,
  buildBeancountHandoffManifest,
} from '@/lib/export/handoff-manifest'
import { currentPeriod, runBeancountPreflight } from '@/lib/export/preflight'

type HandoffFileKind = 'manifest' | 'combinedDraft' | 'transactionDraft' | 'balanceAssertionDraft'

interface HandoffFilePlan {
  kind: HandoffFileKind
  relativePath: string
  content: string
}

export interface WrittenHandoffFile {
  kind: HandoffFileKind
  relativePath: string
  absolutePath: string
  bytes: number
}

export interface WriteBeancountHandoffResult {
  ok: true
  period: string
  handoffRoot: string
  directory: string
  manifest: BeancountHandoffManifest
  files: WrittenHandoffFile[]
  resetFiles: string[]
}

export interface WriteBeancountHandoffOptions {
  period?: string
  overwrite?: boolean
  generatedAt?: Date
  handoffRoot?: string | null
}

export class HandoffConfigError extends Error {}

export class HandoffPreflightError extends Error {
  constructor(public readonly manifest: BeancountHandoffManifest) {
    super('Beancount handoff preflight has blockers')
  }
}

export class HandoffFileExistsError extends Error {
  constructor(public readonly file: string) {
    super(`Handoff file already exists: ${file}`)
  }
}

interface ExistingHandoffStatus {
  status?: string
}

function configuredHandoffRoot(): string | null {
  const root = process.env.FINTRACK_HANDOFF_ROOT?.trim()
  return root ? root : null
}

export function resolveHandoffRoot(root: string | null | undefined): string {
  const configured = root === undefined ? configuredHandoffRoot() : root?.trim()
  if (!configured) {
    throw new HandoffConfigError('FINTRACK_HANDOFF_ROOT is not configured')
  }
  return path.resolve(configured)
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function assertIndependentHandoffRoot(handoffRoot: string): void {
  const beancountRoot = path.resolve(defaultBeancountRoot())
  if (isWithin(beancountRoot, handoffRoot)) {
    throw new HandoffConfigError('FINTRACK_HANDOFF_ROOT must not be inside BEANCOUNT_ROOT')
  }
}

export function handoffTargetPath(handoffRoot: string, relativePath: string): string {
  const normalizedRelative = relativePath.split('/').join(path.sep)
  const target = path.resolve(handoffRoot, normalizedRelative)
  if (!isWithin(handoffRoot, target)) {
    throw new HandoffConfigError(`Invalid handoff path: ${relativePath}`)
  }
  return target
}

function renderCombinedDraft(transactionDraft: string, balanceDraft: string): string {
  return [
    '; Combined FinTrack Beancount handoff draft.',
    '; Review in the Beancount workflow before merging.',
    '',
    transactionDraft.trimEnd(),
    '',
    balanceDraft.trimEnd(),
    '',
  ].join('\n')
}

function writeFile(
  handoffRoot: string,
  plan: HandoffFilePlan,
  overwrite: boolean,
): WrittenHandoffFile {
  const absolutePath = handoffTargetPath(handoffRoot, plan.relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

  try {
    fs.writeFileSync(absolutePath, plan.content, {
      encoding: 'utf8',
      flag: overwrite ? 'w' : 'wx',
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      throw new HandoffFileExistsError(absolutePath)
    }
    throw err
  }

  return {
    kind: plan.kind,
    relativePath: plan.relativePath,
    absolutePath,
    bytes: Buffer.byteLength(plan.content, 'utf8'),
  }
}

function readExistingStatus(file: string): ExistingHandoffStatus | null {
  if (!fs.existsSync(file)) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as ExistingHandoffStatus
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

function lifecycleFiles(handoffRoot: string, manifest: BeancountHandoffManifest): string[] {
  return ['status.json', 'decision.json'].map(file =>
    handoffTargetPath(handoffRoot, path.posix.join(manifest.handoff.directory, file)),
  )
}

function assertOverwriteAllowed(handoffRoot: string, manifest: BeancountHandoffManifest): void {
  const [statusFile, decisionFile] = lifecycleFiles(handoffRoot, manifest)
  const status = readExistingStatus(statusFile)
  if (status?.status === 'merged') {
    throw new HandoffConfigError('Cannot overwrite a merged handoff')
  }
  if (fs.existsSync(decisionFile) && status?.status !== 'failed' && status?.status !== 'rejected') {
    throw new HandoffConfigError('Cannot overwrite a handoff with an active decision')
  }
}

function resettableHandoffFiles(handoffRoot: string, manifest: BeancountHandoffManifest): string[] {
  const files = [
    manifest.handoff.manifestFile,
    manifest.handoff.combinedDraftFile,
    manifest.handoff.transactionDraftFile,
    manifest.handoff.balanceAssertionDraftFile,
    path.posix.join(manifest.handoff.directory, 'status.json'),
    path.posix.join(manifest.handoff.directory, 'decision.json'),
  ].map(file => handoffTargetPath(handoffRoot, file))

  return Array.from(new Set(files))
}

function resetHandoffFiles(handoffRoot: string, manifest: BeancountHandoffManifest): string[] {
  const resetFiles: string[] = []
  for (const file of resettableHandoffFiles(handoffRoot, manifest)) {
    if (!fs.existsSync(file)) continue
    fs.rmSync(file)
    resetFiles.push(file)
  }
  return resetFiles
}

export function writeBeancountHandoff(
  options: WriteBeancountHandoffOptions = {},
): WriteBeancountHandoffResult {
  const period = options.period ?? currentPeriod()
  const generatedAt = options.generatedAt ?? new Date()
  const overwrite = options.overwrite === true
  const handoffRoot = resolveHandoffRoot(options.handoffRoot)
  assertIndependentHandoffRoot(handoffRoot)

  const manifest = buildBeancountHandoffManifest({ period, generatedAt })
  if (!manifest.ok) throw new HandoffPreflightError(manifest)
  if (overwrite) assertOverwriteAllowed(handoffRoot, manifest)

  const transactionPreflight = runBeancountPreflight({ period })
  const balancePreflight = runBalanceAssertionPreflight({ period })
  const transactionDraft = renderBeancountDraft(transactionPreflight, { generatedAt })
  const balanceDraft = renderBalanceAssertionDraft(balancePreflight, { generatedAt })
  const combinedDraft = renderCombinedDraft(transactionDraft, balanceDraft)

  const plannedFiles: HandoffFilePlan[] = [
    { kind: 'transactionDraft', relativePath: manifest.handoff.transactionDraftFile, content: transactionDraft },
    { kind: 'balanceAssertionDraft', relativePath: manifest.handoff.balanceAssertionDraftFile, content: balanceDraft },
    { kind: 'combinedDraft', relativePath: manifest.handoff.combinedDraftFile, content: combinedDraft },
    { kind: 'manifest', relativePath: manifest.handoff.manifestFile, content: `${JSON.stringify(manifest, null, 2)}\n` },
  ]

  if (!overwrite) {
    for (const plan of plannedFiles) {
      const absolutePath = handoffTargetPath(handoffRoot, plan.relativePath)
      if (fs.existsSync(absolutePath)) throw new HandoffFileExistsError(absolutePath)
    }
  }

  const resetFiles = overwrite ? resetHandoffFiles(handoffRoot, manifest) : []
  const files = plannedFiles.map(plan => writeFile(handoffRoot, plan, overwrite))

  return {
    ok: true,
    period,
    handoffRoot,
    directory: handoffTargetPath(handoffRoot, manifest.handoff.directory),
    manifest,
    files,
    resetFiles,
  }
}
