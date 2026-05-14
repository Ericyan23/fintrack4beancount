import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-staged-cleaning-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const stagedListRoute = require('../app/api/import/runs/[id]/staged/route') as typeof import('../app/api/import/runs/[id]/staged/route')

interface RunRouteContext {
  params: Promise<{ id: string }>
}

interface StagedRouteContext {
  params: Promise<{ id: string; stagedId: string }>
}

interface StagedMutationRoute {
  PATCH(req: NextRequest, context: StagedRouteContext): Promise<Response>
  DELETE(req: NextRequest, context: StagedRouteContext): Promise<Response>
}

interface StagedIgnoreRoute {
  POST(req: NextRequest, context: StagedRouteContext): Promise<Response>
}

interface SeededImportRun {
  runId: string
  otherRunId: string
  stagedId: string
  mergedStagedId: string
}

interface StagedDbRow {
  id: string
  importRunId: string | null
  accountId: string | null
  posted: number | null
  amount: string | null
  description: string | null
  pending: number
  status: string
  category: string | null
  notes: string | null
  tags: string | null
}

const stagedServicePath = path.join(process.cwd(), 'lib', 'ingest', 'staged.ts')
const skipMutationTests = fs.existsSync(stagedServicePath)
  ? false
  : 'lib/ingest/staged.ts is not present yet'

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function runParams(id: string): RunRouteContext {
  return { params: Promise.resolve({ id }) }
}

function stagedParams(id: string, stagedId: string): StagedRouteContext {
  return { params: Promise.resolve({ id, stagedId }) }
}

function loadMutationRoute(): StagedMutationRoute {
  return require('../app/api/import/runs/[id]/staged/[stagedId]/route') as StagedMutationRoute
}

function loadIgnoreRoute(): StagedIgnoreRoute {
  return require('../app/api/import/runs/[id]/staged/[stagedId]/ignore/route') as StagedIgnoreRoute
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
    'acct-cleaning-checking',
    'Cleaning Checking',
    'USD',
    '0.00',
    1777593600,
    'test-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    'Assets:US:Banks:CleaningChecking',
    1777593600,
  )
}

function seedImportRun(): SeededImportRun {
  seedAccount()

  const source = store.ensureSource({
    id: 'source-cleaning-csv',
    kind: 'csv',
    name: 'Cleaning CSV Imports',
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-cleaning-csv',
    sourceId: source.id,
    name: 'Cleaning CSV Connection',
  })
  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-cleaning-checking',
    sourceConnectionId: connection.id,
    fintrackAccountId: 'acct-cleaning-checking',
    externalAccountId: 'checking-cleaning',
    name: 'Cleaning Imported Checking',
    currency: 'USD',
  })

  const run = store.createImportRun({
    id: 'run-cleaning-primary',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })
  const otherRun = store.createImportRun({
    id: 'run-cleaning-other',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })

  const rawEdit = store.insertRawImportItem({
    id: 'raw-cleaning-edit',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-cleaning-edit',
    sourceItemKey: 'key-cleaning-edit',
    rawPayload: { description: 'Original Coffee' },
  })
  const rawMerged = store.insertRawImportItem({
    id: 'raw-cleaning-merged',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-cleaning-merged',
    sourceItemKey: 'key-cleaning-merged',
    rawPayload: { description: 'Already Merged' },
  })

  const staged = store.insertStagedTransaction({
    id: 'staged-cleaning-edit',
    importRunId: run.id,
    rawItemId: rawEdit.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-cleaning-checking',
    externalId: 'external-cleaning-edit',
    sourceItemKey: 'key-cleaning-edit',
    posted: 1777593600,
    amount: '-4.75',
    currency: 'USD',
    description: 'Original Coffee',
    pending: true,
    status: 'staged',
    category: 'Expenses:Food:Coffee',
    notes: 'Original note',
    tags: ['initial', 'review'],
    validationErrors: ['Needs review'],
  })
  const merged = store.insertStagedTransaction({
    id: 'staged-cleaning-merged',
    importRunId: run.id,
    rawItemId: rawMerged.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-cleaning-checking',
    externalId: 'external-cleaning-merged',
    sourceItemKey: 'key-cleaning-merged',
    posted: 1777680000,
    amount: '-9.99',
    currency: 'USD',
    description: 'Already Merged',
    status: 'merged',
  })

  store.finishImportRun({ id: run.id, itemCount: 2 })
  store.finishImportRun({ id: otherRun.id, itemCount: 0 })

  return {
    runId: run.id,
    otherRunId: otherRun.id,
    stagedId: staged.id,
    mergedStagedId: merged.id,
  }
}

