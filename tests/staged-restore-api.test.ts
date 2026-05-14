import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-staged-restore-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const restoreRoute = require('../app/api/import/runs/[id]/staged/[stagedId]/restore/route') as StagedRestoreRoute

interface StagedRouteContext {
  params: Promise<{ id: string; stagedId: string }>
}

interface StagedRestoreRoute {
  POST(req: NextRequest, context: StagedRouteContext): Promise<Response>
}

interface Fixture {
  accountId: string
  connectionId: string
  sourceAccountId: string
  runId: string
  otherRunId: string
}

interface StagedDbRow {
  status: string
  validationErrors: string | null
}

interface AuditLogRow {
  action: string
  actor: string
  reason: string | null
  beforeValues: string
  afterValues: string
  metadata: string | null
}

type StageStatus = 'staged' | 'ready' | 'merged' | 'ignored' | 'deleted' | 'error'

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function stagedParams(id: string, stagedId: string): StagedRouteContext {
  return { params: Promise.resolve({ id, stagedId }) }
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
    'acct-restore-api-checking',
    'Restore API Checking',
    'USD',
    '0.00',
    1777593600,
    'restore-api-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    'Assets:US:Banks:RestoreApiChecking',
    1777593600,
  )
}

function createFixture(): Fixture {
  seedAccount()

  const source = store.ensureSource({
    id: 'source-restore-api-csv',
    kind: 'csv',
    name: 'Restore API CSV Imports',
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-restore-api-csv',
    sourceId: source.id,
    name: 'Restore API CSV Connection',
  })
  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-restore-api-checking',
    sourceConnectionId: connection.id,
    fintrackAccountId: 'acct-restore-api-checking',
    externalAccountId: 'checking-restore-api',
    name: 'Restore API Imported Checking',
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: 'run-restore-api-primary',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })
  const otherRun = store.createImportRun({
    id: 'run-restore-api-other',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })

  return {
    accountId: 'acct-restore-api-checking',
    connectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    runId: run.id,
    otherRunId: otherRun.id,
  }
}

function stageTransaction(input: {
  id: string
  fixture: Fixture
  status: StageStatus
  accountId?: string | null
  posted?: number | null
  validationErrors?: string[] | null
}): void {
  const sourceItemKey = `restore-api:${input.id}`
  const raw = store.insertRawImportItem({
    id: `raw-${input.id}`,
    importRunId: input.fixture.runId,
    sourceAccountId: input.fixture.sourceAccountId,
    externalId: `external-${input.id}`,
    sourceItemKey,
    rawPayload: { id: input.id },
  })

  store.insertStagedTransaction({
    id: input.id,
    importRunId: input.fixture.runId,
    rawItemId: raw.item.id,
    sourceConnectionId: input.fixture.connectionId,
    sourceAccountId: input.fixture.sourceAccountId,
    accountId: input.accountId === undefined ? input.fixture.accountId : input.accountId,
    externalId: `external-${input.id}`,
    sourceItemKey,
    posted: input.posted === undefined ? 1777593600 : input.posted,
    amount: '-4.75',
    currency: 'USD',
    description: `Description ${input.id}`,
    pending: true,
    status: input.status,
    validationErrors: input.validationErrors,
  })
}

function loadStagedRow(id: string): StagedDbRow | null {
  const row = sqlite.prepare(`
    SELECT
      status,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE id = ?
  `).get(id) as StagedDbRow | undefined

  return row ?? null
}

