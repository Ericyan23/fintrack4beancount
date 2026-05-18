import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-review-groups-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { loadReviewGroups } = require('../lib/review') as typeof import('../lib/review')
const reviewRoute = require('../app/api/review/route') as typeof import('../app/api/review/route')

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

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
  ledgerAccount?: string | null
  reviewStatus?: string | null
  suggestedLedgerAccount?: string | null
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
      ledger_account,
      review_status,
      suggested_ledger_account,
      notes,
      tags,
      created_at,
      updated_at
    )
    VALUES (?, ?, 'manual', ?, ?, ?, ?, 0, 'posted', ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(
    input.id,
    input.accountId,
    1775001600,
    1775001600,
    input.amount ?? '-15.00',
    input.description ?? 'Split Review Merchant',
    input.category ?? null,
    input.ledgerAccount ?? null,
    input.reviewStatus ?? null,
    input.suggestedLedgerAccount ?? null,
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

test('review apply writes ledger account semantics while preserving category compatibility', async () => {
  const accountId = insertAccount()
  insertReviewTransaction({
    id: 'txn-review-apply',
    accountId,
    category: 'Expenses:Review',
    reviewStatus: 'needs_review',
    suggestedLedgerAccount: 'Expenses:Food:Restaurants',
  })

  const before = loadReviewGroups()
  assert.equal(before.summary.transactions, 1)
  assert.equal(before.groups[0].suggestedCategories[0].category, 'Expenses:Food:Restaurants')

  const response = await reviewRoute.POST(
    request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionIds: ['txn-review-apply'],
        category: 'Expenses:Food:Restaurants',
        createRule: false,
      }),
    }),
  )
  const payload = await response.json() as { changed?: number; ledgerAccount?: string }
  const row = sqlite.prepare(`
    SELECT
      category,
      suggested_cat AS suggestedCat,
      ledger_account AS ledgerAccount,
      review_status AS reviewStatus,
      suggested_ledger_account AS suggestedLedgerAccount,
      classifier
    FROM transactions
    WHERE id = 'txn-review-apply'
  `).get() as {
    category: string | null
    suggestedCat: string | null
    ledgerAccount: string | null
    reviewStatus: string | null
    suggestedLedgerAccount: string | null
    classifier: string | null
  }

  assert.equal(response.status, 200)
  assert.equal(payload.changed, 1)
  assert.equal(payload.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(row.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(row.reviewStatus, 'reviewed')
  assert.equal(row.category, 'Expenses:Review')
  assert.equal(row.suggestedLedgerAccount, null)
  assert.equal(row.suggestedCat, null)
  assert.equal(row.classifier, 'manual_review')
  assert.equal(loadReviewGroups().summary.transactions, 0)
})
