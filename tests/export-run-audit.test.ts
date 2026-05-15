import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-export-run-audit-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
const handoffRoot = path.join(tempDir, 'handoff')
const originalDbPath = process.env.DB_PATH
const originalBeancountRoot = process.env.BEANCOUNT_ROOT
const originalHandoffRoot = process.env.FINTRACK_HANDOFF_ROOT

process.env.DB_PATH = dbPath
process.env.BEANCOUNT_ROOT = beancountRoot
process.env.FINTRACK_HANDOFF_ROOT = handoffRoot

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  HandoffValidationError,
  writeBeancountHandoff,
} = require('../lib/export/handoff-writer') as typeof import('../lib/export/handoff-writer')

const posted = Math.floor(Date.UTC(2026, 3, 15) / 1000)

interface ExportRunRow {
  id: string
  period: string
  status: string
  exportRangeStart: string
  exportRangeEnd: string
  generatedFileNames: string
  manifestPath: string
  ledgerRevision: string
  exportedSourceIds: string
  exportTarget: string
  metadata: string
  createdAt: number
  updatedAt: number
}

interface AuditLogRow {
  entityType: string
  entityId: string
  action: string
  actor: string
  reason: string | null
  beforeValues: string
  afterValues: string
  metadata: string | null
  createdAt: number
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM audit_log;
    DELETE FROM export_runs;
    DELETE FROM balance_assertions;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function writeLedger(): void {
  fs.rmSync(beancountRoot, { recursive: true, force: true })
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Export Run Audit Test"',
      '2026-01-01 open Assets:US:Banks:ExportRunChecking USD',
      '2026-01-01 open Expenses:Food:Coffee USD',
      '2026-01-01 open Equity:Opening-Balances USD',
      '2026-01-01 * "Opening balance"',
      '  Assets:US:Banks:ExportRunChecking          1239.31 USD',
      '  Equity:Opening-Balances',
      '',
    ].join('\n'),
  )
}

function seedExportableRows(): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-export-run-checking',
    'Export Run Checking',
    'USD',
    '1234.56',
    posted,
    'export-run-test',
    'Export Run Bank',
    'export-run.test',
    'depository',
    null,
    'Assets:US:Banks:ExportRunChecking',
    posted,
  )

  sqlite.prepare(`
    INSERT INTO transactions (
      id,
      account_id,
      source,
      posted,
      transacted_at,
      amount,
      description,
      pending,
      status,
      category,
      suggested_cat,
      notes,
      tags,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'txn-export-run-coffee',
    'acct-export-run-checking',
    'csv',
    posted,
    posted,
    '-4.75',
    'Coffee',
    0,
    'posted',
    'Expenses:Food:Coffee',
    null,
    null,
    null,
    posted,
    posted,
  )

  sqlite.prepare(`
    INSERT INTO balance_assertions (
      id,
      fintrack_account_id,
      beancount_account,
      assertion_date,
      amount,
      currency,
      source_id,
      status,
      note,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'assertion-export-run-balance',
    'acct-export-run-checking',
    'Assets:US:Banks:ExportRunChecking',
    '2026-04-30',
    '1234.56',
    'USD',
    'fintrack:balance:acct-export-run-checking:2026-04-30',
    'draft',
    'Statement balance',
    posted,
    posted,
  )
}

function selectExportRun(id: string): ExportRunRow {
  return sqlite.prepare(`
    SELECT id,
           period,
           status,
           export_range_start AS exportRangeStart,
           export_range_end AS exportRangeEnd,
           generated_file_names AS generatedFileNames,
           manifest_path AS manifestPath,
           ledger_revision AS ledgerRevision,
           exported_source_ids AS exportedSourceIds,
           export_target AS exportTarget,
           metadata,
           created_at AS createdAt,
           updated_at AS updatedAt
    FROM export_runs
    WHERE id = ?
  `).get(id) as ExportRunRow
}

function selectAuditRun(id: string): AuditLogRow {
  return sqlite.prepare(`
    SELECT entity_type AS entityType,
           entity_id AS entityId,
           action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata,
           created_at AS createdAt
    FROM audit_log
    WHERE entity_type = 'export_run'
      AND entity_id = ?
  `).get(id) as AuditLogRow
}

function scalar(sql: string): number {
  const row = sqlite.prepare(sql).get() as { value: number }
  return row.value
}

beforeEach(() => {
  resetDb()
  fs.rmSync(handoffRoot, { recursive: true, force: true })
  writeLedger()
  seedExportableRows()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
  if (originalDbPath === undefined) delete process.env.DB_PATH
  else process.env.DB_PATH = originalDbPath
  if (originalBeancountRoot === undefined) delete process.env.BEANCOUNT_ROOT
  else process.env.BEANCOUNT_ROOT = originalBeancountRoot
  if (originalHandoffRoot === undefined) delete process.env.FINTRACK_HANDOFF_ROOT
  else process.env.FINTRACK_HANDOFF_ROOT = originalHandoffRoot
})