function loadAuditRows(entityId: string): AuditLogRow[] {
  return sqlite.prepare(`
    SELECT action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata
    FROM audit_log
    WHERE entity_type = 'staged_transaction'
      AND entity_id = ?
    ORDER BY id
  `).all(entityId) as AuditLogRow[]
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('POST /api/import/runs/:id/staged/:stagedId/restore restores ignored rows', async () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-restore-api-ignored',
    fixture,
    status: 'ignored',
    validationErrors: [],
  })

  const response = await restoreRoute.POST(
    request(`/api/import/runs/${fixture.runId}/staged/staged-restore-api-ignored/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: 'eric',
        editReason: 'restore after review',
      }),
    }),
    stagedParams(fixture.runId, 'staged-restore-api-ignored'),
  )
  const payload = await response.json() as { id?: string; status?: string; validationErrors?: string[] }
  const row = loadStagedRow('staged-restore-api-ignored')

  assert.equal(response.status, 200)
  assert.equal(payload.id, 'staged-restore-api-ignored')
  assert.equal(payload.status, 'ready')
  assert.deepEqual(payload.validationErrors, [])
  assert.ok(row)
  assert.equal(row.status, 'ready')
  assert.deepEqual(JSON.parse(row.validationErrors ?? 'null'), [])

  const auditRows = loadAuditRows('staged-restore-api-ignored')
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].action, 'staged_restore')
  assert.equal(auditRows[0].actor, 'eric')
  assert.equal(auditRows[0].reason, 'restore after review')

  const beforeValues = JSON.parse(auditRows[0].beforeValues) as { stagedTransaction: { status: string } }
  const afterValues = JSON.parse(auditRows[0].afterValues) as { stagedTransaction: { status: string } }
  const metadata = JSON.parse(auditRows[0].metadata ?? '{}') as { importRunId: string; fields: string[] }
  assert.equal(beforeValues.stagedTransaction.status, 'ignored')
  assert.equal(afterValues.stagedTransaction.status, 'ready')
  assert.equal(metadata.importRunId, fixture.runId)
  assert.ok(metadata.fields.includes('status'))
})

test('POST /api/import/runs/:id/staged/:stagedId/restore returns 404 for the wrong run', async () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-restore-api-wrong-run',
    fixture,
    status: 'deleted',
    validationErrors: [],
  })

  const response = await restoreRoute.POST(
    request(`/api/import/runs/${fixture.otherRunId}/staged/staged-restore-api-wrong-run/restore`, {
      method: 'POST',
    }),
    stagedParams(fixture.otherRunId, 'staged-restore-api-wrong-run'),
  )
  const payload = await response.json() as { error?: string }
  const row = loadStagedRow('staged-restore-api-wrong-run')

  assert.equal(response.status, 404)
  assert.equal(typeof payload.error, 'string')
  assert.ok(row)
  assert.equal(row.status, 'deleted')
})

test('POST /api/import/runs/:id/staged/:stagedId/restore returns 409 for active rows', async () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-restore-api-active',
    fixture,
    status: 'ready',
    validationErrors: [],
  })

  const response = await restoreRoute.POST(
    request(`/api/import/runs/${fixture.runId}/staged/staged-restore-api-active/restore`, {
      method: 'POST',
    }),
    stagedParams(fixture.runId, 'staged-restore-api-active'),
  )
  const payload = await response.json() as { error?: string }
  const row = loadStagedRow('staged-restore-api-active')

  assert.equal(response.status, 409)
  assert.equal(typeof payload.error, 'string')
  assert.ok(row)
  assert.equal(row.status, 'ready')
})

test('POST /api/import/runs/:id/staged/:stagedId/restore returns 409 for merged rows', async () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-restore-api-merged',
    fixture,
    status: 'merged',
    validationErrors: [],
  })

  const response = await restoreRoute.POST(
    request(`/api/import/runs/${fixture.runId}/staged/staged-restore-api-merged/restore`, {
      method: 'POST',
    }),
    stagedParams(fixture.runId, 'staged-restore-api-merged'),
  )
  const payload = await response.json() as { error?: string }
  const row = loadStagedRow('staged-restore-api-merged')

  assert.equal(response.status, 409)
  assert.equal(typeof payload.error, 'string')
  assert.ok(row)
  assert.equal(row.status, 'merged')
})
