import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-ingest-store-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const {
  buildCsvSourceItemKey,
  normalizeCsvTransactions,
} = require('../lib/ingest/csv') as typeof import('../lib/ingest/csv')

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM staged_transactions;
    DELETE FROM raw_import_items;
    DELETE FROM import_runs;
    DELETE FROM import_profile_mappings;
    DELETE FROM import_profiles;
    DELETE FROM source_accounts;
    DELETE FROM source_connections;
    DELETE FROM sources;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
}

function createRun(): { sourceId: string; connectionId: string; runId: string } {
  const source = store.ensureSource({
    id: 'source-csv-test',
    kind: 'csv',
    name: 'CSV Test Imports',
    metadata: { owner: 'ingest-store-test' },
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-csv-test',
    sourceId: source.id,
    name: 'CSV Test Connection',
    config: { mode: 'test' },
  })
  const run = store.createImportRun({
    id: 'run-csv-test',
    sourceConnectionId: connection.id,
  })

  return {
    sourceId: source.id,
    connectionId: connection.id,
    runId: run.id,
  }
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('creates source, connection, import run, raw item, and staged transaction on a fresh database', () => {
  const source = store.ensureSource({
    id: 'source-csv-test',
    kind: 'csv',
    name: 'CSV Test Imports',
    metadata: { owner: 'ingest-store-test' },
  })
  const sourceAgain = store.ensureSource({
    id: 'source-csv-test',
    kind: 'csv',
    name: 'CSV Test Imports',
  })

  assert.equal(source.id, 'source-csv-test')
  assert.equal(sourceAgain.id, source.id)
  assert.equal(countRows('sources'), 1)

  const connection = store.ensureSourceConnection({
    id: 'connection-csv-test',
    sourceId: source.id,
    name: 'CSV Test Connection',
    config: { mode: 'test' },
  })
  const connectionAgain = store.ensureSourceConnection({
    id: 'connection-csv-test',
    sourceId: source.id,
    name: 'CSV Test Connection',
  })

  assert.equal(connection.id, 'connection-csv-test')
  assert.equal(connectionAgain.id, connection.id)
  assert.equal(countRows('source_connections'), 1)

  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-csv-checking',
    sourceConnectionId: connection.id,
    externalAccountId: 'Main Checking',
    name: 'Main Checking',
    currency: 'USD',
    rawPayload: { accountName: 'Main Checking' },
  })
  const sourceAccountAgain = store.ensureSourceAccount({
    id: 'source-account-csv-checking',
    sourceConnectionId: connection.id,
    externalAccountId: 'Main Checking',
  })

  assert.equal(sourceAccount.id, 'source-account-csv-checking')
  assert.equal(sourceAccountAgain.id, sourceAccount.id)
  assert.equal(countRows('source_accounts'), 1)

  const run = store.createImportRun({
    id: 'run-csv-test',
    sourceConnectionId: connection.id,
  })
  assert.equal(run.status, 'running')
  assert.equal(run.itemCount, 0)

  const rawPayload = {
    externalId: 'txn-001',
    posted: '2026-05-01',
    amount: '-12.34',
    merchant: 'Coffee Shop',
    metadata: { tags: ['coffee', 'work'] },
  }
  const raw = store.insertRawImportItem({
    id: 'raw-txn-001',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'txn-001',
    sourceItemKey: 'acct-001:txn-001',
    rawPayload,
  })

  assert.equal(raw.status, 'inserted')
  assert.equal(raw.item.sourceItemKey, 'acct-001:txn-001')
  assert.deepEqual(raw.item.rawPayload, rawPayload)
  assert.ok(raw.item.contentHash)

  const staged = store.insertStagedTransaction({
    id: 'staged-txn-001',
    importRunId: run.id,
    rawItemId: raw.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'txn-001',
    sourceItemKey: 'acct-001:txn-001',
    posted: 1777593600,
    amount: '-12.34',
    currency: 'USD',
    description: 'Coffee Shop',
    status: 'ready',
    tags: ['coffee', 'work'],
    normalizedPayload: {
      posted: 1777593600,
      amount: '-12.34',
      description: 'Coffee Shop',
    },
    normalizerVersion: 'test-normalizer-v1',
  })

  assert.equal(staged.id, 'staged-txn-001')
  assert.equal(staged.rawItemId, raw.item.id)
  assert.deepEqual(staged.tags, ['coffee', 'work'])
  assert.equal(staged.normalizerVersion, 'test-normalizer-v1')

  const finished = store.finishImportRun({ id: run.id })
  assert.equal(finished.status, 'completed')
  assert.equal(finished.itemCount, 1)
  assert.equal(countRows('raw_import_items'), 1)
  assert.equal(countRows('staged_transactions'), 1)
  assert.equal(countRows('transactions'), 0)
})

