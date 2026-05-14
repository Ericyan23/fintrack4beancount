import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import type { SourceAccountMapping } from '../lib/ingest/account-mapping'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-source-account-mapping-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const mappingService = require('../lib/ingest/account-mapping') as typeof import('../lib/ingest/account-mapping')
const listRoute = require('../app/api/import/runs/[id]/source-accounts/route') as typeof import('../app/api/import/runs/[id]/source-accounts/route')
const patchRoute = require('../app/api/import/runs/[id]/source-accounts/[sourceAccountId]/route') as typeof import('../app/api/import/runs/[id]/source-accounts/[sourceAccountId]/route')

interface ListRouteContext {
  params: Promise<{ id: string }>
}

interface PatchRouteContext {
  params: Promise<{ id: string; sourceAccountId: string }>
}

interface Fixture {
  runId: string
  otherRunId: string
  sourceAccountId: string
  savingsSourceAccountId: string
  checkingAccountId: string
  otherRunStagedId: string
}

interface StagedRow {
  accountId: string | null
  status: string
  validationErrors: string | null
}

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function listParams(id: string): ListRouteContext {
  return { params: Promise.resolve({ id }) }
}

function patchParams(id: string, sourceAccountId: string): PatchRouteContext {
  return { params: Promise.resolve({ id, sourceAccountId }) }
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

function seedAccount(id: string, name: string): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    'USD',
    '0.00',
    1777593600,
    'mapping-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    null,
    1777593600,
  )
}

function seedFixture(): Fixture {
  const checkingAccountId = 'acct-mapping-checking'
  const savingsAccountId = 'acct-mapping-savings'
  seedAccount(checkingAccountId, 'Mapped Checking')
  seedAccount(savingsAccountId, 'Mapped Savings')

  const source = store.ensureSource({
    id: 'source-mapping-csv',
    kind: 'csv',
    name: 'Mapping CSV Imports',
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-mapping-csv',
    sourceId: source.id,
    name: 'Mapping CSV Connection',
  })
  const checkingSourceAccount = store.ensureSourceAccount({
    id: 'source-account-mapping-checking',
    sourceConnectionId: connection.id,
    externalAccountId: 'checking-ext',
    name: 'Imported Checking',
    currency: 'USD',
  })
  const savingsSourceAccount = store.ensureSourceAccount({
    id: 'source-account-mapping-savings',
    sourceConnectionId: connection.id,
    fintrackAccountId: savingsAccountId,
    externalAccountId: 'savings-ext',
    name: 'Imported Savings',
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: 'run-source-account-mapping',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })
  const otherRun = store.createImportRun({
    id: 'run-source-account-mapping-other',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })

  const rawValid = store.insertRawImportItem({
    id: 'raw-mapping-valid',
    importRunId: run.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-valid',
    sourceItemKey: 'key-valid',
    rawPayload: { description: 'Coffee Shop' },
  })
  const rawMissingPosted = store.insertRawImportItem({
    id: 'raw-mapping-missing-posted',
    importRunId: run.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-missing-posted',
    sourceItemKey: 'key-missing-posted',
    rawPayload: { description: 'Missing Posted' },
    status: 'error',
  })
  const rawMerged = store.insertRawImportItem({
    id: 'raw-mapping-merged',
    importRunId: run.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-merged',
    sourceItemKey: 'key-merged',
    rawPayload: { description: 'Merged Transaction' },
  })
  const rawSavings = store.insertRawImportItem({
    id: 'raw-mapping-savings',
    importRunId: run.id,
    sourceAccountId: savingsSourceAccount.id,
    externalId: 'external-savings',
    sourceItemKey: 'key-savings',
    rawPayload: { description: 'Savings Interest' },
  })
  const rawOtherRun = store.insertRawImportItem({
    id: 'raw-mapping-other-run',
    importRunId: otherRun.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-other-run',
    sourceItemKey: 'key-other-run',
    rawPayload: { description: 'Other Run Coffee' },
  })

  store.insertStagedTransaction({
    id: 'staged-mapping-valid',
    importRunId: run.id,
    rawItemId: rawValid.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-valid',
    sourceItemKey: 'key-valid',
    posted: 1777593600,
    amount: '-4.75',
    currency: 'USD',
    description: 'Coffee Shop',
    status: 'staged',
  })
  store.insertStagedTransaction({
    id: 'staged-mapping-missing-posted',
    importRunId: run.id,
    rawItemId: rawMissingPosted.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-missing-posted',
    sourceItemKey: 'key-missing-posted',
    amount: '-1.00',
    currency: 'USD',
    description: 'Missing Posted',
    status: 'error',
    validationErrors: ['Missing posted date'],
  })
  store.insertStagedTransaction({
    id: 'staged-mapping-merged',
    importRunId: run.id,
    rawItemId: rawMerged.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-merged',
    sourceItemKey: 'key-merged',
    posted: 1777680000,
    amount: '-20.00',
    currency: 'USD',
    description: 'Merged Transaction',
    status: 'merged',
    validationErrors: ['Leave merged status alone'],
  })
  store.insertStagedTransaction({
    id: 'staged-mapping-savings',
    importRunId: run.id,
    rawItemId: rawSavings.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: savingsSourceAccount.id,
    accountId: savingsAccountId,
    externalId: 'external-savings',
    sourceItemKey: 'key-savings',
    posted: 1777766400,
    amount: '0.25',
    currency: 'USD',
    description: 'Savings Interest',
    status: 'ready',
  })
  const otherRunStaged = store.insertStagedTransaction({
    id: 'staged-mapping-other-run',
    importRunId: otherRun.id,
    rawItemId: rawOtherRun.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: checkingSourceAccount.id,
    externalId: 'external-other-run',
    sourceItemKey: 'key-other-run',
    posted: 1777852800,
    amount: '-5.50',
    currency: 'USD',
    description: 'Other Run Coffee',
    status: 'staged',
  })

  store.finishImportRun({ id: run.id })
  store.finishImportRun({ id: otherRun.id, itemCount: 1 })

  return {
    runId: run.id,
    otherRunId: otherRun.id,
    sourceAccountId: checkingSourceAccount.id,
    savingsSourceAccountId: savingsSourceAccount.id,
    checkingAccountId,
    otherRunStagedId: otherRunStaged.id,
  }
}

