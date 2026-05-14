import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-review-groups-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { loadReviewGroups } = require('../lib/review') as typeof import('../lib/review')

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(id = 'acct-review-checking'): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Review Checking',
    'USD',
    '0.00',
    1775001600,
    'review-test',
    'Review Bank',
    'review.test',
    'depository',
    null,
    'Assets:US:Banks:ReviewChecking',
    1775001600,
  )

  return id
}

function insertReviewTransaction(input: {
  id: string
  accountId: string
  amount?: string
  description?: string
  category?: string | null
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
    VALUES (?, ?, 'manual', ?, ?, ?, ?, 0, 'posted', ?, NULL, NULL, NULL, ?, ?)
  `).run(
    input.id,
    input.accountId,
    1775001600,
    1775001600,
    input.amount ?? '-15.00',
    input.description ?? 'Split Review Merchant',
    input.category ?? null,
    1775001600,
    1775001600,
  )
}

function insertSplit(parentTransactionId: string, sortOrder: number, amount: string, ledgerAccount: string): void {
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
    VALUES (?, ?, ?, ?, 'USD', ?, NULL, NULL, ?, 'manual_split', ?, ?)
  `).run(
    `split-review-${sortOrder}`,
    parentTransactionId,
    'split-review-group',
    amount,
    ledgerAccount,
    sortOrder,
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

test('review groups include split summaries without duplicating parent transactions', () => {
  const accountId = insertAccount()
  insertReviewTransaction({ id: 'txn-review-split', accountId })
  insertSplit('txn-review-split', 0, '-10.00', 'Expenses:Food')
  insertSplit('txn-review-split', 1, '-5.00', 'Expenses:Household')

  const payload = loadReviewGroups()

  assert.equal(payload.summary.transactions, 1)
  assert.equal(payload.summary.groups, 1)
  assert.equal(payload.groups[0].count, 1)
  assert.equal(payload.groups[0].splitTransactionCount, 1)
  assert.equal(payload.groups[0].splitPostingCount, 2)
  assert.equal(payload.groups[0].transactions.length, 1)
  assert.equal(payload.groups[0].transactions[0].id, 'txn-review-split')
  assert.equal(payload.groups[0].transactions[0].splitCount, 2)
})