test('returns duplicate for a repeated raw item without adding another row', () => {
  const { runId } = createRun()
  const first = store.insertRawImportItem({
    id: 'raw-duplicate-original',
    importRunId: runId,
    externalId: 'duplicate-001',
    sourceItemKey: 'acct-001:duplicate-001',
    rawPayload: { externalId: 'duplicate-001', amount: '10.00' },
  })
  const duplicate = store.insertRawImportItem({
    id: 'raw-duplicate-new-id',
    importRunId: runId,
    externalId: 'duplicate-001',
    sourceItemKey: 'acct-001:duplicate-001',
    rawPayload: { externalId: 'duplicate-001', amount: '10.00' },
  })

  assert.equal(first.status, 'inserted')
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.item.id, first.item.id)
  assert.equal(countRows('raw_import_items'), 1)
})

test('keeps the raw payload JSON in raw_import_items', () => {
  const { runId } = createRun()
  const payload = {
    id: 'payload-001',
    nested: {
      description: 'Original bank payload',
      values: [1, 'two', false],
    },
  }
  const raw = store.insertRawImportItem({
    id: 'raw-payload-001',
    importRunId: runId,
    sourceItemKey: 'payload-001',
    rawPayload: payload,
  })
  const stored = sqlite.prepare(`
    SELECT raw_payload AS rawPayload
    FROM raw_import_items
    WHERE id = ?
  `).get(raw.item.id) as { rawPayload: string }

  assert.deepEqual(raw.item.rawPayload, payload)
  assert.deepEqual(JSON.parse(stored.rawPayload), payload)
})

test('stages normalized CSV rows after resolving a valid source account', () => {
  const { connectionId, runId } = createRun()
  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-main-checking',
    sourceConnectionId: connectionId,
    externalAccountId: 'Main Checking',
    name: 'Main Checking',
    currency: 'USD',
  })
  const csv = [
    'Date,Description,Amount,Account,Category,Notes,Tags,Status',
    '2026-05-01,Coffee Shop,-3.50,Main Checking,Expenses:Food:Coffee,Morning,coffee;work,posted',
  ].join('\n')
  const normalized = normalizeCsvTransactions(csv)
  const row = normalized.rows[0]
  const sourceItemKey = buildCsvSourceItemKey(row, sourceAccount.id)

  assert.ok(sourceItemKey)
  assert.match(sourceItemKey, /^source-account:source-account-main-checking:hash:[a-f0-9]{32}$/)
  assert.equal(typeof row.amount, 'string')

  const raw = store.insertRawImportItem({
    importRunId: runId,
    sourceAccountId: sourceAccount.id,
    externalId: row.externalId,
    sourceItemKey,
    rawPayload: row.rawPayload,
  })
  const staged = store.insertStagedTransaction({
    importRunId: runId,
    rawItemId: raw.item.id,
    sourceConnectionId: connectionId,
    sourceAccountId: sourceAccount.id,
    externalId: row.externalId,
    sourceItemKey,
    posted: row.posted,
    amount: row.amount,
    currency: 'USD',
    description: row.description,
    pending: row.pending,
    status: 'staged',
    category: row.category,
    notes: row.notes,
    tags: row.tags,
    normalizedPayload: row.rawPayload,
    validationErrors: row.validationErrors,
    normalizerVersion: 'csv-normalizer-test-v1',
  })

  assert.equal(raw.status, 'inserted')
  assert.equal(raw.item.sourceAccountId, sourceAccount.id)
  assert.equal(staged.sourceAccountId, sourceAccount.id)
  assert.equal(staged.amount, '-3.50')
  assert.deepEqual(staged.tags, ['coffee', 'work'])
  assert.equal(countRows('transactions'), 0)
})
