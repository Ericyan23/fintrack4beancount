import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-beancount-preflight-splits-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { runBeancountPreflight } = require('../lib/export/preflight') as typeof import('../lib/export/preflight')

const parentTransactionId = 'txn-split-parent'
const parentAccountId = 'acct-split-checking'
const posted = Math.floor(Date.UTC(2026, 3, 1) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM balance_assertions;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function writeLedger(openAccounts: string[]): void {
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Split Preflight Test"',
      ...openAccounts.map(account => `2026-01-01 open ${account} USD`),
      '',
    ].join('\n'),
  )
}

function insertSplitTransaction(input: {
  parentAmount?: string
  firstAmount?: string
  firstCurrency?: string
  firstLedgerAccount?: string
  omitSecondSplit?: boolean
  secondLedgerAccount?: string
  secondAmount?: string
  secondCurrency?: string
  category?: string | null
} = {}): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parentAccountId,
    'Split Checking',
    'USD',
    '0.00',
    posted,
    'split-test',
    'Split Bank',
    'split.test',
    'depository',
    null,
    'Assets:US:Banks:SplitChecking',
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
    parentTransactionId,
    parentAccountId,
    'csv',
    posted,
    posted,
    input.parentAmount ?? '-10.00',
    'Split groceries and supplies',
    0,
    'posted',
    input.category ?? null,
    null,
    null,
    null,
    posted,
    posted,
  )

  const insertSplit = sqlite.prepare(`
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
  `)

  insertSplit.run(
    `split:${parentTransactionId}:0`,
    parentTransactionId,
    `split:${parentTransactionId}`,
    input.firstAmount ?? '-4.25',
    input.firstCurrency ?? 'USD',
    input.firstLedgerAccount ?? 'Expenses:Food:Groceries',
    'Groceries',
    null,
    0,
    'manual_split',
    posted,
    posted,
  )
  if (!input.omitSecondSplit) {
    insertSplit.run(
      `split:${parentTransactionId}:1`,
      parentTransactionId,
      `split:${parentTransactionId}`,
      input.secondAmount ?? '-5.75',
      input.secondCurrency ?? 'USD',
      input.secondLedgerAccount ?? 'Expenses:Office',
      null,
      'Supplies',
      1,
      'manual_split',
      posted,
      posted,
    )
  }
}

function confirmParentTransfer(input: { counterpartyPosted?: number } = {}): void {
  const counterpartyPosted = input.counterpartyPosted ?? posted

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-split-counterparty',
    'Split Counterparty',
    'USD',
    '0.00',
    posted,
    'split-test',
    'Split Bank',
    'split.test',
    'depository',
    null,
    'Assets:US:Banks:SplitCounterparty',
    counterpartyPosted,
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
    'txn-split-counterparty',
    'acct-split-counterparty',
    'csv',
    counterpartyPosted,
    counterpartyPosted,
    '10.00',
    'Transfer counterparty',
    0,
    'posted',
    'Transfer:Internal',
    null,
    null,
    null,
    counterpartyPosted,
    counterpartyPosted,
  )

  sqlite.prepare(`
    INSERT INTO transfer_matches (
      outflow_transaction_id,
      inflow_transaction_id,
      kind,
      status,
      confidence,
      date_delta_days,
      reason,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parentTransactionId,
    'txn-split-counterparty',
    'internal',
    'confirmed',
    100,
    0,
    'test confirmed transfer',
    posted,
    posted,
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

test('preflight attaches split postings without requiring the parent category', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertSplitTransaction()

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, true)
  assert.equal(result.exportableTransactions.length, 1)
  assert.equal(result.exportableTransactions[0].sourceId, `fintrack:${parentAccountId}:${parentTransactionId}`)
  assert.deepEqual(
    result.exportableTransactions[0].splitPostings?.map(split => ({
      id: split.id,
      amount: split.amount,
      ledgerAccount: split.ledgerAccount,
    })),
    [
      {
        id: `split:${parentTransactionId}:0`,
        amount: '-4.25',
        ledgerAccount: 'Expenses:Food:Groceries',
      },
      {
        id: `split:${parentTransactionId}:1`,
        amount: '-5.75',
        ledgerAccount: 'Expenses:Office',
      },
    ],
  )
  assert.equal(result.blockers.some(issue => issue.code === 'missing_category'), false)
})

test('preflight blocks when a split ledger account is not open', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
  ])
  insertSplitTransaction({ secondLedgerAccount: 'Expenses:Missing' })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'split_account_not_open')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.ok(blocker, `Expected split_account_not_open blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
  assert.equal(blocker.splitId, `split:${parentTransactionId}:1`)
  assert.equal(blocker.account, 'Expenses:Missing')
  assert.equal(result.blockers.some(issue => issue.code === 'missing_category'), false)
})