function loadStagedRow(id: string): StagedDbRow | null {
  const row = sqlite.prepare(`
    SELECT
      id,
      import_run_id AS importRunId,
      account_id AS accountId,
      posted,
      amount,
      description,
      pending,
      status,
      category,
      notes,
      tags
    FROM staged_transactions
    WHERE id = ?
  `).get(id) as StagedDbRow | undefined

  return row ?? null
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('GET /api/import/runs/:id/staged returns fields needed for staged row editing', async () => {
  const { runId, stagedId } = seedImportRun()
  const response = await stagedListRoute.GET(request(`/api/import/runs/${runId}/staged`), runParams(runId))
  const payload = await response.json() as {
    rows: Array<{
      id: string
      accountId: string | null
      accountName: string | null
      sourceAccountId: string | null
      sourceAccountName: string | null
      externalId: string | null
      sourceItemKey: string | null
      pending: boolean
      tags: string[]
      validationErrors: string[]
    }>
  }

  assert.equal(response.status, 200)

  const row = payload.rows.find(candidate => candidate.id === stagedId)
  assert.ok(row)
  assert.equal(row.accountId, 'acct-cleaning-checking')
  assert.equal(row.accountName, 'Cleaning Checking')
  assert.equal(row.sourceAccountId, 'source-account-cleaning-checking')
  assert.equal(row.sourceAccountName, 'Cleaning Imported Checking')
  assert.equal(row.externalId, 'external-cleaning-edit')
  assert.equal(row.sourceItemKey, 'key-cleaning-edit')
  assert.equal(row.pending, true)
  assert.deepEqual(row.tags, ['initial', 'review'])
  assert.deepEqual(row.validationErrors, ['Needs review'])
})

test('PATCH /api/import/runs/:id/staged/:stagedId validates and updates staged fields', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: 'acct-cleaning-checking',
        posted: 1777766400,
        amount: '-12.34',
        description: 'Edited Coffee',
        category: 'Expenses:Food',
        notes: 'Edited note',
        tags: ['edited'],
        pending: false,
      }),
    }),
    stagedParams(runId, stagedId),
  )
  const payload = await response.json() as Record<string, unknown>
  const row = loadStagedRow(stagedId)

  assert.equal(response.status, 200)
  assert.equal(typeof payload, 'object')
  assert.ok(row)
  assert.equal(row.accountId, 'acct-cleaning-checking')
  assert.equal(row.posted, 1777766400)
  assert.equal(row.amount, '-12.34')
  assert.equal(row.description, 'Edited Coffee')
  assert.equal(row.pending, 0)
  assert.equal(row.category, 'Expenses:Food')
  assert.equal(row.notes, 'Edited note')
  assert.deepEqual(row.tags ? JSON.parse(row.tags) : null, ['edited'])
})

test('PATCH /api/import/runs/:id/staged/:stagedId rejects non-object bodies', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    }),
    stagedParams(runId, stagedId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Request body must be a JSON object')
})

test('PATCH /api/import/runs/:id/staged/:stagedId rejects invalid tags', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['edited', 42] }),
    }),
    stagedParams(runId, stagedId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'tags must be an array of strings or null')
})

test('PATCH /api/import/runs/:id/staged/:stagedId rejects unknown accounts', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acct-does-not-exist' }),
    }),
    stagedParams(runId, stagedId),
  )
  const payload = await response.json() as { error?: string }
  const row = loadStagedRow(stagedId)

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Account not found: acct-does-not-exist')
  assert.ok(row)
  assert.equal(row.accountId, 'acct-cleaning-checking')
  assert.equal(row.status, 'staged')
})

test('PATCH /api/import/runs/:id/staged/:stagedId rejects invalid posted and pending fields', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const invalidPosted = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posted: '1777766400' }),
    }),
    stagedParams(runId, stagedId),
  )
  const invalidPending = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pending: null }),
    }),
    stagedParams(runId, stagedId),
  )

  assert.equal(invalidPosted.status, 400)
  assert.equal((await invalidPosted.json() as { error?: string }).error, 'posted must be a number or null')
  assert.equal(invalidPending.status, 400)
  assert.equal((await invalidPending.json() as { error?: string }).error, 'pending must be a boolean')
})

test('POST /api/import/runs/:id/staged/:stagedId/ignore marks a staged row ignored', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadIgnoreRoute()
  const response = await route.POST(
    request(`/api/import/runs/${runId}/staged/${stagedId}/ignore`, {
      method: 'POST',
    }),
    stagedParams(runId, stagedId),
  )
  const row = loadStagedRow(stagedId)

  assert.equal(response.status, 200)
  assert.ok(row)
  assert.equal(row.status, 'ignored')
})

test('DELETE /api/import/runs/:id/staged/:stagedId soft deletes a staged row', { skip: skipMutationTests }, async () => {
  const { runId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.DELETE(
    request(`/api/import/runs/${runId}/staged/${stagedId}`, {
      method: 'DELETE',
    }),
    stagedParams(runId, stagedId),
  )
  const row = loadStagedRow(stagedId)

  assert.equal(response.status, 200)
  assert.ok(row)
  assert.equal(row.status, 'deleted')
})

test('PATCH /api/import/runs/:id/staged/:stagedId returns 404 when the row belongs to another run', { skip: skipMutationTests }, async () => {
  const { otherRunId, stagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.PATCH(
    request(`/api/import/runs/${otherRunId}/staged/${stagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Wrong run' }),
    }),
    stagedParams(otherRunId, stagedId),
  )
  const payload = await response.json() as { error?: string }
  const row = loadStagedRow(stagedId)

  assert.equal(response.status, 404)
  assert.equal(typeof payload.error, 'string')
  assert.ok(row)
  assert.equal(row.importRunId, 'run-cleaning-primary')
  assert.equal(row.notes, 'Original note')
})

test('PATCH /api/import/runs/:id/staged/:stagedId returns 409 for merged rows', { skip: skipMutationTests }, async () => {
  const { runId, mergedStagedId } = seedImportRun()
  const route = loadMutationRoute()
  const response = await route.PATCH(
    request(`/api/import/runs/${runId}/staged/${mergedStagedId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Cannot edit merged' }),
    }),
    stagedParams(runId, mergedStagedId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 409)
  assert.equal(typeof payload.error, 'string')
})
