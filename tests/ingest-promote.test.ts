import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-ingest-promote-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const { promoteStagedTransactions } = require('../lib/ingest/promote') as typeof import('../lib/ingest/promote')

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

function insertAccount(id = 'acct-promote-checking'): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Promote Checking',
    'USD',
    '0.00',
    1775001600,
    'promote-test',
    'Promote Bank',
    'promote.test',
    'depository',
    null,
    'Assets:US:Banks:PromoteChecking',
    1775001600,
  )

  return id
}

function createImportFixture(runId = 'run-promote-test'): {
  accountId: string
  connectionId: string
  sourceAccountId: string
  runId: string
} {
  const accountId = insertAccount()
  const source = store.ensureSource({
    id: 'source-promote-csv',
    kind: 'csv',
    name: 'Promote CSV',
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-promote-csv',
    sourceId: source.id,
    name: 'Promote CSV Connection',
  })
  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-promote-checking',
    sourceConnectionId: connection.id,
    fintrackAccountId: accountId,
    externalAccountId: 'checking',
    name: 'Promote Checking',
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: runId,
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
  runId: string
  connectionId: string
  sourceAccountId: string
  accountId?: string | null
  sourceItemKey?: string | null
  status?: 'staged' | 'ready' | 'merged' | 'ignored' | 'error'
  normalizedStatus?: 'posted' | 'pending' | 'cancelled'
  rawItemId?: string
  amount?: string | null
  description?: string | null
  category?: string | null
}): void {
  let rawItemId = input.rawItemId ?? null
  if (!rawItemId && input.sourceItemKey) {
    const raw = store.insertRawImportItem({
      id: `raw-${input.id}`,
      importRunId: input.runId,
      sourceAccountId: input.sourceAccountId,
      externalId: input.id,
      sourceItemKey: input.sourceItemKey,
      rawPayload: { stagedId: input.id },
    })
    rawItemId = raw.item.id
  }

  store.insertStagedTransaction({
    id: input.id,
    importRunId: input.runId,
    rawItemId,
    sourceConnectionId: input.connectionId,
    sourceAccountId: input.sourceAccountId,
    accountId: input.accountId === undefined ? 'acct-promote-checking' : input.accountId,
    externalId: `external-${input.id}`,
    sourceItemKey: input.sourceItemKey ?? `key-${input.id}`,
    posted: 1777593600,
    transactedAt: 1777507200,
    amount: input.amount === undefined ? '-12.34' : input.amount,
    currency: 'USD',
    description: input.description === undefined ? `Description ${input.id}` : input.description,
    pending: input.normalizedStatus === 'pending',
    status: input.status ?? 'ready',
    category: input.category === undefined ? 'Expenses:Food' : input.category,
    notes: 'Imported note',
    tags: ['promote', 'test'],
    normalizedPayload: input.normalizedStatus ? { status: input.normalizedStatus } : undefined,
    normalizerVersion: 'promote-normalizer-v1',
  })
}

function completeRun(runId: string): void {
  store.finishImportRun({ id: runId })
}

