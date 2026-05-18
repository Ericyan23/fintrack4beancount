import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultBeancountRoot } from '@/lib/export/beancount-ledger'

export type BeancountValidationMode = 'optional' | 'required' | 'disabled'
export type BeancountValidationStatus = 'passed' | 'failed' | 'unavailable' | 'skipped'

export interface BeancountValidationResult {
  ok: boolean
  status: BeancountValidationStatus
  mode: BeancountValidationMode
  command: string
  args: string[]
  beancountRoot: string
  mainFile: string
  validatedFile: string | null
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  error: string | null
  durationMs: number
}

export interface BeancountValidationSummary {
  ok: boolean
  status: BeancountValidationStatus
  mode: BeancountValidationMode
  command: string
  args: string[]
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  error: string | null
  durationMs: number
}

export interface ValidateBeancountDraftOptions {
  draft: string
  beancountRoot?: string
  mainFile?: string
  validatorCommand?: string
  validatorArgs?: string[]
  mode?: BeancountValidationMode
  timeoutMs?: number
  keepTempFile?: boolean
}

const DEFAULT_VALIDATOR_COMMAND = 'bean-check'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_LENGTH = 20_000

function configuredMode(): BeancountValidationMode {
  const raw = process.env.FINTRACK_BEANCOUNT_VALIDATION?.trim().toLowerCase()
  if (!raw) return 'optional'
  if (['0', 'false', 'off', 'disabled', 'disable', 'skip', 'skipped'].includes(raw)) {
    return 'disabled'
  }
  if (['required', 'require', 'strict', '1', 'true', 'on'].includes(raw)) {
    return 'required'
  }
  return 'optional'
}

function configuredCommand(): string {
  const configured = process.env.FINTRACK_BEANCOUNT_VALIDATOR?.trim()
  return configured || DEFAULT_VALIDATOR_COMMAND
}

function normalizeOutput(value: string | Buffer | null | undefined): string {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : value ?? ''
  const trimmed = text.trim()
  if (trimmed.length <= MAX_OUTPUT_LENGTH) return trimmed
  return `${trimmed.slice(0, MAX_OUTPUT_LENGTH)}\n...[truncated]`
}

function renderValidationFile(mainFile: string, draft: string): string {
  const escapedMainFile = mainFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    '; FinTrack external Beancount validation file.',
    '; This temporary file includes the existing ledger and the generated draft.',
    `include "${escapedMainFile}"`,
    '',
    '; FinTrack generated draft follows.',
    draft.trimEnd(),
    '',
  ].join('\n')
}

function emptyResult(input: {
  ok: boolean
  status: BeancountValidationStatus
  mode: BeancountValidationMode
  command: string
  args: string[]
  beancountRoot: string
  mainFile: string
  validatedFile?: string | null
  error?: string | null
  durationMs?: number
}): BeancountValidationResult {
  return {
    ok: input.ok,
    status: input.status,
    mode: input.mode,
    command: input.command,
    args: input.args,
    beancountRoot: input.beancountRoot,
    mainFile: input.mainFile,
    validatedFile: input.validatedFile ?? null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    error: input.error ?? null,
    durationMs: input.durationMs ?? 0,
  }
}

function isMissingCommand(error: Error | undefined): boolean {
  return Boolean(error && 'code' in error && error.code === 'ENOENT')
}

export function validateBeancountDraft(
  options: ValidateBeancountDraftOptions,
): BeancountValidationResult {
  const mode = options.mode ?? configuredMode()
  const command = options.validatorCommand?.trim() || configuredCommand()
  const args = options.validatorArgs ?? []
  const beancountRoot = path.resolve(options.beancountRoot ?? defaultBeancountRoot())
  const mainFile = path.resolve(options.mainFile ?? path.join(beancountRoot, 'main.bean'))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (mode === 'disabled') {
    return emptyResult({
      ok: true,
      status: 'skipped',
      mode,
      command,
      args,
      beancountRoot,
      mainFile,
      error: 'External Beancount validation disabled',
    })
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-beancount-validation-'))
  const validatedFile = path.join(tempDir, 'validation.bean')
  const startedAt = Date.now()

  try {
    fs.writeFileSync(validatedFile, renderValidationFile(mainFile, options.draft), 'utf8')

    const result = spawnSync(command, [...args, validatedFile], {
      cwd: beancountRoot,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    })
    const durationMs = Date.now() - startedAt

    if (isMissingCommand(result.error)) {
      return {
        ok: mode !== 'required',
        status: mode === 'required' ? 'failed' : 'unavailable',
        mode,
        command,
        args,
        beancountRoot,
        mainFile,
        validatedFile: options.keepTempFile ? validatedFile : null,
        exitCode: null,
        signal: null,
        stdout: normalizeOutput(result.stdout),
        stderr: normalizeOutput(result.stderr),
        error: `${command} was not found`,
        durationMs,
      }
    }

    if (result.error) {
      return {
        ok: false,
        status: 'failed',
        mode,
        command,
        args,
        beancountRoot,
        mainFile,
        validatedFile: options.keepTempFile ? validatedFile : null,
        exitCode: typeof result.status === 'number' ? result.status : null,
        signal: result.signal ?? null,
        stdout: normalizeOutput(result.stdout),
        stderr: normalizeOutput(result.stderr),
        error: result.error.message,
        durationMs,
      }
    }

    const exitCode = typeof result.status === 'number' ? result.status : null
    const ok = exitCode === 0
    return {
      ok,
      status: ok ? 'passed' : 'failed',
      mode,
      command,
      args,
      beancountRoot,
      mainFile,
      validatedFile: options.keepTempFile ? validatedFile : null,
      exitCode,
      signal: result.signal ?? null,
      stdout: normalizeOutput(result.stdout),
      stderr: normalizeOutput(result.stderr),
      error: ok ? null : 'External Beancount validation failed',
      durationMs,
    }
  } finally {
    if (!options.keepTempFile) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

export function summarizeBeancountValidation(
  result: BeancountValidationResult,
): BeancountValidationSummary {
  return {
    ok: result.ok,
    status: result.status,
    mode: result.mode,
    command: result.command,
    args: result.args,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    durationMs: result.durationMs,
  }
}