test('beancount handoff writes an export run and audit row', () => {
  const generatedAt = new Date('2026-05-13T12:00:00.000Z')
  const expectedTimestamp = Math.floor(generatedAt.getTime() / 1000)

  const result = writeBeancountHandoff({
    period: '2026-04',
    generatedAt,
    handoffRoot,
    validation: {
      validatorCommand: process.execPath,
      validatorArgs: ['-e', 'process.exit(0)'],
      mode: 'required',
    },
    audit: {
      actor: 'tester',
      reason: 'monthly_close',
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.exportRun.period, '2026-04')
  assert.equal(result.exportRun.status, 'handoff_written')
  assert.equal(result.exportRun.exportRangeStart, '2026-04-01')
  assert.equal(result.exportRun.exportRangeEnd, '2026-04-30')
  assert.equal(result.exportRun.manifestPath, result.manifest.handoff.manifestFile)
  assert.equal(result.exportRun.ledgerRevision, result.manifest.ledger.revision)
  assert.equal(result.exportRun.exportTarget, 'beancount_handoff')
  assert.equal(result.exportRun.createdAt, expectedTimestamp)
  assert.equal(result.validation.status, 'passed')
  assert.deepEqual(result.manifest.validation, {
    ok: true,
    status: 'passed',
    mode: 'required',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    error: null,
    durationMs: result.validation.durationMs,
  })
  assert.deepEqual(result.exportRun.exportedSourceIds, [
    'fintrack:acct-export-run-checking:txn-export-run-coffee',
    'fintrack:balance:acct-export-run-checking:2026-04-30',
  ])
  assert.deepEqual(result.exportRun.generatedFileNames, result.files.map(file => file.relativePath))
  for (const file of result.files) {
    assert.equal(fs.existsSync(file.absolutePath), true, `expected ${file.absolutePath} to exist`)
  }

  const exportRun = selectExportRun(result.exportRun.id)
  assert.equal(exportRun.period, '2026-04')
  assert.equal(exportRun.status, 'handoff_written')
  assert.equal(exportRun.exportRangeStart, '2026-04-01')
  assert.equal(exportRun.exportRangeEnd, '2026-04-30')
  assert.deepEqual(JSON.parse(exportRun.generatedFileNames) as string[], result.exportRun.generatedFileNames)
  assert.equal(exportRun.manifestPath, result.manifest.handoff.manifestFile)
  assert.equal(exportRun.ledgerRevision, result.manifest.ledger.revision)
  assert.deepEqual(JSON.parse(exportRun.exportedSourceIds) as string[], result.exportRun.exportedSourceIds)
  assert.equal(exportRun.exportTarget, 'beancount_handoff')
  assert.equal(exportRun.createdAt, expectedTimestamp)
  assert.equal(exportRun.updatedAt, expectedTimestamp)

  const metadata = JSON.parse(exportRun.metadata) as {
    handoffDirectory: string
    counts: { transactions: number; balanceAssertions: number }
    files: Array<{ kind: string; relativePath: string; bytes: number }>
    validation: { status: string }
  }
  assert.equal(metadata.handoffDirectory, '2026-04/fintrack')
  assert.equal(metadata.counts.transactions, 1)
  assert.equal(metadata.counts.balanceAssertions, 1)
  assert.equal(metadata.files.length, 4)
  assert.equal(metadata.validation.status, 'passed')

  const auditRow = selectAuditRun(result.exportRun.id)
  assert.equal(auditRow.action, 'export_run_creation')
  assert.equal(auditRow.actor, 'tester')
  assert.equal(auditRow.reason, 'monthly_close')
  assert.equal(auditRow.createdAt, expectedTimestamp)
  assert.deepEqual(JSON.parse(auditRow.beforeValues) as Record<string, never>, {})

  const afterValues = JSON.parse(auditRow.afterValues) as typeof result.exportRun
  assert.equal(afterValues.id, result.exportRun.id)
  assert.equal(afterValues.period, '2026-04')
  assert.deepEqual(afterValues.exportedSourceIds, result.exportRun.exportedSourceIds)

  const auditMetadata = JSON.parse(auditRow.metadata ?? '{}') as {
    exportTarget: string
    generatedFileCount: number
    exportedSourceIdCount: number
    validationStatus: string
  }
  assert.equal(auditMetadata.exportTarget, 'beancount_handoff')
  assert.equal(auditMetadata.generatedFileCount, 4)
  assert.equal(auditMetadata.exportedSourceIdCount, 2)
  assert.equal(auditMetadata.validationStatus, 'passed')
})

test('beancount handoff validation failure blocks files and export run creation', () => {
  assert.throws(
    () => writeBeancountHandoff({
      period: '2026-04',
      generatedAt: new Date('2026-05-13T12:00:00.000Z'),
      handoffRoot,
      validation: {
        validatorCommand: process.execPath,
        validatorArgs: ['-e', 'process.stderr.write("invalid handoff"); process.exit(2)'],
        mode: 'required',
      },
    }),
    HandoffValidationError,
  )

  assert.equal(scalar('SELECT COUNT(*) AS value FROM export_runs'), 0)
  assert.equal(fs.existsSync(path.join(handoffRoot, '2026-04', 'fintrack', 'manifest.json')), false)
})