function loadStagedRow(id: string): StagedRow {
  return sqlite.prepare(`
    SELECT
      account_id AS accountId,
      status,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE id = ?
  `).get(id) as StagedRow
}

function parseErrors(row: StagedRow): string[] {
  return row.validationErrors ? JSON.parse(row.validationErrors) as string[] : []
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('GET /api/import/runs/:id/source-accounts lists source accounts with staged and error counts', async () => {
  const fixture = seedFixture()
  const response = await listRoute.GET(
    request(`/api/import/runs/${fixture.runId}/source-accounts`),
    listParams(fixture.runId),
  )
  const payload = await response.json() as {
    sourceAccounts: SourceAccountMapping[]
  }

  assert.equal(response.status, 200)
  assert.equal(payload.sourceAccounts.length, 2)

  const checking = payload.sourceAccounts.find(account => account.id === fixture.sourceAccountId)
  assert.ok(checking)
  assert.equal(checking.externalAccountId, 'checking-ext')
  assert.equal(checking.name, 'Imported Checking')
  assert.equal(checking.currency, 'USD')
  assert.equal(checking.fintrackAccountId, null)
  assert.equal(checking.fintrackAccountName, null)
  assert.equal(checking.stagedCount, 3)
  assert.equal(checking.errorCount, 1)

  const savings = payload.sourceAccounts.find(account => account.id === fixture.savingsSourceAccountId)
  assert.ok(savings)
  assert.equal(savings.fintrackAccountId, 'acct-mapping-savings')
  assert.equal(savings.fintrackAccountName, 'Mapped Savings')
  assert.equal(savings.stagedCount, 1)
  assert.equal(savings.errorCount, 0)
})

test('GET /api/import/runs/:id/source-accounts returns 404 JSON for a missing run', async () => {
  const response = await listRoute.GET(
    request('/api/import/runs/missing-run/source-accounts'),
    listParams('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('PATCH maps a source account and updates source account, staged account IDs, and validation statuses', async () => {
  const fixture = seedFixture()
  const response = await patchRoute.PATCH(
    request(`/api/import/runs/${fixture.runId}/source-accounts/${fixture.sourceAccountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: fixture.checkingAccountId }),
    }),
    patchParams(fixture.runId, fixture.sourceAccountId),
  )
  const payload = await response.json() as {
    sourceAccount: SourceAccountMapping
  }
  const sourceAccount = sqlite.prepare(`
    SELECT fintrack_account_id AS fintrackAccountId
    FROM source_accounts
    WHERE id = ?
  `).get(fixture.sourceAccountId) as { fintrackAccountId: string | null }

  assert.equal(response.status, 200)
  assert.equal(payload.sourceAccount.fintrackAccountId, fixture.checkingAccountId)
  assert.equal(payload.sourceAccount.fintrackAccountName, 'Mapped Checking')
  assert.equal(payload.sourceAccount.errorCount, 1)
  assert.equal(sourceAccount.fintrackAccountId, fixture.checkingAccountId)

  const valid = loadStagedRow('staged-mapping-valid')
  assert.equal(valid.accountId, fixture.checkingAccountId)
  assert.equal(valid.status, 'ready')
  assert.deepEqual(parseErrors(valid), [])

  const missingPosted = loadStagedRow('staged-mapping-missing-posted')
  assert.equal(missingPosted.accountId, fixture.checkingAccountId)
  assert.equal(missingPosted.status, 'error')
  assert.deepEqual(parseErrors(missingPosted), ['Missing required field: posted'])

  const merged = loadStagedRow('staged-mapping-merged')
  assert.equal(merged.accountId, null)
  assert.equal(merged.status, 'merged')
  assert.deepEqual(parseErrors(merged), ['Leave merged status alone'])

  const otherRun = loadStagedRow(fixture.otherRunStagedId)
  assert.equal(otherRun.accountId, fixture.checkingAccountId)
  assert.equal(otherRun.status, 'ready')
  assert.deepEqual(parseErrors(otherRun), [])
})

test('updateSourceAccountMapping unmaps to null and marks promotable rows with missing account errors', () => {
  const fixture = seedFixture()
  mappingService.updateSourceAccountMapping({
    importRunId: fixture.runId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.checkingAccountId,
  })

  const updated = mappingService.updateSourceAccountMapping({
    importRunId: fixture.runId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: null,
  })
  const sourceAccount = sqlite.prepare(`
    SELECT fintrack_account_id AS fintrackAccountId
    FROM source_accounts
    WHERE id = ?
  `).get(fixture.sourceAccountId) as { fintrackAccountId: string | null }

  assert.equal(updated.fintrackAccountId, null)
  assert.equal(sourceAccount.fintrackAccountId, null)

  const valid = loadStagedRow('staged-mapping-valid')
  assert.equal(valid.accountId, null)
  assert.equal(valid.status, 'error')
  assert.deepEqual(parseErrors(valid), ['Missing required field: account_id'])

  const missingPosted = loadStagedRow('staged-mapping-missing-posted')
  assert.equal(missingPosted.accountId, null)
  assert.equal(missingPosted.status, 'error')
  assert.deepEqual(parseErrors(missingPosted), [
    'Missing required field: account_id',
    'Missing required field: posted',
  ])

  const merged = loadStagedRow('staged-mapping-merged')
  assert.equal(merged.accountId, null)
  assert.equal(merged.status, 'merged')

  const otherRun = loadStagedRow(fixture.otherRunStagedId)
  assert.equal(otherRun.accountId, null)
  assert.equal(otherRun.status, 'error')
  assert.deepEqual(parseErrors(otherRun), ['Missing required field: account_id'])
})

test('PATCH returns 404 JSON when the source account is not part of the import run', async () => {
  const fixture = seedFixture()
  const response = await patchRoute.PATCH(
    request(`/api/import/runs/${fixture.otherRunId}/source-accounts/${fixture.savingsSourceAccountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: fixture.checkingAccountId }),
    }),
    patchParams(fixture.otherRunId, fixture.savingsSourceAccountId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Source account not found')
})

test('PATCH returns 404 JSON for a missing import run', async () => {
  const fixture = seedFixture()
  const response = await patchRoute.PATCH(
    request(`/api/import/runs/missing-run/source-accounts/${fixture.sourceAccountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: fixture.checkingAccountId }),
    }),
    patchParams('missing-run', fixture.sourceAccountId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('PATCH returns 400 JSON for invalid account IDs and invalid request bodies', async () => {
  const fixture = seedFixture()
  const invalidAccountResponse = await patchRoute.PATCH(
    request(`/api/import/runs/${fixture.runId}/source-accounts/${fixture.sourceAccountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acct-does-not-exist' }),
    }),
    patchParams(fixture.runId, fixture.sourceAccountId),
  )
  const invalidAccountPayload = await invalidAccountResponse.json() as { error?: string }

  assert.equal(invalidAccountResponse.status, 400)
  assert.equal(invalidAccountPayload.error, 'Account not found')

  const invalidBodyResponse = await patchRoute.PATCH(
    request(`/api/import/runs/${fixture.runId}/source-accounts/${fixture.sourceAccountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: '' }),
    }),
    patchParams(fixture.runId, fixture.sourceAccountId),
  )
  const invalidBodyPayload = await invalidBodyResponse.json() as { error?: string }

  assert.equal(invalidBodyResponse.status, 400)
  assert.equal(invalidBodyPayload.error, 'accountId must be a non-empty string or null')
})
