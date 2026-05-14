import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-simplefin-pending-reconciliation-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { buildSourceItemKey } = require('../lib/ingest/identity') as typeof import('../lib/ingest/identity')
const {
  buildSimpleFinSourceAccountId,
} = require('../lib/ingest/simplefin') as typeof import('../lib/ingest/simplefin')
const {
  stageSimpleFinPayload,
} = require('../lib/ingest/simplefin-import') as typeof import('../lib/ingest/simplefin-import')
const {
  promoteStagedTransactions,
} = require('../lib/ingest/promote') as typeof import('../lib/ingest/promote')
const resolvePendingRoute = require('../app/api/import/runs/[id]/staged/[stagedId]/resolve-pending/route') as ResolvePendingRoute
const {
  ensureSource,
  ensureSourceAccount,
  ensureSourceConnection,
} = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
import type { SimpleFinPayload, SimpleFinTransactionPayload } from '../lib/ingest/simplefin'

interface StagedRouteContext {
  params: Promise<{ id: string; stagedId: string }>
}

interface ResolvePendingRoute {
  POST(req: NextRequest, context: StagedRouteContext): Promise<Response>
}

const CONNECTION_ID = 'simplefin:pending-reconciliation'
const ACCOUNT_ID = 'acct-checking'
const EXTERNAL_ACCOUNT_ID = 'simplefin-checking-001'
const SOURCE_ACCOUNT_ID = buildSimpleFinSourceAccountId(CONNECTION_ID, EXTERNAL_ACCOUNT_ID)

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function stagedParams(id: string, stagedId: string): StagedRouteContext {
  return { params: Promise.resolve({ id, stagedId }) }
}

