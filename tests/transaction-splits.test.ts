import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-transaction-splits-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  hasTransactionSplits,
  listTransactionSplits,
  replaceTransactionSplits,
} = require('../lib/ingest/splits') as typeof import('../lib/ingest/splits')

interface ParentSnapshot {
  id: string
  accountId: string
  source: string
  posted: number
  transactedAt: number | null
  amount: string
  description: string
  pending: number
  status: string
  category: string | null
  suggestedCat: string | null
  notes: string | null
  tags: string | null
  createdAt: number
  updatedAt: number | null
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(id = 'acct-split-checking', currency = 'USD'): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Split Checking',
    currency,
    '0.00',
    1775001600,
    'split-test',
    'Split Bank',
    'split.test',
    'depository',
    null,
    'Assets:US:Banks:SplitChecking',
    1775001600,
  )

  return id
}

function insertParentTransaction(input: {
  id?: string
  accountId?: string
  amount?: string
} = {}): string {
  const accountId = input.accountId ?? insertAccount()
  const id = input.id ?? 'txn-split-parent'

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
    id,
    accountId,
    'manual',
    1775001600,
    1775001600,
    input.amount ?? '-10.00',
    'Split parent transaction',
    0,
    'posted',
    'Expenses:Uncategorized',
    null,
    'Parent note',
    JSON.stringify(['parent']),
    1775001600,
    1775001600,
  )

  return id
}

function readParentTransaction(id: string): ParentSnapshot {
  return sqlite.prepare(`
    SELECT id,
           account_id AS accountId,
           source,
           posted,
           transacted_at AS transactedAt,
           amount,
           description,
           pending,
           status,
           category,
           suggested_cat AS suggestedCat,
           notes,
           tags,
           created_at AS createdAt,
           updated_at AS updatedAt
    FROM transactions
    WHERE id = ?
  `).get(id) as ParentSnapshot
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
}

