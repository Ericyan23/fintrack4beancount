import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-db-migration-'))
const dbPath = path.join(tempDir, 'legacy-fintrack.db')
process.env.DB_PATH = dbPath

let sqlite: import('better-sqlite3').Database | undefined

function createLegacyDatabase(): void {
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      balance TEXT NOT NULL,
      balance_date INTEGER NOT NULL,
      conn_id TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'depository',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      source TEXT NOT NULL DEFAULT 'simplefin',
      posted INTEGER NOT NULL,
      transacted_at INTEGER,
      amount TEXT NOT NULL,
      description TEXT NOT NULL,
      pending INTEGER NOT NULL DEFAULT 0,
      category TEXT,
      suggested_cat TEXT,
      notes TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE transaction_splits (
      id TEXT PRIMARY KEY,
      parent_transaction_id TEXT,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      ledger_account TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, account_type, updated_at
    )
    VALUES (
      'acct-legacy-checking', 'Legacy Checking', 'USD', '12.34', 1775001600,
      'legacy-simplefin-conn', 'depository', 1775001600
    );

    INSERT INTO transactions (
      id, account_id, source, posted, amount, description, pending, created_at
    )
    VALUES (
      'txn-legacy-001', 'acct-legacy-checking', 'simplefin', 1775001600,
      '-4.50', 'Legacy Coffee', 0, 1775001600
    ), (
      'csv:legacy-002', 'acct-legacy-checking', 'csv', 1775088000,
      '-12.00', 'Legacy CSV Lunch', 0, 1775088000
    );
  `)
  legacy.close()
}

function loadDbModule(): typeof import('../lib/db') {
  const resolved = require.resolve('../lib/db')
  delete require.cache[resolved]
  return require('../lib/db') as typeof import('../lib/db')
}

function columnNames(table: string): string[] {
  return sqlite!.prepare(`PRAGMA table_info(${table})`).all().map(row => (row as { name: string }).name)
}

function indexNames(table: string): string[] {
  return sqlite!.prepare(`PRAGMA index_list(${table})`).all().map(row => (row as { name: string }).name)
}

function columnDefault(table: string, column: string): string | null {
  const row = sqlite!.prepare(`PRAGMA table_info(${table})`)
    .all()
    .find(info => (info as { name: string }).name === column) as { dflt_value: string | null } | undefined
  return row?.dflt_value ?? null
}

function scalar(sql: string): number {
  const row = sqlite!.prepare(sql).get() as { value: number }
  return row.value
}

after(() => {
  sqlite?.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('runs ingestion schema migrations idempotently on a legacy database', () => {
  createLegacyDatabase()

  sqlite = loadDbModule().sqlite
  const transactionColumns = columnNames('transactions')

  for (const table of [
    'sources',
    'source_connections',
    'source_accounts',
    'import_runs',
    'raw_import_items',
    'staged_transactions',
    'import_profiles',
    'import_profile_mappings',
    'transaction_splits',
  ]) {
    assert.equal(
      scalar(`SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = '${table}'`),
      1,
    )
  }

  for (const column of [
    'source_connection_id',
    'source_account_id',
    'external_id',
    'source_item_key',
    'import_run_id',
    'raw_item_id',
    'normalizer_version',
    'updated_at',
  ]) {
    assert.ok(transactionColumns.includes(column), `missing transactions.${column}`)
  }

  const transactionSplitColumns = columnNames('transaction_splits')
  for (const column of [
    'id',
    'parent_transaction_id',
    'split_group_id',
    'amount',
    'currency',
    'ledger_account',
    'memo',
    'notes',
    'sort_order',
    'created_from',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(transactionSplitColumns.includes(column), `missing transaction_splits.${column}`)
  }

  const transactionSplitIndexes = indexNames('transaction_splits')
  for (const index of [
    'transaction_splits_parent_idx',
    'transaction_splits_group_idx',
    'transaction_splits_parent_sort_idx',
  ]) {
    assert.ok(transactionSplitIndexes.includes(index), `missing transaction_splits index ${index}`)
  }
  assert.equal(columnDefault('transaction_splits', 'created_from'), `'manual_split'`)

  assert.equal(scalar(`SELECT COUNT(*) AS value FROM sources`), 2)
  assert.equal(scalar(`SELECT COUNT(*) AS value FROM source_connections`), 2)
  assert.equal(scalar(`SELECT COUNT(*) AS value FROM source_accounts`), 2)

  const legacyTxns = sqlite.prepare(`
    SELECT id,
           source_connection_id AS sourceConnectionId,
           source_account_id AS sourceAccountId,
           external_id AS externalId,
           source_item_key AS sourceItemKey,
           normalizer_version AS normalizerVersion,
           import_run_id AS importRunId,
           raw_item_id AS rawItemId,
           amount,
           description
    FROM transactions
    ORDER BY id
  `).all() as Array<{
    id: string
    sourceConnectionId: string | null
    sourceAccountId: string | null
    externalId: string | null
    sourceItemKey: string | null
    normalizerVersion: string | null
    importRunId: string | null
    rawItemId: string | null
    amount: string
    description: string
  }>

  assert.deepEqual(legacyTxns, [
    {
      id: 'csv:legacy-002',
      sourceConnectionId: 'legacy:csv',
      sourceAccountId: 'legacy:csv:acct-legacy-checking',
      externalId: 'csv:legacy-002',
      sourceItemKey: 'acct-legacy-checking:csv:legacy-002',
      normalizerVersion: 'legacy-csv-v1',
      importRunId: null,
      rawItemId: null,
      amount: '-12.00',
      description: 'Legacy CSV Lunch',
    },
    {
      id: 'txn-legacy-001',
      sourceConnectionId: 'legacy:simplefin:legacy-simplefin-conn',
      sourceAccountId: 'legacy:simplefin:legacy-simplefin-conn:acct-legacy-checking',
      externalId: 'txn-legacy-001',
      sourceItemKey: 'acct-legacy-checking:txn-legacy-001',
      normalizerVersion: 'legacy-simplefin-v1',
      importRunId: null,
      rawItemId: null,
      amount: '-4.50',
      description: 'Legacy Coffee',
    },
  ])

  loadDbModule()

  assert.equal(scalar(`SELECT COUNT(*) AS value FROM sources`), 2)
  assert.equal(scalar(`SELECT COUNT(*) AS value FROM source_connections`), 2)
  assert.equal(scalar(`SELECT COUNT(*) AS value FROM source_accounts`), 2)
  assert.equal(
    scalar(`SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'transaction_splits'`),
    1,
  )
})
