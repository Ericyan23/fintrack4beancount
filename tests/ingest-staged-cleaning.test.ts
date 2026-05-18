import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-ingest-staged-cleaning-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const staged = require('../lib/ingest/staged') as typeof import('../lib/ingest/staged')

type StageStatus = 'staged' | 'ready' | 'merged' | 'ignored' | 'deleted' | 'error'

interface Fixture {
  accountId: string
  connectionId: string
  sourceAccountId: string
  runId: string
}

interface StoredStagedRow {
  accountId: string | null
  rawItemId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string | null
  posted: number | null
  amount: string | null
  description: string | null
  pending: number
  status: string
  category: string | null
  notes: string | null
  tags: string | null
  normalizedPayload: string | null
  validationErrors: string | null
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

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
}

function insertAccount(id: string): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Cleaning Checking',
    'USD',
    '0.00',
    1775001600,
    'cleaning-test',
    'Cleaning Bank',
    'cleaning.test',
    'depository',
    null,
    'Assets:US:Banks:CleaningChecking',
    1775001600,
  )

  return id
}

function createFixture(suffix = 'main'): Fixture {
  const accountId = insertAccount(`acct-cleaning-${suffix}`)
  const source = store.ensureSource({
    id: `source-cleaning-${suffix}`,
    kind: 'csv',
    name: `Cleaning CSV ${suffix}`,
  })
  const connection = store.ensureSourceConnection({
    id: `connection-cleaning-${suffix}`,
    sourceId: source.id,
    name: `Cleaning CSV Connection ${suffix}`,
  })
  const sourceAccount = store.ensureSourceAccount({
    id: `source-account-cleaning-${suffix}`,
    sourceConnectionId: connection.id,
    fintrackAccountId: accountId,
    externalAccountId: `checking-${suffix}`,
    name: `Cleaning Checking ${suffix}`,
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: `run-cleaning-${suffix}`,
    sourceConnectionId: connection.id,
  })

  return {
    accountId,
    connectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    runId: run.id,
  }
}

function stageTransaction(input: {
  id: string
  fixture: Fixture
  accountId?: string | null
  status?: StageStatus
  sourceItemKey?: string
  validationErrors?: string[] | null
}): void {
  const sourceItemKey = input.sourceItemKey ?? `checking:${input.id}`
  const raw = store.insertRawImportItem({
    id: `raw-${input.id}`,
    importRunId: input.fixture.runId,
    sourceAccountId: input.fixture.sourceAccountId,
    externalId: `external-${input.id}`,
    sourceItemKey,
    rawPayload: { stagedId: input.id, original: true },
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
    posted: 1777593600,
    transactedAt: 1777507200,
    amount: '-12.34',
    currency: 'USD',
    description: `Description ${input.id}`,
    pending: false,
    status: input.status ?? 'ready',
    category: 'Expenses:Food',
    notes: 'Imported note',
    tags: ['imported', 'test'],
    normalizedPayload: { stagedId: input.id, normalized: true },
    validationErrors: input.validationErrors,
    normalizerVersion: 'cleaning-normalizer-v1',
  })
}

function insertCanonicalTransaction(fixture: Fixture): void {
  sqlite.prepare(`
    INSERT INTO transactions
      (id, account_id, source_connection_id, source_account_id, external_id,
       source_item_key, import_run_id, raw_item_id, normalizer_version, source,
       posted, transacted_at, amount, description, pending, status, category,
       suggested_cat, notes, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
  `).run(
    'txn-cleaning-existing',
    fixture.accountId,
    fixture.connectionId,
    fixture.sourceAccountId,
    'external-existing',
    'checking:canonical-existing',
    fixture.runId,
    'existing-normalizer-v1',
    'csv',
    1777593600,
    '-1.00',
    'Existing transaction',
    0,
    'posted',
    1777593600,
    1777593600,
  )
}

function getStoredStagedRow(id: string): StoredStagedRow {
  return sqlite.prepare(`
    SELECT
      account_id AS accountId,
      raw_item_id AS rawItemId,
      source_connection_id AS sourceConnectionId,
      source_account_id AS sourceAccountId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      posted,
      amount,
      description,
      pending,
      status,
      category,
      notes,
      tags,
      normalized_payload AS normalizedPayload,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE id = ?
  `).get(id) as StoredStagedRow
}