function transactionCount(): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM transactions`).get() as { value: number }
  return row.value
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('promotes a staged transaction into canonical transactions with provenance', () => {
  const fixture = createImportFixture()
  stageTransaction({
    id: 'staged-success',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.accountId,
    sourceItemKey: 'checking:success-001',
  })
  completeRun(fixture.runId)

  const result = promoteStagedTransactions({ importRunId: fixture.runId })

  assert.deepEqual(result, { promoted: 1, skipped: 0, enriched: 0, errors: [] })

  const transaction = sqlite.prepare(`
    SELECT id,
           account_id AS accountId,
           source,
           source_connection_id AS sourceConnectionId,
           source_account_id AS sourceAccountId,
           external_id AS externalId,
           source_item_key AS sourceItemKey,
           import_run_id AS importRunId,
           raw_item_id AS rawItemId,
           normalizer_version AS normalizerVersion,
           posted,
           transacted_at AS transactedAt,
           amount,
           description,
           pending,
           status,
           category,
           notes,
           tags,
           updated_at AS updatedAt
    FROM transactions
    LIMIT 1
  `).get() as {
    id: string
    accountId: string
    source: string
    sourceConnectionId: string
    sourceAccountId: string
    externalId: string
    sourceItemKey: string
    importRunId: string
    rawItemId: string
    normalizerVersion: string
    posted: number
    transactedAt: number
    amount: string
    description: string
    pending: number
    status: string
    category: string
    notes: string
    tags: string
    updatedAt: number
  }

  assert.match(transaction.id, /^txn:ingest:[a-f0-9]{32}$/)
  assert.equal(transaction.accountId, fixture.accountId)
  assert.equal(transaction.source, 'csv')
  assert.equal(transaction.sourceConnectionId, fixture.connectionId)
  assert.equal(transaction.sourceAccountId, fixture.sourceAccountId)
  assert.equal(transaction.externalId, 'external-staged-success')
  assert.equal(transaction.sourceItemKey, 'checking:success-001')
  assert.equal(transaction.importRunId, fixture.runId)
  assert.equal(transaction.rawItemId, 'raw-staged-success')
  assert.equal(transaction.normalizerVersion, 'promote-normalizer-v1')
  assert.equal(transaction.posted, 1777593600)
  assert.equal(transaction.transactedAt, 1777507200)
  assert.equal(transaction.amount, '-12.34')
  assert.equal(transaction.description, 'Description staged-success')
  assert.equal(transaction.pending, 0)
  assert.equal(transaction.status, 'posted')
  assert.equal(transaction.category, 'Expenses:Food')
  assert.equal(transaction.notes, 'Imported note')
  assert.deepEqual(JSON.parse(transaction.tags), ['promote', 'test'])
  assert.ok(transaction.updatedAt)

  const staged = sqlite.prepare(`
    SELECT status, transaction_id AS transactionId
    FROM staged_transactions
    WHERE id = 'staged-success'
  `).get() as { status: string; transactionId: string }

  assert.equal(staged.status, 'merged')
  assert.equal(staged.transactionId, transaction.id)
})

test('skips a canonical duplicate and links staged row to the existing transaction', () => {
  const fixture = createImportFixture()
  const now = 1777593600

  sqlite.prepare(`
    INSERT INTO transactions
      (id, account_id, source_connection_id, source_account_id, external_id,
       source_item_key, import_run_id, raw_item_id, normalizer_version, source,
       posted, transacted_at, amount, description, pending, status, category,
       suggested_cat, notes, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
  `).run(
    'txn-existing-duplicate',
    fixture.accountId,
    fixture.connectionId,
    fixture.sourceAccountId,
    'external-existing',
    'checking:duplicate-001',
    fixture.runId,
    'existing-normalizer-v1',
    'csv',
    now,
    '-1.00',
    'Existing duplicate',
    0,
    'posted',
    now,
    now,
  )

  stageTransaction({
    id: 'staged-duplicate',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.accountId,
    sourceItemKey: 'checking:duplicate-001',
  })
  completeRun(fixture.runId)

  const result = promoteStagedTransactions({ importRunId: fixture.runId })

  assert.deepEqual(result, { promoted: 0, skipped: 1, enriched: 0, errors: [] })
  assert.equal(transactionCount(), 1)

  const staged = sqlite.prepare(`
    SELECT status, transaction_id AS transactionId
    FROM staged_transactions
    WHERE id = 'staged-duplicate'
  `).get() as { status: string; transactionId: string }

  assert.equal(staged.status, 'merged')
  assert.equal(staged.transactionId, 'txn-existing-duplicate')
})

test('skips ignored, error, and merged staged rows without inserting transactions', () => {
  const fixture = createImportFixture()

  for (const status of ['ignored', 'error', 'merged'] as const) {
    stageTransaction({
      id: `staged-${status}`,
      runId: fixture.runId,
      connectionId: fixture.connectionId,
      sourceAccountId: fixture.sourceAccountId,
      accountId: fixture.accountId,
      sourceItemKey: `checking:${status}-001`,
      status,
    })
  }
  completeRun(fixture.runId)

  const result = promoteStagedTransactions({ importRunId: fixture.runId })

  assert.deepEqual(result, { promoted: 0, skipped: 3, enriched: 0, errors: [] })
  assert.equal(transactionCount(), 0)

  const statuses = sqlite.prepare(`
    SELECT status
    FROM staged_transactions
    ORDER BY id
  `).all().map(row => (row as { status: string }).status)

  assert.deepEqual(statuses, ['error', 'ignored', 'merged'])
})

test('records required-field errors without stopping the rest of the batch', () => {
  const fixture = createImportFixture()

  stageTransaction({
    id: 'staged-missing-account',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: null,
    sourceItemKey: 'checking:missing-account-001',
  })
  stageTransaction({
    id: 'staged-valid-after-error',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.accountId,
    sourceItemKey: 'checking:valid-after-error-001',
  })
  completeRun(fixture.runId)

  const result = promoteStagedTransactions({ importRunId: fixture.runId })

  assert.equal(result.promoted, 1)
  assert.equal(result.skipped, 0)
  assert.deepEqual(result.errors, [
    {
      stagedTransactionId: 'staged-missing-account',
      error: 'Missing required fields: account_id',
    },
  ])
  assert.equal(transactionCount(), 1)

  const invalid = sqlite.prepare(`
    SELECT status, transaction_id AS transactionId
    FROM staged_transactions
    WHERE id = 'staged-missing-account'
  `).get() as { status: string; transactionId: string | null }

  assert.equal(invalid.status, 'ready')
  assert.equal(invalid.transactionId, null)
})

test('rejects promote for a run that is not completed', () => {
  const fixture = createImportFixture()
  stageTransaction({
    id: 'staged-running-run',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.accountId,
    sourceItemKey: 'checking:running-run-001',
  })

  assert.throws(
    () => promoteStagedTransactions({ importRunId: fixture.runId }),
    /Import run must be completed before promote: running/,
  )
  assert.equal(transactionCount(), 0)
})

test('preserves cancelled normalized transaction status when promoting', () => {
  const fixture = createImportFixture()
  stageTransaction({
    id: 'staged-cancelled',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.accountId,
    sourceItemKey: 'checking:cancelled-001',
    normalizedStatus: 'cancelled',
  })
  completeRun(fixture.runId)

  const result = promoteStagedTransactions({ importRunId: fixture.runId })

  assert.deepEqual(result, { promoted: 1, skipped: 0, enriched: 0, errors: [] })

  const transaction = sqlite.prepare(`
    SELECT status, pending
    FROM transactions
    LIMIT 1
  `).get() as { status: string; pending: number }

  assert.equal(transaction.status, 'cancelled')
  assert.equal(transaction.pending, 0)
})

test('post-import enrichment applies rules to promoted posted rows without a ledger account', () => {
  const fixture = createImportFixture()
  stageTransaction({
    id: 'staged-rule-enrichment',
    runId: fixture.runId,
    connectionId: fixture.connectionId,
    sourceAccountId: fixture.sourceAccountId,
    accountId: fixture.accountId,
    sourceItemKey: 'checking:rule-enrichment-001',
    description: 'Coffee Shop',
    category: null,
  })
  completeRun(fixture.runId)

  const result = promoteStagedTransactions({ importRunId: fixture.runId })

  assert.deepEqual(result, { promoted: 1, skipped: 0, enriched: 1, errors: [] })

  const transaction = sqlite.prepare(`
    SELECT
      category,
      ledger_account AS ledgerAccount,
      review_status AS reviewStatus,
      classifier
    FROM transactions
    LIMIT 1
  `).get() as {
    category: string | null
    ledgerAccount: string | null
    reviewStatus: string | null
    classifier: string | null
  }

  assert.equal(transaction.category, 'Expenses:Food:Restaurants')
  assert.equal(transaction.ledgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(transaction.reviewStatus, 'reviewed')
  assert.equal(transaction.classifier, 'rule')
})
