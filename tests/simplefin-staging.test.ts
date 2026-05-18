import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fakeSimpleFinAccessUrl } from './helpers/simplefin'
import { readJsonFixture } from './helpers/fixtures'
import type { SimpleFinPayload } from '../lib/ingest/simplefin'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-simplefin-staging-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const {
  buildSimpleFinSourceAccountId,
} = require('../lib/ingest/simplefin') as typeof import('../lib/ingest/simplefin')

interface SimpleFinStagingResult {
  importRunId: string
  accounts: number
  balances: number
  transactions: number
  errors: number
  validationErrors: number
  rawInserted: number
  staged: number
  merged: number
  duplicates: number
}

interface SimpleFinStagingApi {
  stageSimpleFinPayload(
    payload: SimpleFinPayload,
    options: {
      sourceConnectionId: string
      sourceName?: string
      sourceConnectionName?: string
      config?: Record<string, unknown>
    },
  ): SimpleFinStagingResult | Promise<SimpleFinStagingResult>
}

interface CountRow {
  value: number
}

interface StagedRow {
  externalId: string
  sourceItemKey: string
  accountId: string | null
  amount: string
  description: string
  pending: number
  status: string
  validationErrors: string
  normalizerVersion: string
  rawPayload: string
}

interface RawRow {
  externalId: string
  sourceItemKey: string
  rawPayload: string
}

function loadStagingApi(): SimpleFinStagingApi | null {
  try {
    const mod = require('../lib/ingest/simplefin-import') as Partial<SimpleFinStagingApi>
    assert.equal(typeof mod.stageSimpleFinPayload, 'function')
    return mod as SimpleFinStagingApi
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND' &&
      String((error as { message?: unknown }).message).includes('simplefin-import')
    ) {
      return null
    }
    throw error
  }
}

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
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as CountRow
  return row.value
}

function simpleFinPayload(): SimpleFinPayload {
  return readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
}

function seedAccount(id: string, name: string, accountType: 'depository' | 'credit'): void {
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
    1775001600,
    'simplefin-conn-fixture',
    'Example Bank',
    'examplebank.test',
    accountType,
    null,
    null,
    1775001600,
  )
}

function seedMappedSimpleFinSourceAccounts(): void {
  seedAccount('acct-simplefin-checking', 'Mapped Checking', 'depository')
  seedAccount('acct-simplefin-credit', 'Mapped Credit', 'credit')

  const source = store.ensureSource({
    id: 'simplefin',
    kind: 'simplefin',
    name: 'SimpleFIN',
  })
  const connection = store.ensureSourceConnection({
    id: 'simplefin-conn-fixture',
    sourceId: source.id,
    name: 'SimpleFIN Fixture Connection',
  })

  store.ensureSourceAccount({
    id: buildSimpleFinSourceAccountId(connection.id, 'simplefin-checking-001'),
    sourceConnectionId: connection.id,
    fintrackAccountId: 'acct-simplefin-checking',
    externalAccountId: 'simplefin-checking-001',
    name: 'Main Checking',
    currency: 'USD',
  })
  store.ensureSourceAccount({
    id: buildSimpleFinSourceAccountId(connection.id, 'simplefin-credit-001'),
    sourceConnectionId: connection.id,
    fintrackAccountId: 'acct-simplefin-credit',
    externalAccountId: 'simplefin-credit-001',
    name: 'Rewards Card',
    currency: 'USD',
  })
}

