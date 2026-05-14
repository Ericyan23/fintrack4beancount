import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-transactions-query-splits-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  listTransactions,
  listTransactionsForExport,
} = require('../lib/transactions/query') as typeof import('../lib/transactions/query')

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(): string {
  const id = 'acct-split-summary'

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Split Summary Checking',
    'USD',
    '0.00',
    1775001600,
    'split-summary-test',
    'Split Summary Bank',
    'split-summary.test',
    'depository',
    null,
    'Assets:US:Banks:SplitSummaryChecking',
    1775001600,
  )

  return id
}

function insertTransaction(input: {
  id: string
  accountId: string
  posted: number
  amount?: string
  description?: string
}): void {
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
    input.id,
    input.accountId,
    'manual',
    input.posted,
    input.posted,
    input.amount ?? '-1.00',
    input.description ?? input.id,
    0,
    'posted',
    'Expenses:Test',
    null,
    null,
    JSON.stringify([]),
    1775001600,
    1775001600,
  )
}

function insertSplit(parentTransactionId: string, sortOrder: number, amount: string): void {
  sqlite.prepare(`
    INSERT INTO transaction_splits (
      id,
      parent_transaction_id,
      split_group_id,
      amount,
      currency,
      ledger_account,
      memo,
      notes,
      sort_order,
      created_from,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `split:${parentTransactionId}:${sortOrder}`,
    parentTransactionId,
    `split:${parentTransactionId}`,
    amount,
    'USD',
    `Expenses:Split:${sortOrder}`,
    null,
    null,
    sortOrder,
    'manual_split',
    1775001600,
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

test('listTransactions returns split count without duplicating parent rows', () => {
  const accountId = insertAccount()
  insertTransaction({ id: 'txn-old', accountId, posted: 1775001600 })
  insertTransaction({
    id: 'txn-split',
    accountId,
    posted: 1775001700,
    amount: '-10.00',
    description: 'Split parent',
  })
  insertTransaction({ id: 'txn-new', accountId, posted: 1775001800 })
  insertSplit('txn-split', 0, '-4.00')
  insertSplit('txn-split', 1, '-6.00')

  const page = listTransactions({}, 2, 0)

  assert.equal(page.total, 3)
  assert.equal(page.hasMore, true)
  assert.deepEqual(page.transactions.map(row => row.id), ['txn-new', 'txn-split'])
  assert.equal(page.transactions.find(row => row.id === 'txn-new')?.splitCount, undefined)
  assert.equal(page.transactions.find(row => row.id === 'txn-split')?.splitCount, 2)

  const allRows = listTransactions({}, 10, 0)

  assert.equal(allRows.total, 3)
  assert.equal(allRows.hasMore, false)
  assert.deepEqual(allRows.transactions.map(row => row.id), ['txn-new', 'txn-split', 'txn-old'])
})

test('listTransactionsForExport carries the split summary on parent rows', () => {
  const accountId = insertAccount()
  insertTransaction({
    id: 'txn-split',
    accountId,
    posted: 1775001700,
    amount: '-10.00',
    description: 'Split parent',
  })
  insertSplit('txn-split', 0, '-4.00')
  insertSplit('txn-split', 1, '-6.00')

  const rows = listTransactionsForExport({})

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'txn-split')
  assert.equal(rows[0].accountName, 'Split Summary Checking')
  assert.equal(rows[0].splitCount, 2)
})
