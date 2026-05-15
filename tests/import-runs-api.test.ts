import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-import-runs-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const listRoute = require('../app/api/import/runs/route') as typeof import('../app/api/import/runs/route')
const runRoute = require('../app/api/import/runs/[id]/route') as typeof import('../app/api/import/runs/[id]/route')
const stagedRoute = require('../app/api/import/runs/[id]/staged/route') as typeof import('../app/api/import/runs/[id]/staged/route')

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PromoteRoute {
  POST(req: NextRequest, context: RouteContext): Promise<Response>
}

interface ReplayRoute {
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
    DELETE FROM audit_log;
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
    run: { id: string; sourceConnectionId: string; status: string; lifecycleState: string; itemCount: number }
    summary: Record<string, number>
    lifecycle: {
      raw: Record<string, number>
      staged: Record<string, number>
      canonical: Record<string, number>
    }
  }

  assert.equal(response.status, 200)
  assert.equal(payload.run.id, runId)
  assert.equal(payload.run.sourceConnectionId, 'connection-api-csv')
  assert.equal(payload.run.status, 'completed')
  assert.equal(payload.run.lifecycleState, 'reviewed')
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
  assert.deepEqual(payload.lifecycle.raw, {
    raw_imported: 4,
    staged: 0,
    needs_review: 0,
    reviewed: 0,
    ignored: 0,
    deleted: 0,
    export_ready: 0,
    exported: 0,
    failed: 0,
  })
  assert.deepEqual(payload.lifecycle.staged, {
    raw_imported: 0,
    staged: 1,
    needs_review: 1,
    reviewed: 1,
    ignored: 0,
    deleted: 0,
    export_ready: 1,
    exported: 0,
    failed: 0,
  })
  assert.deepEqual(payload.lifecycle.canonical, {
    raw_imported: 0,
    staged: 0,
    needs_review: 1,
    reviewed: 0,
    ignored: 0,
    deleted: 0,
    export_ready: 0,
    exported: 0,
    failed: 0,
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
      lifecycleState: string
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
  assert.equal(ready.lifecycleState, 'reviewed')
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
  assert.equal(merged.lifecycleState, 'export_ready')

  const error = payload.rows.find(row => row.id === 'staged-error')
  assert.ok(error)
  assert.equal(error.lifecycleState, 'needs_review')
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

test('POST /api/import/runs/:id/replay creates a new staged review run from raw archive', async () => {
  const { runId } = seedImportRun()
  const replayRoute = require('../app/api/import/runs/[id]/replay/route') as ReplayRoute
  const response = await replayRoute.POST(
    request(`/api/import/runs/${runId}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'tester', reason: 'regression replay' }),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    importRunId: string
    reviewUrl: string
    replay: {
      sourceImportRunId: string
      rawReplayed: number
      stagedReplayed: number
      skippedStagedRows: number
    }
  }

  assert.equal(response.status, 201)
  assert.notEqual(payload.importRunId, runId)
  assert.equal(payload.reviewUrl, `/import/runs/${encodeURIComponent(payload.importRunId)}`)
  assert.equal(payload.replay.sourceImportRunId, runId)
  assert.equal(payload.replay.rawReplayed, 4)
  assert.equal(payload.replay.stagedReplayed, 4)
  assert.equal(payload.replay.skippedStagedRows, 0)

  const replayRun = sqlite.prepare(`
    SELECT source_connection_id AS sourceConnectionId,
           status,
           item_count AS itemCount
    FROM import_runs
    WHERE id = ?
  `).get(payload.importRunId) as { sourceConnectionId: string; status: string; itemCount: number }
  assert.deepEqual(replayRun, {
    sourceConnectionId: 'connection-api-csv',
    status: 'completed',
    itemCount: 4,
  })

  const newRawCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM raw_import_items
    WHERE import_run_id = ?
  `).get(payload.importRunId) as { value: number }
  assert.equal(newRawCount.value, 4)

  const replayRows = sqlite.prepare(`
    SELECT source_item_key AS sourceItemKey,
           status,
           account_id AS accountId,
           transaction_id AS transactionId,
           validation_errors AS validationErrors
    FROM staged_transactions
    WHERE import_run_id = ?
    ORDER BY source_item_key ASC
  `).all(payload.importRunId) as Array<{
    sourceItemKey: string
    status: string
    accountId: string | null
    transactionId: string | null
    validationErrors: string
  }>

  assert.deepEqual(replayRows.map(row => [row.sourceItemKey, row.status]), [
    ['key-error', 'error'],
    ['key-merged', 'merged'],
    ['key-ready', 'ready'],
    ['key-staged', 'staged'],
  ])
  const errorRow = replayRows.find(row => row.sourceItemKey === 'key-error')
  assert.ok(errorRow)
  assert.equal(errorRow.accountId, 'acct-api-checking')
  assert.deepEqual(JSON.parse(errorRow.validationErrors) as string[], ['Missing required field: posted'])

  const mergedRow = replayRows.find(row => row.sourceItemKey === 'key-merged')
  assert.ok(mergedRow)
  assert.equal(mergedRow.transactionId, 'txn-merged')
  assert.deepEqual(JSON.parse(mergedRow.validationErrors) as string[], [])

  const auditRow = sqlite.prepare(`
    SELECT action,
           actor,
           reason,
           metadata
    FROM audit_log
    WHERE entity_type = 'import_run'
      AND entity_id = ?
  `).get(payload.importRunId) as { action: string; actor: string; reason: string; metadata: string }
  assert.equal(auditRow.action, 'import_run_replay')
  assert.equal(auditRow.actor, 'tester')
  assert.equal(auditRow.reason, 'regression replay')
  assert.equal((JSON.parse(auditRow.metadata) as { sourceImportRunId: string }).sourceImportRunId, runId)
})

test('POST /api/import/runs/:id/replay returns 404 JSON for a missing run', async () => {
  const replayRoute = require('../app/api/import/runs/[id]/replay/route') as ReplayRoute
  const response = await replayRoute.POST(
    request('/api/import/runs/missing-run/replay', { method: 'POST' }),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

// ── GET /api/import/runs (list) ───────────────────────────────────────────────

describe('GET /api/import/runs', () => {
  test('returns empty list when no runs exist', async () => {
    const response = await listRoute.GET()
    const payload = await response.json() as { runs: unknown[] }

    assert.equal(response.status, 200)
    assert.ok(Array.isArray(payload.runs))
    assert.equal(payload.runs.length, 0)
  })

  test('returns run with correct aggregated staged counts', async () => {
    const { runId } = seedImportRun()
    const response = await listRoute.GET()
    const payload = await response.json() as {
      runs: Array<{
        id: string
        status: string
        lifecycleState: string
        itemCount: number
        connectionName: string | null
        sourceKind: string | null
        eligibleCount: number
        errorCount: number
        mergedCount: number
      }>
    }

    assert.equal(response.status, 200)
    assert.equal(payload.runs.length, 1)

    const run = payload.runs[0]
    assert.equal(run.id, runId)
    assert.equal(run.status, 'completed')
    assert.equal(run.lifecycleState, 'reviewed')
    assert.equal(run.itemCount, 4)
    assert.equal(run.connectionName, 'API CSV Connection')
    assert.equal(run.sourceKind, 'csv')
    // staged(1) + ready(1) = 2 eligible
    assert.equal(run.eligibleCount, 2)
    assert.equal(run.errorCount, 1)
    assert.equal(run.mergedCount, 1)
  })

  test('returns most recent run first when multiple runs exist', async () => {
    seedImportRun()
    // Push the first run into the past so ordering is deterministic
    sqlite.prepare(`UPDATE import_runs SET created_at = 1000 WHERE id = 'run-api-review'`).run()
    // second run — bare, no staged rows
    const source = store.ensureSource({ id: 'csv', kind: 'csv', name: 'CSV' })
    const conn = store.ensureSourceConnection({ id: 'csv:manual', sourceId: source.id, name: 'Manual' })
    const run2 = store.createImportRun({ id: 'run-second', sourceConnectionId: conn.id })
    store.finishImportRun({ id: run2.id })

    const response = await listRoute.GET()
    const payload = await response.json() as { runs: Array<{ id: string }> }

    assert.equal(payload.runs.length, 2)
    assert.equal(payload.runs[0].id, 'run-second')
    assert.equal(payload.runs[1].id, 'run-api-review')
  })
})
