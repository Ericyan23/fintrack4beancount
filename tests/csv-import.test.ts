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
  importTransactionsCsv,
  previewTransactionsCsv,
} = require('../lib/import/transactions') as typeof import('../lib/import/transactions')

interface TransactionRow {
  id: string
  accountId: string
  amount: string
  description: string
  pending: number
  status: string
  category: string | null
  notes: string | null
  tags: string
}

function resetDb(): void {
  sqlite.exec(`
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

function transactionRows(): TransactionRow[] {
  return sqlite.prepare(`
    SELECT
      id,
      account_id AS accountId,
      amount,
      description,
      pending,
      status,
      category,
      notes,
      tags
    FROM transactions
    ORDER BY posted ASC, id ASC
  `).all() as TransactionRow[]
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('CSV transaction import', () => {
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

  test('imports generic bank CSV rows into the existing transaction shape', () => {
    const csv = readFixture('csv', 'generic-bank.csv')
    const result = importTransactionsCsv(csv, {})

    assert.deepEqual(result, { imported: 3, skipped: 0, errors: [] })

    const rows = transactionRows()
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map(row => row.id), [
      'csv:bank-csv-001',
      'csv:bank-csv-002',
      'csv:bank-csv-003',
    ])

    assert.deepEqual(rows[0], {
      id: 'csv:bank-csv-001',
      accountId: 'acct-checking',
      amount: '-4.75',
      description: 'Coffee Shop "Downtown"',
      pending: 0,
      status: 'posted',
      category: 'Expenses:Food:Coffee',
      notes: 'Morning coffee',
      tags: JSON.stringify(['coffee', 'work']),
    })
    assert.equal(rows[2].pending, 1)
    assert.equal(rows[2].status, 'pending')
    assert.equal(rows[2].category, 'Expenses:Auto:Fuel')
  })

  test('skips duplicate CSV rows by stable external ID', () => {
    const csv = readFixture('csv', 'duplicate-import.csv')

    assert.deepEqual(importTransactionsCsv(csv, {}), {
      imported: 1,
      skipped: 1,
      errors: [],
    })
    assert.equal(transactionRows().length, 1)

    assert.deepEqual(importTransactionsCsv(csv, {}), {
      imported: 0,
      skipped: 2,
      errors: [],
    })
    assert.equal(transactionRows().length, 1)
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