async function stageFixture(payload: SimpleFinPayload): Promise<SimpleFinStagingResult | null> {
  const api = loadStagingApi()
  if (!api) return null

  return api.stageSimpleFinPayload(payload, {
    sourceConnectionId: 'simplefin-conn-fixture',
    sourceName: 'SimpleFIN',
    sourceConnectionName: 'SimpleFIN Fixture Connection',
  })
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('stages SimpleFIN payload into raw and staged ingestion tables without canonical transactions', async t => {
  const result = await stageFixture(simpleFinPayload())
  if (!result) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  assert.equal(result.accounts, 2)
  assert.equal(result.balances, 2)
  assert.equal(result.transactions, 7)
  assert.equal(result.errors, 0)
  assert.equal(result.validationErrors, 7)
  assert.equal(result.rawInserted, 7)
  assert.equal(result.staged, 0)
  assert.equal(result.merged, 0)
  assert.equal(result.duplicates, 0)

  assert.equal(countRows('sources'), 1)
  assert.equal(countRows('source_connections'), 1)
  assert.equal(countRows('source_accounts'), 2)
  assert.equal(countRows('import_runs'), 1)
  assert.equal(countRows('raw_import_items'), 7)
  assert.equal(countRows('staged_transactions'), 7)
  assert.equal(countRows('transactions'), 0)

  const run = sqlite.prepare(`
    SELECT status, item_count AS itemCount
    FROM import_runs
    WHERE id = ?
  `).get(result.importRunId) as { status: string; itemCount: number }

  assert.deepEqual(run, { status: 'completed', itemCount: 7 })

  const staged = sqlite.prepare(`
    SELECT
      st.external_id AS externalId,
      st.source_item_key AS sourceItemKey,
      st.account_id AS accountId,
      st.amount,
      st.description,
      st.pending,
      st.status,
      st.validation_errors AS validationErrors,
      st.normalizer_version AS normalizerVersion,
      raw.raw_payload AS rawPayload
    FROM staged_transactions st
    JOIN raw_import_items raw ON raw.id = st.raw_item_id
    ORDER BY st.external_id ASC
  `).all() as StagedRow[]

  assert.equal(staged.length, 7)
  assert.ok(staged.every(row => row.sourceItemKey.startsWith('source-account:')))
  assert.ok(staged.every(row => row.accountId === null))
  assert.ok(staged.every(row => row.normalizerVersion === 'simplefin-v1'))
  assert.ok(staged.every(row => row.status === 'error'))
  assert.ok(staged.every(row => JSON.parse(row.validationErrors).includes('Missing required field: account_id')))
  assert.ok(staged.some(row => row.externalId === 'sf-checking-payroll-001' && row.pending === 0))
  assert.ok(staged.some(row => row.externalId === 'sf-checking-pending-fuel-001' && row.pending === 1))

  const pendingTravel = staged.find(row => row.externalId === 'sf-credit-pending-travel-001')
  assert.ok(pendingTravel)
  assert.equal(pendingTravel.amount, '-96.70')
  assert.equal(pendingTravel.description, 'Pending Travel Hold')
  assert.deepEqual(JSON.parse(pendingTravel.rawPayload).transaction.pending, true)
})

test('skips duplicate SimpleFIN rows by source item key within an import run', async t => {
  const payload = simpleFinPayload()
  const checking = payload.accounts?.find(account => account.id === 'simplefin-checking-001')
  assert.ok(checking?.transactions)
  checking.transactions.push({ ...checking.transactions[0] })

  const result = await stageFixture(payload)
  if (!result) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  assert.equal(result.transactions, 8)
  assert.equal(result.errors, 0)
  assert.equal(result.validationErrors, 7)
  assert.equal(result.rawInserted, 7)
  assert.equal(result.staged, 0)
  assert.equal(result.merged, 0)
  assert.equal(result.duplicates, 1)
  assert.equal(countRows('raw_import_items'), 7)
  assert.equal(countRows('staged_transactions'), 7)
  assert.equal(countRows('transactions'), 0)

  const duplicateKeyRows = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM raw_import_items
    WHERE external_id = ?
  `).get('sf-checking-payroll-001') as CountRow

  assert.equal(duplicateKeyRows.value, 1)
})

test('reports missing SimpleFIN provider transaction id without staging a normalized transaction', async t => {
  const payload: SimpleFinPayload = {
    accounts: [
      {
        id: 'simplefin-checking-001',
        name: 'Main Checking',
        currency: 'USD',
        balance: '2048.25',
        'balance-date': 1775001600,
        org: {
          domain: 'examplebank.test',
          name: 'Example Bank',
        },
        transactions: [
          {
            posted: 0,
            'transacted-at': 1774396800,
            amount: '-42.10',
            description: 'Pending Fuel Stop',
            pending: true,
          },
        ],
      },
    ],
  }

  const result = await stageFixture(payload)
  if (!result) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  assert.equal(result.transactions, 0)
  assert.equal(result.errors, 1)
  assert.equal(result.validationErrors, 2)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 0)
  assert.equal(result.merged, 0)
  assert.equal(countRows('raw_import_items'), 1)
  assert.equal(countRows('staged_transactions'), 1)
  assert.equal(countRows('transactions'), 0)

  const invalidStagedRow = sqlite.prepare(`
    SELECT status, source_item_key AS sourceItemKey, validation_errors AS validationErrors
    FROM staged_transactions
    WHERE external_id IS NULL
       OR source_item_key IS NULL
    LIMIT 1
  `).get() as { status: string; sourceItemKey: string | null; validationErrors: string }

  assert.equal(invalidStagedRow.status, 'error')
  assert.equal(invalidStagedRow.sourceItemKey, null)
  assert.deepEqual(
    JSON.parse(invalidStagedRow.validationErrors),
    ['Missing required field: source_item_key', 'Missing required field: external_id'],
  )
})

test('keeps posted and pending SimpleFIN fixture rows distinct in raw and staged tables', async t => {
  const result = await stageFixture(simpleFinPayload())
  if (!result) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  const rawRows = sqlite.prepare(`
    SELECT external_id AS externalId, source_item_key AS sourceItemKey, raw_payload AS rawPayload
    FROM raw_import_items
    ORDER BY external_id ASC
  `).all() as RawRow[]
  const stagedRows = sqlite.prepare(`
    SELECT external_id AS externalId, source_item_key AS sourceItemKey, pending, status
    FROM staged_transactions
    ORDER BY external_id ASC
  `).all() as Array<Pick<StagedRow, 'externalId' | 'sourceItemKey' | 'pending' | 'status'>>

  assert.equal(rawRows.length, 7)
  assert.equal(stagedRows.length, 7)
  assert.deepEqual(
    stagedRows.map(row => row.sourceItemKey).sort(),
    rawRows.map(row => row.sourceItemKey).sort(),
  )
  assert.ok(rawRows.some(row => JSON.parse(row.rawPayload).transaction.pending === false))
  assert.ok(rawRows.some(row => JSON.parse(row.rawPayload).transaction.pending === true))
  assert.ok(stagedRows.some(row => row.pending === 0 && row.status === 'error'))
  assert.ok(stagedRows.some(row => row.pending === 1 && row.status === 'error'))
})

test('uses existing source account mappings when staging SimpleFIN payloads', async t => {
  seedMappedSimpleFinSourceAccounts()

  const result = await stageFixture(simpleFinPayload())
  if (!result) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  assert.equal(result.transactions, 7)
  assert.equal(result.errors, 0)
  assert.equal(result.validationErrors, 0)
  assert.equal(result.rawInserted, 7)
  assert.equal(result.staged, 7)
  assert.equal(result.merged, 0)
  assert.equal(result.duplicates, 0)

  const rows = sqlite.prepare(`
    SELECT account_id AS accountId, status, validation_errors AS validationErrors
    FROM staged_transactions
    ORDER BY external_id ASC
  `).all() as Array<{
    accountId: string
    status: string
    validationErrors: string
  }>

  assert.equal(rows.length, 7)
  assert.ok(rows.every(row => row.accountId === 'acct-simplefin-checking' || row.accountId === 'acct-simplefin-credit'))
  assert.ok(rows.every(row => row.status === 'staged'))
  assert.ok(rows.every(row => JSON.parse(row.validationErrors).length === 0))
})

test('redacts SimpleFIN connection config secrets before persisting staging metadata', async t => {
  const api = loadStagingApi()
  if (!api) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  api.stageSimpleFinPayload(simpleFinPayload(), {
    sourceConnectionId: 'simplefin-conn-fixture',
    sourceName: 'SimpleFIN',
    sourceConnectionName: 'SimpleFIN Fixture Connection',
    config: {
      mode: 'shadow',
      accessUrl: fakeSimpleFinAccessUrl(),
      nested: {
        authorization: 'Basic secret',
        token: 'secret-token',
      },
    },
  })

  const row = sqlite.prepare(`
    SELECT config
    FROM source_connections
    WHERE id = ?
  `).get('simplefin-conn-fixture') as { config: string }
  const config = JSON.parse(row.config)

  assert.equal(config.mode, 'shadow')
  assert.equal(config.accessUrl, '[redacted]')
  assert.equal(config.nested.authorization, '[redacted]')
  assert.equal(config.nested.token, '[redacted]')
  assert.doesNotMatch(row.config, /fixture-user|fixture-pass|secret-token/)
})

test('marks existing legacy SimpleFIN transactions merged instead of leaving duplicate rows promotable', async t => {
  seedAccount('simplefin-checking-001', 'Main Checking', 'depository')
  seedAccount('simplefin-credit-001', 'Rewards Card', 'credit')
  const legacySource = store.ensureSource({
    id: 'simplefin',
    kind: 'simplefin',
    name: 'SimpleFIN',
  })
  const legacyConnection = store.ensureSourceConnection({
    id: 'legacy:simplefin:simplefin.example.test',
    sourceId: legacySource.id,
    name: 'simplefin.example.test',
  })
  store.ensureSourceAccount({
    id: 'legacy:simplefin:simplefin.example.test:simplefin-checking-001',
    sourceConnectionId: legacyConnection.id,
    fintrackAccountId: 'simplefin-checking-001',
    externalAccountId: 'simplefin-checking-001',
    name: 'Main Checking',
    currency: 'USD',
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
    'sf-checking-payroll-001',
    'simplefin-checking-001',
    'legacy:simplefin:simplefin.example.test',
    'legacy:simplefin:simplefin.example.test:simplefin-checking-001',
    'sf-checking-payroll-001',
    'simplefin-checking-001:sf-checking-payroll-001',
    null,
    null,
    'legacy-simplefin-v1',
    'simplefin',
    1774224000,
    1774224000,
    '1500.00',
    'Payroll Deposit',
    0,
    'posted',
    null,
    null,
    null,
    JSON.stringify([]),
    1774224000,
    1774224000,
  )

  const result = await stageFixture(simpleFinPayload())
  if (!result) {
    t.skip('blocked until ../lib/ingest/simplefin-import exports stageSimpleFinPayload')
    return
  }

  assert.equal(result.transactions, 7)
  assert.equal(result.errors, 0)
  assert.equal(result.validationErrors, 0)
  assert.equal(result.rawInserted, 7)
  assert.equal(result.staged, 6)
  assert.equal(result.merged, 1)
  assert.equal(countRows('transactions'), 1)

  const merged = sqlite.prepare(`
    SELECT status, transaction_id AS transactionId, account_id AS accountId
    FROM staged_transactions
    WHERE external_id = ?
  `).get('sf-checking-payroll-001') as {
    status: string
    transactionId: string
    accountId: string
  }

  assert.equal(merged.status, 'merged')
  assert.equal(merged.transactionId, 'sf-checking-payroll-001')
  assert.equal(merged.accountId, 'simplefin-checking-001')
})