function confirmTransfer(outflowTransactionId: string, inflowTransactionId: string): void {
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
    outflowTransactionId,
    inflowTransactionId,
    'internal',
    'confirmed',
    100,
    0,
    'test confirmed transfer',
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

test('replace/list creates traceable split rows without changing the parent transaction', () => {
  const parentTransactionId = insertParentTransaction()
  const parentBefore = readParentTransaction(parentTransactionId)
  const transactionCountBefore = countRows('transactions')

  assert.equal(hasTransactionSplits(parentTransactionId), false)

  const rows = replaceTransactionSplits({
    parentTransactionId,
    splits: [
      {
        amount: '-4.25',
        ledgerAccount: 'Expenses:Food:Coffee',
        memo: 'Coffee',
      },
      {
        amount: '-5.75',
        ledgerAccount: 'Expenses:Office',
        notes: 'Supplies',
      },
    ],
  })

  assert.equal(rows.length, 2)
  assert.equal(countRows('transaction_splits'), 2)
  assert.equal(hasTransactionSplits(parentTransactionId), true)
  assert.deepEqual(listTransactionSplits(parentTransactionId), rows)

  assert.deepEqual(rows.map(row => row.id), [
    `split:${parentTransactionId}:0`,
    `split:${parentTransactionId}:1`,
  ])
  assert.deepEqual(rows.map(row => row.parentTransactionId), [
    parentTransactionId,
    parentTransactionId,
  ])
  assert.deepEqual(rows.map(row => row.splitGroupId), [
    `split:${parentTransactionId}`,
    `split:${parentTransactionId}`,
  ])
  assert.deepEqual(rows.map(row => row.createdFrom), ['manual_split', 'manual_split'])
  assert.deepEqual(rows.map(row => row.sortOrder), [0, 1])
  assert.deepEqual(rows.map(row => row.currency), ['USD', 'USD'])
  assert.deepEqual(rows.map(row => row.amount), ['-4.25', '-5.75'])
  assert.deepEqual(rows.map(row => row.ledgerAccount), [
    'Expenses:Food:Coffee',
    'Expenses:Office',
  ])

  assert.deepEqual(readParentTransaction(parentTransactionId), parentBefore)
  assert.equal(countRows('transactions'), transactionCountBefore)
})

test('replace deletes prior splits and writes the new split set atomically', () => {
  const parentTransactionId = insertParentTransaction({ amount: '-12.00' })

  replaceTransactionSplits({
    parentTransactionId,
    splits: [
      { amount: '-7.00', ledgerAccount: 'Expenses:Food' },
      { amount: '-5.00', ledgerAccount: 'Expenses:Home' },
    ],
  })

  const rows = replaceTransactionSplits({
    parentTransactionId,
    splits: [
      { amount: '-3.00', ledgerAccount: 'Expenses:Travel' },
      { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
      { amount: '-5.00', ledgerAccount: 'Expenses:Home' },
    ],
  })

  assert.equal(countRows('transaction_splits'), 3)
  assert.deepEqual(rows.map(row => row.amount), ['-3.00', '-4.00', '-5.00'])
  assert.deepEqual(rows.map(row => row.sortOrder), [0, 1, 2])
})

test('sum mismatch rejects without writing splits', () => {
  const parentTransactionId = insertParentTransaction({ amount: '-10.00' })

  assert.throws(
    () => replaceTransactionSplits({
      parentTransactionId,
      splits: [
        { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
        { amount: '-5.00', ledgerAccount: 'Expenses:Home' },
      ],
    }),
    /sum exactly/,
  )

  assert.equal(countRows('transaction_splits'), 0)
})

test('missing parent rejects without writing splits', () => {
  assert.throws(
    () => replaceTransactionSplits({
      parentTransactionId: 'txn-missing',
      splits: [
        { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
        { amount: '-6.00', ledgerAccount: 'Expenses:Home' },
      ],
    }),
    /Parent transaction not found/,
  )

  assert.equal(countRows('transaction_splits'), 0)
})

test('less than two split rows rejects without writing splits', () => {
  const parentTransactionId = insertParentTransaction({ amount: '-10.00' })

  assert.throws(
    () => replaceTransactionSplits({
      parentTransactionId,
      splits: [
        { amount: '-10.00', ledgerAccount: 'Expenses:Food' },
      ],
    }),
    /at least 2/,
  )

  assert.equal(countRows('transaction_splits'), 0)
})

test('invalid decimal amount rejects without writing splits', () => {
  const parentTransactionId = insertParentTransaction({ amount: '-10.00' })

  assert.throws(
    () => replaceTransactionSplits({
      parentTransactionId,
      splits: [
        { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
        { amount: '-6.0a', ledgerAccount: 'Expenses:Home' },
      ],
    }),
    /decimal string/,
  )

  assert.equal(countRows('transaction_splits'), 0)
})

test('split currency must match the parent transaction account currency', () => {
  const accountId = insertAccount('acct-split-eur-checking', 'USD')
  const parentTransactionId = insertParentTransaction({ accountId, amount: '-10.00' })

  assert.throws(
    () => replaceTransactionSplits({
      parentTransactionId,
      splits: [
        { amount: '-4.00', currency: 'EUR', ledgerAccount: 'Expenses:Food' },
        { amount: '-6.00', currency: 'EUR', ledgerAccount: 'Expenses:Home' },
      ],
    }),
    /currency must match parent transaction currency USD/,
  )

  assert.equal(countRows('transaction_splits'), 0)
})

test('confirmed transfer parents reject new split rows without writing splits', () => {
  const outflowId = insertParentTransaction({ id: 'txn-split-transfer-out', amount: '-10.00' })
  const inflowAccountId = insertAccount('acct-split-transfer-in', 'USD')
  const inflowId = insertParentTransaction({
    id: 'txn-split-transfer-in',
    accountId: inflowAccountId,
    amount: '10.00',
  })
  confirmTransfer(outflowId, inflowId)

  assert.throws(
    () => replaceTransactionSplits({
      parentTransactionId: outflowId,
      splits: [
        { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
        { amount: '-6.00', ledgerAccount: 'Expenses:Home' },
      ],
    }),
    /part of confirmed transfer match/,
  )

  assert.equal(countRows('transaction_splits'), 0)
})
