import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import type { TransactionSplitRecord } from '../lib/ingest/splits'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-transaction-splits-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalDateNow = Date.now
const fixedNowMs = 1775001600000

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const splitsRoute = require('../app/api/transactions/[id]/splits/route') as typeof import('../app/api/transactions/[id]/splits/route')

interface RouteContext {
  params: Promise<{ id: string }>
}

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

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function params(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(id = 'acct-split-api-checking', currency = 'USD'): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Split API Checking',
    currency,
    '0.00',
    1775001600,
    'split-api-test',
    'Split API Bank',
    'split-api.test',
    'depository',
    null,
    'Assets:US:Banks:SplitApiChecking',
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
  const id = input.id ?? 'txn-split-api-parent'

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
    'Split API parent transaction',
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

function countSplits(): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transaction_splits
  `).get() as { value: number }

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
  Date.now = () => fixedNowMs
  resetDb()
})

after(() => {
  Date.now = originalDateNow
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('GET /api/transactions/:id/splits returns empty splits for an unsplit parent', async () => {
  const parentTransactionId = insertParentTransaction()

  const response = await splitsRoute.GET(
    request(`/api/transactions/${parentTransactionId}/splits`),
    params(parentTransactionId),
  )
  const payload = await response.json() as { splits: TransactionSplitRecord[] }

  assert.equal(response.status, 200)
  assert.deepEqual(payload.splits, [])
})

test('GET /api/transactions/:id/splits returns 404 for a missing parent transaction', async () => {
  const response = await splitsRoute.GET(
    request('/api/transactions/txn-missing/splits'),
    params('txn-missing'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Parent transaction not found: txn-missing')
})

test('PUT /api/transactions/:id/splits writes valid split rows with durable trace fields', async () => {
  const parentTransactionId = insertParentTransaction()

  const response = await splitsRoute.PUT(
    request(`/api/transactions/${parentTransactionId}/splits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    }),
    params(parentTransactionId),
  )
  const payload = await response.json() as { splits: TransactionSplitRecord[] }

  assert.equal(response.status, 200)
  assert.equal(payload.splits.length, 2)
  assert.equal(countSplits(), 2)
  assert.deepEqual(payload.splits.map(split => split.id), [
    `split:${parentTransactionId}:0`,
    `split:${parentTransactionId}:1`,
  ])
  assert.deepEqual(payload.splits.map(split => split.parentTransactionId), [
    parentTransactionId,
    parentTransactionId,
  ])
  assert.deepEqual(payload.splits.map(split => split.splitGroupId), [
    `split:${parentTransactionId}`,
    `split:${parentTransactionId}`,
  ])
  assert.deepEqual(payload.splits.map(split => split.createdFrom), ['manual_split', 'manual_split'])
  assert.deepEqual(payload.splits.map(split => split.createdAt), [1775001600, 1775001600])
  assert.deepEqual(payload.splits.map(split => split.updatedAt), [1775001600, 1775001600])
})

test('PUT /api/transactions/:id/splits returns 400 for invalid split totals', async () => {
  const parentTransactionId = insertParentTransaction()

  const response = await splitsRoute.PUT(
    request(`/api/transactions/${parentTransactionId}/splits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: [
          { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
          { amount: '-5.00', ledgerAccount: 'Expenses:Home' },
        ],
      }),
    }),
    params(parentTransactionId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Split amounts must sum exactly to parent transaction amount')
  assert.equal(countSplits(), 0)
})

test('PUT /api/transactions/:id/splits returns 409 for confirmed transfer parents', async () => {
  const outflowId = insertParentTransaction({ id: 'txn-split-api-transfer-out', amount: '-10.00' })
  const inflowAccountId = insertAccount('acct-split-api-transfer-in')
  const inflowId = insertParentTransaction({
    id: 'txn-split-api-transfer-in',
    accountId: inflowAccountId,
    amount: '10.00',
  })
  confirmTransfer(outflowId, inflowId)

  const response = await splitsRoute.PUT(
    request(`/api/transactions/${outflowId}/splits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: [
          { amount: '-4.25', ledgerAccount: 'Expenses:Food:Coffee' },
          { amount: '-5.75', ledgerAccount: 'Expenses:Office' },
        ],
      }),
    }),
    params(outflowId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 409)
  assert.match(payload.error ?? '', /part of confirmed transfer match/)
  assert.equal(countSplits(), 0)
})

test('DELETE /api/transactions/:id/splits clears split rows without mutating the parent', async () => {
  const parentTransactionId = insertParentTransaction()
  await splitsRoute.PUT(
    request(`/api/transactions/${parentTransactionId}/splits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: [
          { amount: '-4.25', ledgerAccount: 'Expenses:Food:Coffee' },
          { amount: '-5.75', ledgerAccount: 'Expenses:Office' },
        ],
      }),
    }),
    params(parentTransactionId),
  )
  const parentBeforeDelete = readParentTransaction(parentTransactionId)

  const response = await splitsRoute.DELETE(
    request(`/api/transactions/${parentTransactionId}/splits`, { method: 'DELETE' }),
    params(parentTransactionId),
  )
  const payload = await response.json() as { splits: TransactionSplitRecord[] }

  assert.equal(response.status, 200)
  assert.deepEqual(payload.splits, [])
  assert.equal(countSplits(), 0)
  assert.deepEqual(readParentTransaction(parentTransactionId), parentBeforeDelete)
})

test('PUT and DELETE /api/transactions/:id/splits return 404 for a missing parent transaction', async () => {
  const putResponse = await splitsRoute.PUT(
    request('/api/transactions/txn-missing/splits', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: [
          { amount: '-4.00', ledgerAccount: 'Expenses:Food' },
          { amount: '-6.00', ledgerAccount: 'Expenses:Home' },
        ],
      }),
    }),
    params('txn-missing'),
  )
  const putPayload = await putResponse.json() as { error?: string }

  assert.equal(putResponse.status, 404)
  assert.equal(putPayload.error, 'Parent transaction not found: txn-missing')

  const deleteResponse = await splitsRoute.DELETE(
    request('/api/transactions/txn-missing/splits', { method: 'DELETE' }),
    params('txn-missing'),
  )
  const deletePayload = await deleteResponse.json() as { error?: string }

  assert.equal(deleteResponse.status, 404)
  assert.equal(deletePayload.error, 'Parent transaction not found: txn-missing')
})
