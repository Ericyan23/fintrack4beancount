import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-beancount-preflight-intents-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { runBeancountPreflight } = require('../lib/export/preflight') as typeof import('../lib/export/preflight')

const posted = Math.floor(Date.UTC(2026, 3, 10) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM balance_assertions;
    DELETE FROM transactions;
    DELETE FROM source_accounts;
    DELETE FROM source_connections;
    DELETE FROM sources;
    DELETE FROM accounts;
  `)
}

function writeLedger(openAccounts: string[]): void {
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Preflight Intent Test"',
      ...openAccounts.map(account => `2026-01-01 open ${account} USD`),
      '',
    ].join('\n'),
  )
}

function insertAccount(input: {
  id: string
  name: string
  beancountAccount: string
  accountType?: string
}): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.name,
    'USD',
    '0.00',
    posted,
    'intent-test',
    'Intent Bank',
    'intent.test',
    input.accountType ?? 'depository',
    null,
    input.beancountAccount,
    posted,
  )
}

function insertTransaction(input: {
  id: string
  accountId: string
  sourceConnectionId?: string | null
  sourceAccountId?: string | null
  externalId?: string | null
  sourceItemKey?: string | null
  amount: string
  description: string
  category: string | null
  postedAt?: number
  source?: string
}): void {
  const postedAt = input.postedAt ?? posted

  sqlite.prepare(`
    INSERT INTO transactions (
      id,
      account_id,
      source_connection_id,
      source_account_id,
      external_id,
      source_item_key,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.accountId,
    input.sourceConnectionId ?? null,
    input.sourceAccountId ?? null,
    input.externalId ?? null,
    input.sourceItemKey ?? null,
    input.source ?? 'csv',
    postedAt,
    postedAt,
    input.amount,
    input.description,
    0,
    'posted',
    input.category,
    null,
    null,
    null,
    postedAt,
    postedAt,
  )
}

function expectedProvenanceSourceId(input: {
  sourceConnectionId: string
  sourceAccountId: string
  sourceItemKey: string
}): string {
  return [
    'fintrack',
    'source',
    encodeURIComponent(input.sourceConnectionId),
    encodeURIComponent(input.sourceAccountId),
    encodeURIComponent(input.sourceItemKey),
  ].join(':')
}