function getRawPayload(id: string): string {
  const row = sqlite.prepare(`
    SELECT raw_payload AS rawPayload
    FROM raw_import_items
    WHERE id = ?
  `).get(id) as { rawPayload: string }
  return row.rawPayload
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('valid edits recompute ready status and preserve source facts', () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-edit-active',
    fixture,
    status: 'error',
    validationErrors: ['old error'],
  })
  insertCanonicalTransaction(fixture)

  const before = getStoredStagedRow('staged-edit-active')
  const rawBefore = getRawPayload('raw-staged-edit-active')
  const transactionCountBefore = countRows('transactions')
  const result = staged.updateStagedTransaction({
    importRunId: fixture.runId,
    stagedTransactionId: 'staged-edit-active',
    patch: {
      accountId: fixture.accountId,
      posted: 1777680000,
      amount: '-45.67',
      description: 'Edited merchant',
      pending: true,
      category: 'Expenses:Dining',
      notes: 'Reviewed note',
      tags: ['reviewed', 'tax'],
    },
  })

  assert.equal(result.id, 'staged-edit-active')
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.validationErrors, [])
  assert.ok(result.updatedAt)

  const afterRow = getStoredStagedRow('staged-edit-active')
  assert.equal(afterRow.accountId, fixture.accountId)
  assert.equal(afterRow.posted, 1777680000)
  assert.equal(afterRow.amount, '-45.67')
  assert.equal(afterRow.description, 'Edited merchant')
  assert.equal(afterRow.pending, 1)
  assert.equal(afterRow.status, 'ready')
  assert.equal(afterRow.category, 'Expenses:Dining')
  assert.equal(afterRow.notes, 'Reviewed note')
  assert.deepEqual(JSON.parse(afterRow.tags ?? 'null'), ['reviewed', 'tax'])
  assert.deepEqual(JSON.parse(afterRow.validationErrors ?? 'null'), [])

  assert.equal(afterRow.rawItemId, before.rawItemId)
  assert.equal(afterRow.sourceConnectionId, before.sourceConnectionId)
  assert.equal(afterRow.sourceAccountId, before.sourceAccountId)
  assert.equal(afterRow.externalId, before.externalId)
  assert.equal(afterRow.sourceItemKey, before.sourceItemKey)
  assert.equal(afterRow.normalizedPayload, before.normalizedPayload)
  assert.equal(getRawPayload('raw-staged-edit-active'), rawBefore)
  assert.equal(countRows('transactions'), transactionCountBefore)
})

test('edit marks a row error when required fields are missing', () => {
  const fixture = createFixture()
  stageTransaction({ id: 'staged-missing-required', fixture })

  const result = staged.updateStagedTransaction({
    importRunId: fixture.runId,
    stagedTransactionId: 'staged-missing-required',
    patch: {
      accountId: null,
      amount: null,
      description: ' ',
    },
  })

  assert.equal(result.status, 'error')
  assert.deepEqual(result.validationErrors, ['account_id', 'amount', 'description'])

  const row = getStoredStagedRow('staged-missing-required')
  assert.equal(row.status, 'error')
  assert.deepEqual(JSON.parse(row.validationErrors ?? 'null'), ['account_id', 'amount', 'description'])
  assert.equal(countRows('transactions'), 0)
})

test('ignore and delete are soft mutations that clear validation errors', () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-ignore',
    fixture,
    status: 'error',
    validationErrors: ['account_id'],
  })
  stageTransaction({
    id: 'staged-delete',
    fixture,
    status: 'error',
    validationErrors: ['amount'],
  })

  const ignored = staged.ignoreStagedTransaction({
    importRunId: fixture.runId,
    stagedTransactionId: 'staged-ignore',
  })
  const deleted = staged.deleteStagedTransaction({
    importRunId: fixture.runId,
    stagedTransactionId: 'staged-delete',
  })

  assert.equal(ignored.status, 'ignored')
  assert.deepEqual(ignored.validationErrors, [])
  assert.equal(deleted.status, 'deleted')
  assert.deepEqual(deleted.validationErrors, [])
  assert.equal(countRows('staged_transactions'), 2)
  assert.equal(countRows('raw_import_items'), 2)
  assert.equal(countRows('transactions'), 0)

  const ignoredRow = getStoredStagedRow('staged-ignore')
  const deletedRow = getStoredStagedRow('staged-delete')
  assert.equal(ignoredRow.status, 'ignored')
  assert.equal(deletedRow.status, 'deleted')
  assert.deepEqual(JSON.parse(ignoredRow.validationErrors ?? 'null'), [])
  assert.deepEqual(JSON.parse(deletedRow.validationErrors ?? 'null'), [])
})

