import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFixture } from './helpers/fixtures'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-csv-import-api-compat-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const route = require('../app/api/import/transactions/route') as typeof import('../app/api/import/transactions/route')
const stageRoute = require('../app/api/import/transactions/stage/route') as typeof import('../app/api/import/transactions/stage/route')

interface CompatCsvImportPayload {
  imported: number
  skipped: number
  compatibilityMode: string
  importRunId: string
  reviewUrl: string
  totalRows: number
  rawInserted: number
  staged: number
  duplicates: number
  errors: Array<{ rowNumber: number; error: string }>
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

function request(body: unknown): Parameters<typeof route.POST>[0] {
  return new Request('http://fintrack.test/api/import/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof route.POST>[0]
}

function stageRequest(body: unknown): Parameters<typeof stageRoute.POST>[0] {
  return new Request('http://fintrack.test/api/import/transactions/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof stageRoute.POST>[0]
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('POST /api/import/transactions stages rows instead of writing canonical transactions', async () => {
  const response = await route.POST(request({
    csv: readFixture('csv', 'generic-bank.csv'),
    mapping: {
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
      account: 'Account',
      category: 'Category',
      notes: 'Notes',
      tags: 'Tags',
      status: 'Status',
      externalId: 'External ID',
    },
  }))
  const payload = (await response.json()) as CompatCsvImportPayload

  assert.equal(response.status, 200)
  assert.match(
    response.headers.get('warning') ?? '',
    /Deprecated CSV compatibility endpoint stages rows/,
  )
  assert.equal(payload.compatibilityMode, 'staged')
  assert.equal(payload.reviewUrl, `/import/runs/${encodeURIComponent(payload.importRunId)}`)
  assert.equal(payload.imported, 3)
  assert.equal(payload.skipped, 0)
  assert.equal(payload.totalRows, 3)
  assert.equal(payload.rawInserted, 3)
  assert.equal(payload.staged, 3)
  assert.equal(payload.duplicates, 0)
  assert.deepEqual(payload.errors, [])

  assert.equal(countRows('import_runs'), 1)
  assert.equal(countRows('raw_import_items'), 3)
  assert.equal(countRows('staged_transactions'), 3)
  assert.equal(countRows('transactions'), 0)
})

test('POST /api/import/transactions/stage returns the import run review URL', async () => {
  const response = await stageRoute.POST(stageRequest({
    csv: readFixture('csv', 'generic-bank.csv'),
    mapping: {
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
      account: 'Account',
      category: 'Category',
      notes: 'Notes',
      tags: 'Tags',
      status: 'Status',
      externalId: 'External ID',
    },
  }))
  const payload = (await response.json()) as CompatCsvImportPayload

  assert.equal(response.status, 200)
  assert.equal(payload.reviewUrl, `/import/runs/${encodeURIComponent(payload.importRunId)}`)
  assert.equal(payload.staged, 3)
  assert.equal(countRows('transactions'), 0)
})
