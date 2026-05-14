import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-csv-reimport-final-state-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { stageTransactionsCsv } = require('../lib/ingest/csv-import') as typeof import('../lib/ingest/csv-import')
const { restoreStagedTransaction } = require('../lib/ingest/staged') as typeof import('../lib/ingest/staged')

type FinalStatus = 'ignored' | 'deleted'

interface StagedRow {
  id: string
  status: string
  validationErrors: string | null
  sourceItemKey: string
}

interface RawRow {
  status: string
  sourceItemKey: string
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM staged_transactions;
    DELETE FROM raw_import_items;
    DELETE FROM import_runs;
    DELETE FROM import_profile_mappings;
    DELETE FROM import_profiles;
    DELETE FROM source_accounts;
    DELETE FROM source_connections;
    DELETE FROM sources;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-checking',
    'Main Checking',
    'USD',
    '0.00',
    1775001600,
    'test-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    'Assets:US:Banks:MainChecking',
    1775001600,
  )
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
}

function oneRowCsv(externalId: string): string {
  return [
    'Date,Description,Amount,Account,Category,Notes,Tags,Status,External ID',
    `2026-05-01,Coffee Shop,-3.50,Main Checking,Expenses:Food:Coffee,Morning,coffee,posted,${externalId}`,
  ].join('\n')
}

function duplicateCsv(): string {
  return [
    'Date,Description,Amount,Account,External ID',
    '2026-05-01,Coffee Shop,-3.50,Main Checking,duplicate-001',
    '2026-05-01,Coffee Shop,-3.50,Main Checking,duplicate-001',
  ].join('\n')
}

function markOnlyStagedRow(importRunId: string, status: FinalStatus): void {
  sqlite.prepare(`
    UPDATE staged_transactions
    SET status = ?,
        validation_errors = ?
    WHERE import_run_id = ?
  `).run(status, JSON.stringify([]), importRunId)
}

function stagedRowsForRun(importRunId: string): StagedRow[] {
  return sqlite.prepare(`
    SELECT
      id,
      status,
      validation_errors AS validationErrors,
      source_item_key AS sourceItemKey
    FROM staged_transactions
    WHERE import_run_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(importRunId) as StagedRow[]
}

function rawRowsForRun(importRunId: string): RawRow[] {
  return sqlite.prepare(`
    SELECT
      status,
      source_item_key AS sourceItemKey
    FROM raw_import_items
    WHERE import_run_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(importRunId) as RawRow[]
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('re-import preserves a previously ignored source item as ignored', () => {
  const csv = oneRowCsv('final-ignored-001')
  const first = stageTransactionsCsv(csv, {})

  assert.equal(first.staged, 1)
  markOnlyStagedRow(first.importRunId, 'ignored')

  const second = stageTransactionsCsv(csv, {})
  assert.equal(second.totalRows, 1)
  assert.equal(second.rawInserted, 1)
  assert.equal(second.staged, 0)
  assert.equal(second.duplicates, 0)
  assert.deepEqual(second.errors, [])
  assert.equal(countRows('transactions'), 0)

  const stagedRows = stagedRowsForRun(second.importRunId)
  assert.equal(stagedRows.length, 1)
  assert.equal(stagedRows[0].status, 'ignored')
  assert.deepEqual(JSON.parse(stagedRows[0].validationErrors ?? 'null'), [])

  const rawRows = rawRowsForRun(second.importRunId)
  assert.equal(rawRows.length, 1)
  assert.equal(rawRows[0].status, 'ignored')
  assert.equal(rawRows[0].sourceItemKey, stagedRows[0].sourceItemKey)
})

test('re-import follows the latest restored staged state instead of older final disposition', () => {
  const csv = oneRowCsv('final-restored-001')
  const first = stageTransactionsCsv(csv, {})
  markOnlyStagedRow(first.importRunId, 'ignored')

  const second = stageTransactionsCsv(csv, {})
  const secondRows = stagedRowsForRun(second.importRunId)
  assert.equal(secondRows[0].status, 'ignored')

  const restored = restoreStagedTransaction({
    importRunId: second.importRunId,
    stagedTransactionId: secondRows[0].id,
  })
  assert.equal(restored.status, 'ready')

  const third = stageTransactionsCsv(csv, {})
  assert.equal(third.rawInserted, 1)
  assert.equal(third.staged, 1)
  assert.equal(third.duplicates, 0)
  assert.deepEqual(third.errors, [])

  const thirdRows = stagedRowsForRun(third.importRunId)
  assert.equal(thirdRows.length, 1)
  assert.equal(thirdRows[0].status, 'staged')
})

test('re-import preserves a previously deleted source item as deleted', () => {
  const csv = oneRowCsv('final-deleted-001')
  const first = stageTransactionsCsv(csv, {})

  assert.equal(first.staged, 1)
  markOnlyStagedRow(first.importRunId, 'deleted')

  const second = stageTransactionsCsv(csv, {})
  assert.equal(second.rawInserted, 1)
  assert.equal(second.staged, 0)
  assert.equal(second.duplicates, 0)
  assert.deepEqual(second.errors, [])
  assert.equal(countRows('transactions'), 0)

  const stagedRows = stagedRowsForRun(second.importRunId)
  assert.equal(stagedRows.length, 1)
  assert.equal(stagedRows[0].status, 'deleted')
  assert.deepEqual(JSON.parse(stagedRows[0].validationErrors ?? 'null'), [])

  const rawRows = rawRowsForRun(second.importRunId)
  assert.equal(rawRows.length, 1)
  assert.equal(rawRows[0].status, 'ignored')
})

test('same-run duplicate source item keys keep the original duplicate count', () => {
  const result = stageTransactionsCsv(duplicateCsv(), {})

  assert.equal(result.totalRows, 2)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 1)
  assert.equal(result.duplicates, 1)
  assert.deepEqual(result.errors, [])
  assert.equal(countRows('raw_import_items'), 1)
  assert.equal(countRows('staged_transactions'), 1)
  assert.equal(countRows('transactions'), 0)
})

test('a normal CSV row without prior final state remains staged', () => {
  const result = stageTransactionsCsv(oneRowCsv('normal-staged-001'), {})

  assert.equal(result.totalRows, 1)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 1)
  assert.equal(result.duplicates, 0)
  assert.deepEqual(result.errors, [])

  const stagedRows = stagedRowsForRun(result.importRunId)
  assert.equal(stagedRows.length, 1)
  assert.equal(stagedRows[0].status, 'staged')
  assert.deepEqual(JSON.parse(stagedRows[0].validationErrors ?? 'null'), [])
})