test('ignored and deleted rows reject normal edits without an explicit restore action', () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-edit-ignored',
    fixture,
    status: 'ignored',
    validationErrors: [],
  })
  stageTransaction({
    id: 'staged-edit-deleted',
    fixture,
    status: 'deleted',
    validationErrors: [],
  })

  assert.throws(
    () => staged.updateStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-edit-ignored',
      patch: { notes: 'Should not restore' },
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )
  assert.throws(
    () => staged.updateStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-edit-deleted',
      patch: { notes: 'Should not restore' },
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )

  assert.equal(getStoredStagedRow('staged-edit-ignored').status, 'ignored')
  assert.equal(getStoredStagedRow('staged-edit-ignored').notes, 'Imported note')
  assert.equal(getStoredStagedRow('staged-edit-deleted').status, 'deleted')
  assert.equal(getStoredStagedRow('staged-edit-deleted').notes, 'Imported note')
})

test('ignored and deleted rows reject direct soft-state switching', () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-switch-ignored',
    fixture,
    status: 'ignored',
    validationErrors: [],
  })
  stageTransaction({
    id: 'staged-switch-deleted',
    fixture,
    status: 'deleted',
    validationErrors: [],
  })

  assert.throws(
    () => staged.deleteStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-switch-ignored',
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )
  assert.throws(
    () => staged.ignoreStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-switch-deleted',
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )

  assert.equal(getStoredStagedRow('staged-switch-ignored').status, 'ignored')
  assert.equal(getStoredStagedRow('staged-switch-deleted').status, 'deleted')
})

test('merged rows reject edit, ignore, and delete', () => {
  const fixture = createFixture()
  stageTransaction({ id: 'staged-merged', fixture, status: 'merged' })

  assert.throws(
    () => staged.updateStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-merged',
      patch: { notes: 'Should not change' },
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )
  assert.throws(
    () => staged.ignoreStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-merged',
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )
  assert.throws(
    () => staged.deleteStagedTransaction({
      importRunId: fixture.runId,
      stagedTransactionId: 'staged-merged',
    }),
    error => error instanceof staged.StagedTransactionConflictError,
  )

  const row = getStoredStagedRow('staged-merged')
  assert.equal(row.status, 'merged')
  assert.equal(row.notes, 'Imported note')
  assert.equal(countRows('transactions'), 0)
})

test('mutations are scoped to the requested import run', () => {
  const first = createFixture('first')
  const second = createFixture('second')
  stageTransaction({ id: 'staged-scoped', fixture: first })

  assert.throws(
    () => staged.updateStagedTransaction({
      importRunId: second.runId,
      stagedTransactionId: 'staged-scoped',
      patch: { notes: 'Wrong run' },
    }),
    error => error instanceof staged.StagedTransactionNotFoundError,
  )
  assert.throws(
    () => staged.ignoreStagedTransaction({
      importRunId: second.runId,
      stagedTransactionId: 'staged-scoped',
    }),
    error => error instanceof staged.StagedTransactionNotFoundError,
  )
  assert.throws(
    () => staged.deleteStagedTransaction({
      importRunId: second.runId,
      stagedTransactionId: 'staged-scoped',
    }),
    error => error instanceof staged.StagedTransactionNotFoundError,
  )

  const row = getStoredStagedRow('staged-scoped')
  assert.equal(row.status, 'ready')
  assert.equal(row.notes, 'Imported note')
  assert.equal(countRows('transactions'), 0)
})