function unixDate(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000)
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM staged_transactions;
    DELETE FROM transfer_matches;
    DELETE FROM transaction_splits;
    DELETE FROM transactions;
    DELETE FROM raw_import_items;
    DELETE FROM import_runs;
    DELETE FROM import_profile_mappings;
    DELETE FROM import_profiles;
    DELETE FROM source_accounts;
    DELETE FROM source_connections;
    DELETE FROM sources;
    DELETE FROM accounts;
  `)

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ACCOUNT_ID,
    'Pending Checking',
    'USD',
    '100.00',
    unixDate('2026-05-01'),
    'pending-fixture',
    'Example Bank',
    'example.test',
    'depository',
    null,
    'Assets:US:Banks:PendingChecking',
    unixDate('2026-05-01'),
  )

  ensureSource({ id: 'simplefin', kind: 'simplefin', name: 'SimpleFIN' })
  ensureSourceConnection({
    id: CONNECTION_ID,
    sourceId: 'simplefin',
    name: 'Pending Reconciliation',
  })
  ensureSourceAccount({
    id: SOURCE_ACCOUNT_ID,
    sourceConnectionId: CONNECTION_ID,
    fintrackAccountId: ACCOUNT_ID,
    externalAccountId: EXTERNAL_ACCOUNT_ID,
    name: 'Pending Checking',
    currency: 'USD',
  })
}

function pendingSourceItemKey(externalId: string, date = '2026-05-01'): string {
  return buildSourceItemKey({
    sourceAccountId: SOURCE_ACCOUNT_ID,
    externalId,
    date,
    amount: '-42.10',
    description: 'Gas Station',
  })
}

function insertPendingCanonical(input: {
  id?: string
  externalId?: string
  sourceItemKey?: string
  posted?: number
  transactedAt?: number | null
  createdAt?: number
} = {}): string {
  const id = input.id ?? 'txn-pending-existing'
  const posted = input.posted ?? unixDate('2026-05-01')
  const sourceItemKey = input.sourceItemKey ?? pendingSourceItemKey(input.externalId ?? 'pending-hold-001')
  sqlite.prepare(`
    INSERT INTO transactions (
      id, account_id, source_connection_id, source_account_id, external_id,
      source_item_key, source, posted, transacted_at, amount, description,
      pending, status, category, suggested_cat, notes, tags, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'simplefin', ?, ?, '-42.10', 'Gas Station',
            1, 'pending', 'Expenses:Auto:Fuel', NULL, 'keep note', ?, ?, ?)
  `).run(
    id,
    ACCOUNT_ID,
    CONNECTION_ID,
    SOURCE_ACCOUNT_ID,
    input.externalId ?? 'pending-hold-001',
    sourceItemKey,
    posted,
    input.transactedAt ?? posted,
    JSON.stringify(['pending']),
    input.createdAt ?? Math.floor(Date.now() / 1000),
    input.createdAt ?? Math.floor(Date.now() / 1000),
  )
  return id
}

function payloadWithTransactions(transactions: SimpleFinTransactionPayload[]): SimpleFinPayload {
  return {
    accounts: [{
      id: EXTERNAL_ACCOUNT_ID,
      name: 'Pending Checking',
      currency: 'USD',
      balance: '100.00',
      'balance-date': unixDate('2026-05-05'),
      org: { name: 'Example Bank', domain: 'example.test' },
      transactions,
    }],
  }
}

function expiredPendingStagedId(importRunId: string): string {
  const row = sqlite.prepare(`
    SELECT id
    FROM staged_transactions
    WHERE import_run_id = ?
      AND reconciliation_status = 'pending_expired'
  `).get(importRunId) as { id: string } | undefined

  assert.ok(row)
  return row.id
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('stages posted SimpleFIN rows as pending-to-posted matches instead of new canonical rows', () => {
  const pendingId = insertPendingCanonical()
  const result = stageSimpleFinPayload(payloadWithTransactions([{
    id: 'posted-final-001',
    posted: unixDate('2026-05-03'),
    'transacted-at': unixDate('2026-05-01'),
    amount: '-42.10',
    description: 'Gas Station',
    pending: false,
  }]), {
    sourceConnectionId: CONNECTION_ID,
    sourceConnectionName: 'Pending Reconciliation',
  })

  assert.equal(result.pendingMatched, 1)
  assert.equal(result.expiredPending, 0)
  assert.equal(result.staged, 1)
  assert.equal(result.merged, 0)

  const staged = sqlite.prepare(`
    SELECT
      id,
      status,
      transaction_id AS transactionId,
      source_item_key AS sourceItemKey,
      reconciliation_status AS reconciliationStatus,
      reconciliation_transaction_id AS reconciliationTransactionId
    FROM staged_transactions
    WHERE import_run_id = ?
  `).get(result.importRunId) as {
    id: string
    status: string
    transactionId: string
    sourceItemKey: string
    reconciliationStatus: string
    reconciliationTransactionId: string
  }

  assert.equal(staged.status, 'ready')
  assert.equal(staged.transactionId, pendingId)
  assert.equal(staged.reconciliationStatus, 'pending_matched_to_posted')
  assert.equal(staged.reconciliationTransactionId, pendingId)

  const promoted = promoteStagedTransactions({ importRunId: result.importRunId })
  assert.deepEqual(promoted, { promoted: 1, skipped: 0, errors: [] })

  const rows = sqlite.prepare(`
    SELECT
      id,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      posted,
      transacted_at AS transactedAt,
      pending,
      status,
      category,
      notes,
      tags
    FROM transactions
  `).all() as Array<{
    id: string
    externalId: string
    sourceItemKey: string
    posted: number
    transactedAt: number
    pending: number
    status: string
    category: string
    notes: string
    tags: string
  }>

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, pendingId)
  assert.equal(rows[0].externalId, 'posted-final-001')
  assert.equal(rows[0].sourceItemKey, staged.sourceItemKey)
  assert.equal(rows[0].posted, unixDate('2026-05-03'))
  assert.equal(rows[0].transactedAt, unixDate('2026-05-01'))
  assert.equal(rows[0].pending, 0)
  assert.equal(rows[0].status, 'posted')
  assert.equal(rows[0].category, 'Expenses:Auto:Fuel')
  assert.equal(rows[0].notes, 'keep note')
  assert.deepEqual(JSON.parse(rows[0].tags), ['pending'])
})

test('missing fresh pending transactions remain pending without an expired reconciliation row', () => {
  insertPendingCanonical()
  const result = stageSimpleFinPayload(payloadWithTransactions([]), {
    sourceConnectionId: CONNECTION_ID,
    sourceConnectionName: 'Pending Reconciliation',
  })

  assert.equal(result.expiredPending, 0)
  assert.equal(result.rawInserted, 0)
  assert.equal(result.validationErrors, 0)
  assert.equal(
    (sqlite.prepare(`SELECT status FROM transactions WHERE id = 'txn-pending-existing'`).get() as { status: string }).status,
    'pending',
  )
  assert.equal(
    (sqlite.prepare(`SELECT COUNT(*) AS value FROM staged_transactions WHERE import_run_id = ?`).get(result.importRunId) as { value: number }).value,
    0,
  )
})

test('missing stale pending transactions create manual resolution rows without cancelling canonical data', () => {
  const staleCreatedAt = Math.floor(Date.now() / 1000) - 45 * 86400
  const pendingId = insertPendingCanonical({ createdAt: staleCreatedAt })
  const result = stageSimpleFinPayload(payloadWithTransactions([]), {
    sourceConnectionId: CONNECTION_ID,
    sourceConnectionName: 'Pending Reconciliation',
  })

  assert.equal(result.expiredPending, 1)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.validationErrors, 1)

  const staged = sqlite.prepare(`
    SELECT
      status,
      transaction_id AS transactionId,
      reconciliation_status AS reconciliationStatus,
      reconciliation_transaction_id AS reconciliationTransactionId,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE import_run_id = ?
  `).get(result.importRunId) as {
    status: string
    transactionId: string
    reconciliationStatus: string
    reconciliationTransactionId: string
    validationErrors: string
  }

  assert.equal(staged.status, 'error')
  assert.equal(staged.transactionId, pendingId)
  assert.equal(staged.reconciliationStatus, 'pending_expired')
  assert.equal(staged.reconciliationTransactionId, pendingId)
  assert.deepEqual(JSON.parse(staged.validationErrors), [
    'Pending transaction expired without a posted match; manual resolution required',
  ])

  const canonical = sqlite.prepare(`
    SELECT pending, status
    FROM transactions
    WHERE id = ?
  `).get(pendingId) as { pending: number; status: string }

  assert.equal(canonical.pending, 1)
  assert.equal(canonical.status, 'pending')
})

test('expired pending manual resolution can cancel the canonical pending transaction', async () => {
  const staleCreatedAt = Math.floor(Date.now() / 1000) - 45 * 86400
  const pendingId = insertPendingCanonical({ createdAt: staleCreatedAt })
  const result = stageSimpleFinPayload(payloadWithTransactions([]), {
    sourceConnectionId: CONNECTION_ID,
    sourceConnectionName: 'Pending Reconciliation',
  })
  const stagedId = expiredPendingStagedId(result.importRunId)

  const response = await resolvePendingRoute.POST(
    request(`/api/import/runs/${result.importRunId}/staged/${stagedId}/resolve-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel_pending' }),
    }),
    stagedParams(result.importRunId, stagedId),
  )
  const payload = await response.json() as {
    status?: string
    action?: string
    transactionId?: string
    canonicalStatus?: string
    reconciliationStatus?: string
    validationErrors?: string[]
  }

  assert.equal(response.status, 200)
  assert.equal(payload.status, 'merged')
  assert.equal(payload.action, 'cancel_pending')
  assert.equal(payload.transactionId, pendingId)
  assert.equal(payload.canonicalStatus, 'cancelled')
  assert.equal(payload.reconciliationStatus, 'cancelled')
  assert.deepEqual(payload.validationErrors, [])

  const canonical = sqlite.prepare(`
    SELECT pending, status
    FROM transactions
    WHERE id = ?
  `).get(pendingId) as { pending: number; status: string }
  const staged = sqlite.prepare(`
    SELECT
      status,
      transaction_id AS transactionId,
      reconciliation_status AS reconciliationStatus,
      reconciliation_reason AS reconciliationReason,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE id = ?
  `).get(stagedId) as {
    status: string
    transactionId: string
    reconciliationStatus: string
    reconciliationReason: string
    validationErrors: string
  }

  assert.equal(canonical.pending, 0)
  assert.equal(canonical.status, 'cancelled')
  assert.equal(staged.status, 'merged')
  assert.equal(staged.transactionId, pendingId)
  assert.equal(staged.reconciliationStatus, 'cancelled')
  assert.equal(staged.reconciliationReason, 'Manually cancelled expired pending transaction')
  assert.deepEqual(JSON.parse(staged.validationErrors), [])
})

