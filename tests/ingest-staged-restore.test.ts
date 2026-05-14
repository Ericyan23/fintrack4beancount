import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-ingest-staged-restore-'))
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

interface StoredRestoreRow {
  status: string
  validationErrors: string | null
}

interface SourceFacts {
  rawItemId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string | null
  normalizedPayload: string | null
  rawPayload: string | null
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
    'Restore Checking',
    'USD',
    '0.00',
    1775001600,
    'restore-test',
    'Restore Bank',
    'restore.test',
    'depository',
    null,
    'Assets:US:Banks:RestoreChecking',
    1775001600,
  )

  return id
}

function createFixture(suffix = 'main'): Fixture {
  const accountId = insertAccount(`acct-restore-${suffix}`)
  const source = store.ensureSource({
    id: `source-restore-${suffix}`,
    kind: 'csv',
    name: `Restore CSV ${suffix}`,
  })
  const connection = store.ensureSourceConnection({
    id: `connection-restore-${suffix}`,
    sourceId: source.id,
    name: `Restore CSV Connection ${suffix}`,
  })
  const sourceAccount = store.ensureSourceAccount({
    id: `source-account-restore-${suffix}`,
    sourceConnectionId: connection.id,
    fintrackAccountId: accountId,
    externalAccountId: `checking-${suffix}`,
    name: `Restore Checking ${suffix}`,
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: `run-restore-${suffix}`,
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
  posted?: number | null
  status?: StageStatus
  validationErrors?: string[] | null
}): void {
  const sourceItemKey = `checking:${input.id}`
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
    posted: input.posted === undefined ? 1777593600 : input.posted,
    transactedAt: 1777507200,
    amount: '-12.34',
    currency: 'USD',
    description: `Description ${input.id}`,
    pending: false,
    status: input.status ?? 'ignored',
    category: 'Expenses:Food',
    notes: 'Imported note',
    tags: ['imported', 'test'],
    normalizedPayload: { stagedId: input.id, normalized: true },
    validationErrors: input.validationErrors,
    normalizerVersion: 'restore-normalizer-v1',
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
    'txn-restore-existing',
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

function getStoredRestoreRow(id: string): StoredRestoreRow {
  return sqlite.prepare(`
    SELECT
      status,
      validation_errors AS validationErrors
    FROM staged_transactions
    WHERE id = ?
  `).get(id) as StoredRestoreRow
}

function getSourceFacts(id: string): SourceFacts {
  return sqlite.prepare(`
    SELECT
      staged.raw_item_id AS rawItemId,
      staged.source_connection_id AS sourceConnectionId,
      staged.source_account_id AS sourceAccountId,
      staged.external_id AS externalId,
      staged.source_item_key AS sourceItemKey,
      staged.normalized_payload AS normalizedPayload,
      raw.raw_payload AS rawPayload
    FROM staged_transactions AS staged
    LEFT JOIN raw_import_items AS raw ON raw.id = staged.raw_item_id
    WHERE staged.id = ?
  `).get(id) as SourceFacts
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('restore ignored row recomputes ready status without touching source facts or canonical transactions', () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-restore-ignored',
    fixture,
    status: 'ignored',
    validationErrors: [],
  })
  insertCanonicalTransaction(fixture)

  const beforeFacts = getSourceFacts('staged-restore-ignored')
  const transactionCountBefore = countRows('transactions')
  const result = staged.restoreStagedTransaction({
    importRunId: fixture.runId,
    stagedTransactionId: 'staged-restore-ignored',
  })

  assert.equal(result.id, 'staged-restore-ignored')
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.validationErrors, [])
  assert.ok(result.updatedAt)
  assert.deepEqual(getSourceFacts('staged-restore-ignored'), beforeFacts)
  assert.equal(countRows('transactions'), transactionCountBefore)

  const row = getStoredRestoreRow('staged-restore-ignored')
  assert.equal(row.status, 'ready')
  assert.deepEqual(JSON.parse(row.validationErrors ?? 'null'), [])
})

test('restore deleted row with missing account and date returns error validation state', () => {
  const fixture = createFixture()
  stageTransaction({
    id: 'staged-restore-deleted-missing-fields',
    fixture,
    accountId: null,
    posted: null,
    status: 'deleted',
    validationErrors: [],
  })

  const transactionCountBefore = countRows('transactions')
  const result = staged.restoreStagedTransaction({
    importRunId: fixture.runId,
    stagedTransactionId: 'staged-restore-deleted-missing-fields',
  })

  assert.equal(result.status, 'error')
  assert.deepEqual(result.validationErrors, ['account_id', 'posted'])
  assert.equal(countRows('transactions'), transactionCountBefore)

  const row = getStoredRestoreRow('staged-restore-deleted-missing-fields')
  assert.equal(row.status, 'error')
  assert.deepEqual(JSON.parse(row.validationErrors ?? 'null'), ['account_id', 'posted'])
})

test('restore rejects active and merged rows as conflicts', () => {
  const fixture = createFixture()
  const statuses: StageStatus[] = ['staged', 'ready', 'error', 'merged']

  for (const status of statuses) {
    const id = `staged-restore-conflict-${status}`
    stageTransaction({
      id,
      fixture,
      status,
      validationErrors: status === 'error' ? ['account_id'] : [],
    })

    assert.throws(
      () => staged.restoreStagedTransaction({
        importRunId: fixture.runId,
        stagedTransactionId: id,
      }),
      error => error instanceof staged.StagedTransactionConflictError,
    )
    assert.equal(getStoredRestoreRow(id).status, status)
  }
})

test('restore is scoped to the requested import run', () => {
  const first = createFixture('first')
  const second = createFixture('second')
  stageTransaction({
    id: 'staged-restore-scoped',
    fixture: first,
    status: 'ignored',
    validationErrors: [],
  })

  assert.throws(
    () => staged.restoreStagedTransaction({
      importRunId: second.runId,
      stagedTransactionId: 'staged-restore-scoped',
    }),
    error => error instanceof staged.StagedTransactionNotFoundError,
  )

  assert.equal(getStoredRestoreRow('staged-restore-scoped').status, 'ignored')
  assert.equal(countRows('transactions'), 0)
})