test('preflight blocks when split amounts do not balance to the parent amount', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertSplitTransaction({ secondAmount: '-5.00' })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'split_amount_mismatch')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.ok(blocker, `Expected split_amount_mismatch blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
})

test('preflight blocks when a persisted split has only one posting row', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
  ])
  insertSplitTransaction({
    firstAmount: '-10.00',
    omitSecondSplit: true,
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'split_count_invalid')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.ok(blocker, `Expected split_count_invalid blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
})

test('preflight blocks when a persisted split amount is not a decimal string', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertSplitTransaction({ secondAmount: '-5.bad' })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'split_amount_invalid')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.ok(blocker, `Expected split_amount_invalid blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
})

test('preflight blocks when a split currency differs from the parent transaction currency', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertSplitTransaction({ secondCurrency: 'EUR' })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'split_currency_mismatch')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.ok(blocker, `Expected split_currency_mismatch blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
  assert.equal(blocker.splitId, `split:${parentTransactionId}:1`)
})

test('preflight blocks when confirmed transfer parents have split postings', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Assets:US:Banks:SplitCounterparty',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertSplitTransaction()
  confirmParentTransfer()

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'confirmed_transfer_has_splits')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.equal(result.mergedTransfers.length, 0)
  assert.ok(blocker, `Expected confirmed_transfer_has_splits blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
  assert.equal(blocker.transferMatchId, 1)
})

test('preflight blocks confirmed transfer splits even when the split side is outside the export period', () => {
  const marchPosted = Math.floor(Date.UTC(2026, 2, 31) / 1000)

  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Assets:US:Banks:SplitCounterparty',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertSplitTransaction()
  confirmParentTransfer({ counterpartyPosted: marchPosted })

  const result = runBeancountPreflight({ period: '2026-03', beancountRoot })
  const blocker = result.blockers.find(issue => issue.code === 'confirmed_transfer_has_splits')

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 0)
  assert.equal(result.mergedTransfers.length, 0)
  assert.ok(blocker, `Expected confirmed_transfer_has_splits blocker, got ${JSON.stringify(result.blockers)}`)
  assert.equal(blocker.transactionId, parentTransactionId)
})

test('preflight adds sign review items for split ledger accounts', () => {
  writeLedger([
    'Assets:US:Banks:SplitChecking',
    'Expenses:Food:Groceries',
    'Income:Adjustments',
  ])
  insertSplitTransaction({ secondLedgerAccount: 'Income:Adjustments' })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const reviewItem = result.reviewItems.find(issue => issue.code === 'negative_income')

  assert.equal(result.ok, true)
  assert.equal(result.exportableTransactions.length, 1)
  assert.ok(reviewItem, `Expected negative_income review item, got ${JSON.stringify(result.reviewItems)}`)
  assert.equal(reviewItem.transactionId, parentTransactionId)
  assert.equal(reviewItem.splitId, `split:${parentTransactionId}:1`)
  assert.equal(reviewItem.category, 'Income:Adjustments')
})