test('expired pending manual resolution can keep the canonical transaction pending', async () => {
  const staleCreatedAt = Math.floor(Date.now() / 1000) - 45 * 86400
  const pendingId = insertPendingCanonical({ createdAt: staleCreatedAt })
  const result = stageSimpleFinPayload(payloadWithTransactions([]), {
    sourceConnectionId: CONNECTION_ID,
    sourceConnectionName: 'Pending Reconciliation',
  })
  const stagedId = expiredPendingStagedId(result.importRunId)

  const response = await resolvePendingRoute.POST(
    request(`/api/import/runs/${result.importRunId}/staged/${stagedId}/resolve-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'keep_pending' }),
    }),
    stagedParams(result.importRunId, stagedId),
  )
  const payload = await response.json() as {
    status?: string
    action?: string
    transactionId?: string
    canonicalStatus?: string
    reconciliationStatus?: string
    validationErrors?: string[]
  }

  assert.equal(response.status, 200)
  assert.equal(payload.status, 'ignored')
  assert.equal(payload.action, 'keep_pending')
  assert.equal(payload.transactionId, pendingId)
  assert.equal(payload.canonicalStatus, 'pending')
  assert.equal(payload.reconciliationStatus, 'manual_resolve')
  assert.deepEqual(payload.validationErrors, [])

  const canonical = sqlite.prepare(`
    SELECT pending, status
    FROM transactions
    WHERE id = ?
  `).get(pendingId) as { pending: number; status: string }
  const staged = sqlite.prepare(`
    SELECT
      status,
      transaction_id AS transactionId,
      reconciliation_status AS reconciliationStatus,
      reconciliation_reason AS reconciliationReason,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE id = ?
  `).get(stagedId) as {
    status: string
    transactionId: string
    reconciliationStatus: string
    reconciliationReason: string
    validationErrors: string
  }

  assert.equal(canonical.pending, 1)
  assert.equal(canonical.status, 'pending')
  assert.equal(staged.status, 'ignored')
  assert.equal(staged.transactionId, pendingId)
  assert.equal(staged.reconciliationStatus, 'manual_resolve')
  assert.equal(staged.reconciliationReason, 'Manually resolved expired pending transaction by keeping it pending')
  assert.deepEqual(JSON.parse(staged.validationErrors), [])
})
