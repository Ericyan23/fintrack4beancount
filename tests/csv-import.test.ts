import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFixture, readJsonFixture } from './helpers/fixtures'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-csv-import-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  previewTransactionsCsv,
} = require('../lib/ingest/csv-preview') as typeof import('../lib/ingest/csv-preview')

function resetDb(): void {
  sqlite.exec(`
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

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('CSV transaction preview', () => {
  test('previews a generic bank CSV with detected mapping', () => {
    const csv = readFixture('csv', 'generic-bank.csv')
    const preview = previewTransactionsCsv(csv)

    assert.deepEqual(preview.columns, [
      'Date',
      'Description',
      'Amount',
      'Account',
      'Category',
      'Notes',
      'Tags',
      'Status',
      'External ID',
    ])
    assert.equal(preview.totalRows, 3)
    assert.equal(preview.validRows, 3)
    assert.equal(preview.errorRows, 0)
    assert.equal(preview.mapping.date, 'Date')
    assert.equal(preview.mapping.externalId, 'External ID')
    assert.equal(preview.rows[0].description, 'Coffee Shop "Downtown"')
    assert.equal(preview.rows[2].status, 'pending')
  })

  test('previews unknown CSV accounts as errors without writing canonical transactions', () => {
    const csv = [
      'Date,Description,Amount,Account',
      '2026-05-01,Coffee Shop,-3.50,Unknown Account',
    ].join('\n')
    const preview = previewTransactionsCsv(csv)

    assert.equal(preview.totalRows, 1)
    assert.equal(preview.validRows, 0)
    assert.equal(preview.errorRows, 1)
    assert.equal(preview.rows[0].error, 'Unable to match account')
  })

  test('keeps a SimpleFIN sample payload available for ingestion tests', () => {
    const payload = readJsonFixture<{
      accounts: Array<{ id: string; transactions?: Array<{ pending?: boolean }> }>
    }>('simplefin', 'sample-payload.json')

    assert.equal(payload.accounts[0].id, 'simplefin-checking-001')
    assert.equal(payload.accounts[0].transactions?.length, 2)
    assert.equal(payload.accounts[0].transactions?.[1].pending, true)
  })
})
