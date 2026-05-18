import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-beancount-validation-test-'))
const beancountRoot = path.join(tempDir, 'beancount')

const {
  validateBeancountDraft,
  summarizeBeancountValidation,
} = require('../lib/export/beancount-validation') as typeof import('../lib/export/beancount-validation')

function writeLedger(): void {
  fs.rmSync(beancountRoot, { recursive: true, force: true })
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Validation Test"',
      '2026-01-01 open Assets:US:Banks:Checking USD',
      '2026-01-01 open Expenses:Food:Coffee USD',
      '',
    ].join('\n'),
  )
}

beforeEach(() => {
  writeLedger()
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('external Beancount validation invokes the configured checker with a ledger-inclusive draft', () => {
  const script = [
    'const fs = require("fs");',
    'const file = process.argv[1];',
    'const text = fs.readFileSync(file, "utf8");',
    'if (!text.includes("include \\"")) process.exit(3);',
    'if (!text.includes("Coffee")) process.exit(4);',
    'process.stdout.write("checked");',
  ].join('')

  const result = validateBeancountDraft({
    draft: [
      '2026-04-01 * "Coffee"',
      '  Assets:US:Banks:Checking                   -4.75 USD',
      '  Expenses:Food:Coffee                         4.75 USD',
      '',
    ].join('\n'),
    beancountRoot,
    validatorCommand: process.execPath,
    validatorArgs: ['-e', script],
    mode: 'required',
  })

  assert.equal(result.ok, true)
  assert.equal(result.status, 'passed')
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout, 'checked')
  assert.equal(result.validatedFile, null)

  const summary = summarizeBeancountValidation(result)
  assert.deepEqual(summary, {
    ok: true,
    status: 'passed',
    mode: 'required',
    command: process.execPath,
    args: ['-e', script],
    exitCode: 0,
    signal: null,
    stdout: 'checked',
    stderr: '',
    error: null,
    durationMs: result.durationMs,
  })
})

test('external Beancount validation reports checker failures', () => {
  const result = validateBeancountDraft({
    draft: '2026-04-01 * "Broken"\n',
    beancountRoot,
    validatorCommand: process.execPath,
    validatorArgs: ['-e', 'process.stderr.write("invalid draft"); process.exit(2)'],
    mode: 'required',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.equal(result.exitCode, 2)
  assert.equal(result.stderr, 'invalid draft')
  assert.equal(result.error, 'External Beancount validation failed')
})

test('missing optional checker is recorded as unavailable without blocking export', () => {
  const result = validateBeancountDraft({
    draft: '2026-04-01 * "Coffee"\n',
    beancountRoot,
    validatorCommand: path.join(tempDir, 'missing-bean-check'),
    mode: 'optional',
  })

  assert.equal(result.ok, true)
  assert.equal(result.status, 'unavailable')
  assert.match(result.error ?? '', /was not found/)
})

test('missing required checker blocks export validation', () => {
  const result = validateBeancountDraft({
    draft: '2026-04-01 * "Coffee"\n',
    beancountRoot,
    validatorCommand: path.join(tempDir, 'missing-bean-check'),
    mode: 'required',
  })

  assert.equal(result.ok, false)
  assert.equal(result.status, 'failed')
  assert.match(result.error ?? '', /was not found/)
})