function insertSplit(input: {
  id: string
  parentTransactionId: string
  amount: string
  ledgerAccount: string
  memo?: string | null
  notes?: string | null
  sortOrder: number
}): void {
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
    input.id,
    input.parentTransactionId,
    `split:${input.parentTransactionId}`,
    input.amount,
    'USD',
    input.ledgerAccount,
    input.memo ?? null,
    input.notes ?? null,
    input.sortOrder,
    'manual_split',
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

test('preflight emits a cash transaction ledger intent for a normal transaction', () => {
  writeLedger([
    'Assets:US:Banks:IntentChecking',
    'Expenses:Food:Coffee',
  ])
  insertAccount({
    id: 'acct-intent-checking',
    name: 'Intent Checking',
    beancountAccount: 'Assets:US:Banks:IntentChecking',
  })
  insertTransaction({
    id: 'txn-intent-cash',
    accountId: 'acct-intent-checking',
    amount: '-4.75',
    description: 'Coffee',
    category: 'Expenses:Food:Coffee',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]

  assert.equal(result.ok, true)
  assert.equal(result.exportableTransactions.length, 1)
  assert.equal(result.exportableIntents.length, 1)
  assert.equal(intent.kind, 'cash_transaction')
  assert.equal(intent.sourceId, 'fintrack:acct-intent-checking:txn-intent-cash')
  assert.deepEqual(intent.transactionIds, ['txn-intent-cash'])
  assert.deepEqual(
    intent.postings.map(posting => ({
      account: posting.account,
      amount: posting.amount,
      currency: posting.currency,
      role: posting.role,
      transactionId: posting.transactionId,
    })),
    [
      {
        account: 'Assets:US:Banks:IntentChecking',
        amount: '-4.75',
        currency: 'USD',
        role: 'source',
        transactionId: 'txn-intent-cash',
      },
      {
        account: 'Expenses:Food:Coffee',
        amount: '4.75',
        currency: 'USD',
        role: 'category',
        transactionId: 'txn-intent-cash',
      },
    ],
  )
})

test('preflight uses provenance source id for cash transactions across editable changes', () => {
  writeLedger([
    'Assets:US:Banks:IntentChecking',
    'Expenses:Food:Coffee',
    'Expenses:Office',
  ])
  insertAccount({
    id: 'acct-intent-checking',
    name: 'Intent Checking',
    beancountAccount: 'Assets:US:Banks:IntentChecking',
  })
  const provenance = {
    sourceConnectionId: 'csv:manual',
    sourceAccountId: 'source-account:intent-checking',
    sourceItemKey: 'source-account:source-account:intent-checking:external:bank-csv-001',
  }
  sqlite.prepare(`
    INSERT OR IGNORE INTO sources (id, kind, name, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run('csv', 'csv', 'CSV Import', 'active', posted, posted)
  sqlite.prepare(`
    INSERT OR IGNORE INTO source_connections (id, source_id, name, status, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run(provenance.sourceConnectionId, 'csv', 'Manual CSV Uploads', 'active', posted, posted)
  sqlite.prepare(`
    INSERT OR IGNORE INTO source_accounts (
      id, source_connection_id, fintrack_account_id, external_account_id,
      name, currency, status, raw_payload, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    provenance.sourceAccountId,
    provenance.sourceConnectionId,
    'acct-intent-checking',
    'intent-checking',
    'Intent Checking',
    'USD',
    'active',
    posted,
    posted,
  )
  insertTransaction({
    id: 'txn-intent-provenance',
    accountId: 'acct-intent-checking',
    externalId: 'bank-csv-001',
    ...provenance,
    amount: '-4.75',
    description: 'Coffee',
    category: 'Expenses:Food:Coffee',
  })

  const before = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const expectedSourceId = expectedProvenanceSourceId(provenance)

  sqlite.prepare(`
    UPDATE transactions
    SET description = ?,
        ledger_account = ?,
        updated_at = ?
    WHERE id = ?
  `).run('Office coffee', 'Expenses:Office', posted + 1, 'txn-intent-provenance')
  sqlite.prepare(`
    UPDATE accounts
    SET name = ?,
        updated_at = ?
    WHERE id = ?
  `).run('Renamed Checking', posted + 1, 'acct-intent-checking')

  const after = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(before.ok, true)
  assert.equal(before.exportableIntents[0].sourceId, expectedSourceId)
  assert.equal(after.ok, true)
  assert.equal(after.exportableIntents[0].sourceId, expectedSourceId)
  assert.equal(after.exportableTransactions[0].description, 'Office coffee')
  assert.equal(after.exportableTransactions[0].category, 'Expenses:Office')
})

test('preflight emits a split transaction ledger intent with split postings and parent source id', () => {
  writeLedger([
    'Assets:US:Banks:IntentChecking',
    'Expenses:Food:Groceries',
    'Expenses:Office',
  ])
  insertAccount({
    id: 'acct-intent-checking',
    name: 'Intent Checking',
    beancountAccount: 'Assets:US:Banks:IntentChecking',
  })
  insertTransaction({
    id: 'txn-intent-split',
    accountId: 'acct-intent-checking',
    amount: '-10.00',
    description: 'Groceries and supplies',
    category: null,
  })
  insertSplit({
    id: 'split:txn-intent-split:0',
    parentTransactionId: 'txn-intent-split',
    amount: '-4.25',
    ledgerAccount: 'Expenses:Food:Groceries',
    memo: 'Groceries',
    sortOrder: 0,
  })
  insertSplit({
    id: 'split:txn-intent-split:1',
    parentTransactionId: 'txn-intent-split',
    amount: '-5.75',
    ledgerAccount: 'Expenses:Office',
    notes: 'Supplies',
    sortOrder: 1,
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]

  assert.equal(result.ok, true)
  assert.equal(result.exportableTransactions.length, 1)
  assert.equal(result.exportableIntents.length, 1)
  assert.equal(intent.kind, 'split_transaction')
  assert.equal(intent.sourceId, 'fintrack:acct-intent-checking:txn-intent-split')
  assert.deepEqual(intent.transactionIds, ['txn-intent-split'])
  assert.deepEqual(
    intent.postings.map(posting => ({
      account: posting.account,
      amount: posting.amount,
      role: posting.role,
      transactionId: posting.transactionId,
      splitId: posting.splitId,
      memo: posting.memo,
      notes: posting.notes,
    })),
    [
      {
        account: 'Assets:US:Banks:IntentChecking',
        amount: '-10.00',
        role: 'source',
        transactionId: 'txn-intent-split',
        splitId: undefined,
        memo: undefined,
        notes: undefined,
      },
      {
        account: 'Expenses:Food:Groceries',
        amount: '4.25',
        role: 'split',
        transactionId: 'txn-intent-split',
        splitId: 'split:txn-intent-split:0',
        memo: 'Groceries',
        notes: null,
      },
      {
        account: 'Expenses:Office',
        amount: '5.75',
        role: 'split',
        transactionId: 'txn-intent-split',
        splitId: 'split:txn-intent-split:1',
        memo: null,
        notes: 'Supplies',
      },
    ],
  )
})

test('preflight emits a confirmed transfer ledger intent with both transaction ids', () => {
  writeLedger([
    'Assets:US:Banks:IntentChecking',
    'Liabilities:US:IntentCard',
  ])
  insertAccount({
    id: 'acct-intent-checking',
    name: 'Intent Checking',
    beancountAccount: 'Assets:US:Banks:IntentChecking',
  })
  insertAccount({
    id: 'acct-intent-card',
    name: 'Intent Card',
    accountType: 'credit',
    beancountAccount: 'Liabilities:US:IntentCard',
  })
  insertTransaction({
    id: 'txn-intent-transfer-out',
    accountId: 'acct-intent-checking',
    amount: '-120.00',
    description: 'Card payment',
    category: 'Transfer:CreditCardPayment',
  })
  insertTransaction({
    id: 'txn-intent-transfer-in',
    accountId: 'acct-intent-card',
    amount: '120.00',
    description: 'Payment received',
    category: 'Transfer:CreditCardPayment',
  })

  const transferMatchId = Number(sqlite.prepare(`
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
    'txn-intent-transfer-out',
    'txn-intent-transfer-in',
    'credit_card_payment',
    'confirmed',
    100,
    0,
    'test confirmed transfer',
    posted,
    posted,
  ).lastInsertRowid)

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]

  assert.equal(result.ok, true)
  assert.equal(result.exportableTransactions.length, 0)
  assert.equal(result.mergedTransfers.length, 1)
  assert.equal(result.exportableIntents.length, 1)
  assert.equal(intent.kind, 'confirmed_transfer')
  assert.equal(intent.transferMatchId, transferMatchId)
  assert.deepEqual(intent.transactionIds, ['txn-intent-transfer-out', 'txn-intent-transfer-in'])
  assert.deepEqual(
    intent.postings.map(posting => ({
      account: posting.account,
      amount: posting.amount,
      role: posting.role,
      transactionId: posting.transactionId,
    })),
    [
      {
        account: 'Assets:US:Banks:IntentChecking',
        amount: '-120.00',
        role: 'transfer',
        transactionId: 'txn-intent-transfer-out',
      },
      {
        account: 'Liabilities:US:IntentCard',
        amount: '120.00',
        role: 'transfer',
        transactionId: 'txn-intent-transfer-in',
      },
    ],
  )
})

test('preflight does not include blocked transactions in exportable intents', () => {
  writeLedger([
    'Assets:US:Banks:IntentChecking',
    'Expenses:Food:Coffee',
  ])
  insertAccount({
    id: 'acct-intent-checking',
    name: 'Intent Checking',
    beancountAccount: 'Assets:US:Banks:IntentChecking',
  })
  insertTransaction({
    id: 'txn-intent-valid',
    accountId: 'acct-intent-checking',
    amount: '-4.75',
    description: 'Coffee',
    category: 'Expenses:Food:Coffee',
  })
  insertTransaction({
    id: 'txn-intent-blocked',
    accountId: 'acct-intent-checking',
    amount: '-9.00',
    description: 'Missing category account',
    category: 'Expenses:Missing',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.exportableTransactions.length, 1)
  assert.equal(result.exportableIntents.length, 1)
  assert.equal(result.blockers.some(issue => issue.transactionId === 'txn-intent-blocked'), true)
  assert.deepEqual(result.exportableIntents.flatMap(intent => intent.transactionIds), ['txn-intent-valid'])
})
