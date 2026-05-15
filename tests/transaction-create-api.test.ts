import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-transaction-create-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalDateNow = Date.now
const fixedNowMs = 1775001600000

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const transactionRoute = require('../app/api/transactions/route') as typeof import('../app/api/transactions/route')

interface AuditRow {
  entityType: string
  entityId: string
  action: string
  actor: string
  reason: string | null
  beforeValues: string
  afterValues: string
  metadata: string | null
  createdAt: number
}

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM audit_log;
    DELETE FROM transaction_edit_history;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(id = 'acct-manual-create-checking'): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Manual Create Checking',
    'USD',
    '0.00',
    1775001600,
    'manual-create-test',
    'Manual Create Bank',
    'manual-create.test',
    'depository',
    null,
    'Assets:US:Banks:ManualCreateChecking',
    1775001600,
  )

  return id
}

function readAuditRows(): AuditRow[] {
  return sqlite.prepare(`
    SELECT entity_type AS entityType,
           entity_id AS entityId,
           action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata,
           created_at AS createdAt
    FROM audit_log
    ORDER BY id
  `).all() as AuditRow[]
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
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

test('POST /api/transactions creates an audited manual transaction', async () => {
  const accountId = insertAccount()

  const response = await transactionRoute.POST(
    request('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        postedDate: '2026-05-04',
        amount: ' (42.50) ',
        description: 'Manual receipt',
        ledgerAccount: 'Expenses:Food:Restaurants',
        notes: 'entered from paper receipt',
        tags: ['receipt', ' receipt ', '', 'tax'],
        actor: 'eric',
        createReason: 'missing bank feed item',
      }),
    }),
  )
  const payload = await response.json()

  assert.equal(response.status, 201)
  assert.equal(response.headers.get('Location'), `/transactions/${payload.transaction.id}`)
  assert.equal(payload.auditLogId, 1)
  assert.equal(payload.transaction.accountId, accountId)
  assert.equal(payload.transaction.source, 'manual')
  assert.equal(payload.transaction.sourceItemKey, `manual:${payload.transaction.id}`)
  assert.equal(payload.transaction.posted, Math.floor(Date.UTC(2026, 4, 4) / 1000))
  assert.equal(payload.transaction.transactedAt, Math.floor(Date.UTC(2026, 4, 4) / 1000))
  assert.equal(payload.transaction.amount, '-42.50')
  assert.equal(payload.transaction.description, 'Manual receipt')
  assert.equal(payload.transaction.status, 'posted')
  assert.equal(payload.transaction.pending, false)
  assert.equal(payload.transaction.category, 'Expenses:Food:Restaurants')
  assert.equal(payload.transaction.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(payload.transaction.reviewStatus, 'reviewed')
  assert.equal(payload.transaction.classifier, 'manual_create')
  assert.equal(payload.transaction.notes, 'entered from paper receipt')
  assert.deepEqual(payload.transaction.tags, ['receipt', 'tax'])
  assert.equal(payload.transaction.createdAt, 1775001600)
  assert.equal(payload.transaction.updatedAt, 1775001600)
  assert.equal(payload.transaction.updatedBy, 'eric')

  const dbRow = sqlite.prepare(`
    SELECT source,
           source_item_key AS sourceItemKey,
           category,
           ledger_account AS ledgerAccount,
           review_status AS reviewStatus,
           tags
    FROM transactions
    WHERE id = ?
  `).get(payload.transaction.id) as {
    source: string
    sourceItemKey: string
    category: string
    ledgerAccount: string
    reviewStatus: string
    tags: string
  }
  assert.equal(dbRow.source, 'manual')
  assert.equal(dbRow.sourceItemKey, `manual:${payload.transaction.id}`)
  assert.equal(dbRow.category, 'Expenses:Food:Restaurants')
  assert.equal(dbRow.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(dbRow.reviewStatus, 'reviewed')
  assert.deepEqual(JSON.parse(dbRow.tags) as string[], ['receipt', 'tax'])

  const auditRows = readAuditRows()
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].entityType, 'transaction')
  assert.equal(auditRows[0].entityId, payload.transaction.id)
  assert.equal(auditRows[0].action, 'transaction_manual_create')
  assert.equal(auditRows[0].actor, 'eric')
  assert.equal(auditRows[0].reason, 'missing bank feed item')
  assert.equal(auditRows[0].beforeValues, '{}')
  assert.equal(auditRows[0].createdAt, 1775001600)

  const afterValues = JSON.parse(auditRows[0].afterValues) as {
    transaction: { sourceItemKey: string; ledgerAccount: string; tags: string[] }
  }
  assert.equal(afterValues.transaction.sourceItemKey, `manual:${payload.transaction.id}`)
  assert.equal(afterValues.transaction.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.deepEqual(afterValues.transaction.tags, ['receipt', 'tax'])

  const metadata = JSON.parse(auditRows[0].metadata ?? '{}') as {
    source: string
    sourceItemKey: string
    accountId: string
  }
  assert.deepEqual(metadata, {
    source: 'manual',
    sourceItemKey: `manual:${payload.transaction.id}`,
    accountId,
  })
})

test('POST /api/transactions creates needs-review manual rows without a ledger account', async () => {
  const accountId = insertAccount()

  const response = await transactionRoute.POST(
    request('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        postedDate: '2026-05-05',
        amount: '25',
        description: 'Cash reimbursement',
      }),
    }),
  )
  const payload = await response.json()

  assert.equal(response.status, 201)
  assert.equal(payload.transaction.category, null)
  assert.equal(payload.transaction.ledgerAccount, null)
  assert.equal(payload.transaction.reviewStatus, 'needs_review')
  assert.equal(payload.transaction.updatedBy, 'local')
  assert.equal(readAuditRows()[0].reason, 'transaction_manual_create')
})

test('POST /api/transactions returns validation errors without creating rows', async () => {
  insertAccount()

  const response = await transactionRoute.POST(
    request('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'missing-account',
        postedDate: '2026-02-31',
        amount: 'not money',
        description: '',
      }),
    }),
  )
  const payload = await response.json() as { error?: string; validationErrors?: string[] }

  assert.equal(response.status, 400)
  assert.deepEqual(payload.validationErrors, [
    'postedDate must be a valid YYYY-MM-DD date',
    'amount must be a decimal string',
    'description is required',
    'accountId was not found',
  ])
  assert.equal(countRows('transactions'), 0)
  assert.equal(countRows('audit_log'), 0)
})

test('POST /api/transactions rejects non-object JSON bodies', async () => {
  const response = await transactionRoute.POST(
    request('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    }),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Request body must be a JSON object')
})
