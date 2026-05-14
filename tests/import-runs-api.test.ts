import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-import-runs-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const runRoute = require('../app/api/import/runs/[id]/route') as typeof import('../app/api/import/runs/[id]/route')
const stagedRoute = require('../app/api/import/runs/[id]/staged/route') as typeof import('../app/api/import/runs/[id]/staged/route')

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PromoteRoute {
  POST(req: NextRequest, context: RouteContext): Promise<Response>
}

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function params(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM staged_transactions;
    DELETE FROM transfer_matches;
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
}

function seedAccount(): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-api-checking',
    'API Checking',
    'USD',
    '0.00',
    1777593600,
    'test-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    'Assets:US:Banks:APIChecking',
    1777593600,
  )
}

function seedImportRun(): { runId: string } {
  seedAccount()

  const source = store.ensureSource({
    id: 'source-api-csv',
    kind: 'csv',
    name: 'API CSV Imports',
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-api-csv',
    sourceId: source.id,
    name: 'API CSV Connection',
  })
  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-api-checking',
    sourceConnectionId: connection.id,
    fintrackAccountId: 'acct-api-checking',
    externalAccountId: 'checking-001',
    name: 'Imported Checking',
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: 'run-api-review',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })

  const rawStaged = store.insertRawImportItem({
    id: 'raw-staged',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-staged',
    sourceItemKey: 'key-staged',
    rawPayload: { description: 'Coffee Shop' },
  })
  const rawReady = store.insertRawImportItem({
    id: 'raw-ready',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-ready',
    sourceItemKey: 'key-ready',
    rawPayload: { description: 'Grocer' },
  })
  const rawMerged = store.insertRawImportItem({
    id: 'raw-merged',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-merged',
    sourceItemKey: 'key-merged',
    rawPayload: { description: 'Merged Txn' },
  })
  const rawError = store.insertRawImportItem({
    id: 'raw-error',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-error',
    sourceItemKey: 'key-error',
    rawPayload: { description: 'Invalid Txn' },
  })

  sqlite.prepare(`
    INSERT INTO transactions (
      id, account_id, source_connection_id, source_account_id, external_id,
      source_item_key, import_run_id, raw_item_id, normalizer_version, source,
      posted, transacted_at, amount, description, pending, status, category,
      suggested_cat, notes, tags, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'txn-merged',
    'acct-api-checking',
    connection.id,
    sourceAccount.id,
    'external-merged',
    'key-merged',
    run.id,
    rawMerged.item.id,
    'test-normalizer-v1',
    'csv',
    1777766400,
    null,
    '-20.00',
    'Merged Txn',
    0,
    'posted',
    'Expenses:Food',
    null,
    'Already promoted',
    JSON.stringify(['imported']),
    1777766400,
    1777766400,
  )

  store.insertStagedTransaction({
    id: 'staged-pending',
    importRunId: run.id,
    rawItemId: rawStaged.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-api-checking',
    externalId: 'external-staged',
    sourceItemKey: 'key-staged',
    posted: 1777593600,
    amount: '-4.75',
    currency: 'USD',
    description: 'Coffee Shop',
    status: 'staged',
    category: 'Expenses:Food:Coffee',
    notes: 'Morning coffee',
  })
  store.insertStagedTransaction({
    id: 'staged-ready',
    importRunId: run.id,
    rawItemId: rawReady.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-api-checking',
    externalId: 'external-ready',
    sourceItemKey: 'key-ready',
    posted: 1777680000,
    amount: '-12.34',
    currency: 'USD',
    description: 'Grocer',
    status: 'ready',
    category: 'Expenses:Food:Groceries',
  })
  store.insertStagedTransaction({
    id: 'staged-merged',
    importRunId: run.id,
    rawItemId: rawMerged.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-api-checking',
    transactionId: 'txn-merged',
    externalId: 'external-merged',
    sourceItemKey: 'key-merged',
    posted: 1777766400,
    amount: '-20.00',
    currency: 'USD',
    description: 'Merged Txn',
    status: 'merged',
  })
  store.insertStagedTransaction({
    id: 'staged-error',
    importRunId: run.id,
    rawItemId: rawError.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-error',
    sourceItemKey: 'key-error',
    amount: '-1.00',
    currency: 'USD',
    description: 'Invalid Txn',
    status: 'error',
    validationErrors: ['Missing posted date'],
  })

  store.finishImportRun({ id: run.id })

  return { runId: run.id }
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('GET /api/import/runs/:id returns the import run and review summary', async () => {
  const { runId } = seedImportRun()
  const response = await runRoute.GET(request(`/api/import/runs/${runId}`), params(runId))
  const payload = await response.json() as {
    run: { id: string; sourceConnectionId: string; status: string; itemCount: number }
    summary: Record<string, number>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.run.id, runId)
  assert.equal(payload.run.sourceConnectionId, 'connection-api-csv')
  assert.equal(payload.run.status, 'completed')
  assert.equal(payload.run.itemCount, 4)
  assert.deepEqual(payload.summary, {
    raw: 4,
    staged: 1,
    ready: 1,
    merged: 1,
    ignored: 0,
    deleted: 0,
    error: 1,
    canonical: 1,
  })
})

test('GET /api/import/runs/:id returns 404 JSON for a missing run', async () => {
  const response = await runRoute.GET(request('/api/import/runs/missing-run'), params('missing-run'))
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('GET /api/import/runs/:id/staged returns staged rows with source account names', async () => {
  const { runId } = seedImportRun()
  const response = await stagedRoute.GET(request(`/api/import/runs/${runId}/staged`), params(runId))
  const payload = await response.json() as {
    rows: Array<{
      id: string
      status: string
      accountId: string | null
      sourceAccountId: string | null
      sourceAccountName: string | null
      posted: number | null
      amount: string | null
      description: string | null
      category: string | null
      notes: string | null
      transactionId: string | null
      rawItemId: string | null
      sourceItemKey: string | null
      validationErrors: string[]
      updatedAt: number
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 4)

  const ready = payload.rows.find(row => row.id === 'staged-ready')
  assert.ok(ready)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.accountId, 'acct-api-checking')
  assert.equal(ready.sourceAccountId, 'source-account-api-checking')
  assert.equal(ready.sourceAccountName, 'Imported Checking')
  assert.equal(ready.posted, 1777680000)
  assert.equal(ready.amount, '-12.34')
  assert.equal(ready.description, 'Grocer')
  assert.equal(ready.category, 'Expenses:Food:Groceries')
  assert.equal(ready.transactionId, null)
  assert.equal(ready.rawItemId, 'raw-ready')
  assert.equal(ready.sourceItemKey, 'key-ready')
  assert.equal(typeof ready.updatedAt, 'number')

  const merged = payload.rows.find(row => row.id === 'staged-merged')
  assert.ok(merged)
  assert.equal(merged.transactionId, 'txn-merged')

  const error = payload.rows.find(row => row.id === 'staged-error')
  assert.ok(error)
  assert.deepEqual(error.validationErrors, ['Missing posted date'])
})

test('GET /api/import/runs/:id/staged returns 404 JSON for a missing run', async () => {
  const response = await stagedRoute.GET(
    request('/api/import/runs/missing-run/staged'),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

const promoteServicePath = path.join(process.cwd(), 'lib', 'ingest', 'promote.ts')
const skipPromoteTests = fs.existsSync(promoteServicePath)
  ? false
  : 'lib/ingest/promote.ts is not present yet'

test('POST /api/import/runs/:id/promote returns 404 JSON for a missing run', { skip: skipPromoteTests }, async () => {
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request('/api/import/runs/missing-run/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedTransactionIds: ['staged-ready'] }),
    }),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('POST /api/import/runs/:id/promote rejects malformed JSON bodies without promoting all rows', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    }),
    params(runId),
  )
  const payload = await response.json() as { error?: string }
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Request body must be a JSON object')
  assert.equal(transactionCount.value, 1)
})

test('POST /api/import/runs/:id/promote rejects non-completed runs', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  sqlite.prepare(`
    UPDATE import_runs
    SET status = 'running'
    WHERE id = ?
  `).run(runId)

  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedTransactionIds: ['staged-ready'] }),
    }),
    params(runId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'Import run must be completed before promote: running')
})

test('POST /api/import/runs/:id/promote delegates to promoteStagedTransactions', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedTransactionIds: ['staged-ready'] }),
    }),
    params(runId),
  )
  const payload = await response.json() as { promoted: unknown; skipped: unknown; errors: unknown }

  assert.equal(response.status, 200)
  assert.equal(typeof payload.promoted, 'number')
  assert.equal(typeof payload.skipped, 'number')
  assert.ok(Array.isArray(payload.errors))
})
