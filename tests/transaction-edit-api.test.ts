import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-transaction-edit-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalDateNow = Date.now
const fixedNowMs = 1775001600000

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const transactionRoute = require('../app/api/transactions/[id]/route') as typeof import('../app/api/transactions/[id]/route')

interface RouteContext {
  params: Promise<{ id: string }>
}

interface HistoryRow {
  transactionId: string
  actor: string
  reason: string | null
  fields: string
  beforeValues: string
  afterValues: string
  createdAt: number
}

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function params(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transaction_edit_history;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(): string {
  const id = 'acct-edit-api-checking'

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Edit API Checking',
    'USD',
    '0.00',
    1775001600,
    'edit-api-test',
    'Edit API Bank',
    'edit-api.test',
    'depository',
    null,
    'Assets:US:Banks:EditApiChecking',
    1775001600,
  )

  return id
}

function insertTransaction(id = 'txn-edit-api-001'): string {
  const accountId = insertAccount()

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
      classifier,
      confidence,
      suggested_at,
      notes,
      tags,
      created_at,
      updated_at,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    accountId,
    'manual',
    1774915200,
    1774915200,
    '-12.34',
    'Manual edit target',
    0,
    'posted',
    'Expenses:Review',
    'Expenses:Food:Coffee',
    null,
    'needs_review',
    'Expenses:Food:Coffee',
    'rule',
    80,
    1774915200,
    'old note',
    JSON.stringify(['old']),
    1774915200,
    1774915200,
    null,
  )

  return id
}

function readHistory(): HistoryRow[] {
  return sqlite.prepare(`
    SELECT transaction_id AS transactionId,
           actor,
           reason,
           fields,
           before_values AS beforeValues,
           after_values AS afterValues,
           created_at AS createdAt
    FROM transaction_edit_history
    ORDER BY id
  `).all() as HistoryRow[]
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

test('PATCH /api/transactions/:id records manual ledger-account edit history', async () => {
  const transactionId = insertTransaction()

  const response = await transactionRoute.PATCH(
    request(`/api/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ledgerAccount: 'Expenses:Food:Restaurants',
        notes: 'receipt checked',
        actor: 'eric',
        editReason: 'manual review',
      }),
    }),
    params(transactionId),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(payload.category, 'Expenses:Food:Restaurants')
  assert.equal(payload.reviewStatus, 'reviewed')
  assert.equal(payload.classifier, 'manual_edit')
  assert.equal(payload.suggestedLedgerAccount, null)
  assert.equal(payload.suggestedCat, null)
  assert.equal(payload.notes, 'receipt checked')
  assert.equal(payload.updatedAt, 1775001600)
  assert.equal(payload.updatedBy, 'eric')

  const rows = readHistory()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].transactionId, transactionId)
  assert.equal(rows[0].actor, 'eric')
  assert.equal(rows[0].reason, 'manual review')
  assert.equal(rows[0].createdAt, 1775001600)

  const fields = JSON.parse(rows[0].fields) as string[]
  assert.ok(fields.includes('ledgerAccount'))
  assert.ok(fields.includes('category'))
  assert.ok(fields.includes('reviewStatus'))
  assert.ok(fields.includes('notes'))

  const beforeValues = JSON.parse(rows[0].beforeValues) as Record<string, unknown>
  const afterValues = JSON.parse(rows[0].afterValues) as Record<string, unknown>
  assert.equal(beforeValues.ledgerAccount, null)
  assert.equal(beforeValues.category, 'Expenses:Review')
  assert.equal(beforeValues.notes, 'old note')
  assert.equal(afterValues.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(afterValues.category, 'Expenses:Food:Restaurants')
  assert.equal(afterValues.notes, 'receipt checked')
})

test('PATCH /api/transactions/:id returns existing row without audit history for no-op edits', async () => {
  const transactionId = insertTransaction()

  const response = await transactionRoute.PATCH(
    request(`/api/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: 'old note',
        actor: 'eric',
      }),
    }),
    params(transactionId),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.notes, 'old note')
  assert.equal(payload.updatedAt, 1774915200)
  assert.equal(payload.updatedBy, null)
  assert.deepEqual(readHistory(), [])
})

test('PATCH /api/transactions/:id returns 404 for a missing transaction without audit history', async () => {
  const response = await transactionRoute.PATCH(
    request('/api/transactions/txn-missing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'missing' }),
    }),
    params('txn-missing'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Not found')
  assert.deepEqual(readHistory(), [])
})
