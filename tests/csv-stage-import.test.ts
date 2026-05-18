import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFixture } from './helpers/fixtures'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-csv-stage-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { runBalanceAssertionPreflight } = require('../lib/export/balance-assertions') as typeof import('../lib/export/balance-assertions')
const { updateSourceAccountMapping } = require('../lib/ingest/account-mapping') as typeof import('../lib/ingest/account-mapping')
const { stageTransactionsCsv } = require('../lib/ingest/csv-import') as typeof import('../lib/ingest/csv-import')
const { updateInvestmentPositionStatus } = require('../lib/ingest/investments') as typeof import('../lib/ingest/investments')
const { updateSecurityMapping } = require('../lib/ingest/security-mapping') as typeof import('../lib/ingest/security-mapping')

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM investment_positions;
    DELETE FROM investment_activities;
    DELETE FROM securities;
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

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-checking',
    'Main Checking',
    'USD',
    '0.00',
    1775001600,
    'test-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    'Assets:US:Banks:MainChecking',
    1775001600,
  )
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
}

function insertInvestmentAccount(): string {
  const id = 'acct-fidelity-brokerage'
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Fidelity Brokerage',
    'USD',
    '0.00',
    1775001600,
    'test-fixtures',
    'Fidelity',
    'fidelity.test',
    'investment',
    null,
    'Assets:US:Fidelity:Brokerage',
    1775001600,
  )
  return id
}

function writeLedger(): void {
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "CSV Position Export Test"',
      '2026-01-01 open Assets:US:Fidelity:Brokerage USD',
      '',
    ].join('\n'),
  )
}

beforeEach(() => {
  resetDb()
  writeLedger()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('stages a generic CSV into raw and staged ingestion tables without writing canonical transactions', () => {
  const result = stageTransactionsCsv(readFixture('csv', 'generic-bank.csv'), {})

  assert.equal(result.totalRows, 3)
  assert.equal(result.rawInserted, 3)
  assert.equal(result.staged, 3)
  assert.equal(result.duplicates, 0)
  assert.deepEqual(result.errors, [])

  assert.equal(countRows('sources'), 1)
  assert.equal(countRows('source_connections'), 1)
  assert.equal(countRows('source_accounts'), 1)
  assert.equal(countRows('import_runs'), 1)
  assert.equal(countRows('raw_import_items'), 3)
  assert.equal(countRows('staged_transactions'), 3)
  assert.equal(countRows('transactions'), 0)

  const run = sqlite.prepare(`
    SELECT status, item_count AS itemCount
    FROM import_runs
    WHERE id = ?
  `).get(result.importRunId) as { status: string; itemCount: number }
  assert.deepEqual(run, { status: 'completed', itemCount: 3 })

  const first = sqlite.prepare(`
    SELECT amount, category, notes, tags, status, source_account_id AS sourceAccountId
    FROM staged_transactions
    ORDER BY posted ASC, id ASC
    LIMIT 1
  `).get() as {
    amount: string
    category: string | null
    notes: string | null
    tags: string
    status: string
    sourceAccountId: string
  }

  assert.equal(first.amount, '-4.75')
  assert.equal(first.category, 'Expenses:Food:Coffee')
  assert.equal(first.notes, 'Morning coffee')
  assert.deepEqual(JSON.parse(first.tags), ['coffee', 'work'])
  assert.equal(first.status, 'staged')
  assert.ok(first.sourceAccountId)
})

test('skips duplicate CSV rows by source item key within an import run', () => {
  const result = stageTransactionsCsv(readFixture('csv', 'duplicate-import.csv'), {})

  assert.equal(result.totalRows, 2)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 1)
  assert.equal(result.duplicates, 1)
  assert.deepEqual(result.errors, [])
  assert.equal(countRows('raw_import_items'), 1)
  assert.equal(countRows('staged_transactions'), 1)
  assert.equal(countRows('transactions'), 0)
})

test('keeps no-external-id fallback keys stable across editable CSV fields', () => {
  const csv = [
    'Date,Description,Amount,Account,Category,Notes,Tags,Status',
    '2026-05-01,Coffee Shop,-3.50,Main Checking,Expenses:Food:Coffee,Morning,coffee,posted',
    '2026-05-01,Coffee Shop,-3.50,Main Checking,Expenses:Reviewed,Edited,reviewed;tax,posted',
  ].join('\n')
  const result = stageTransactionsCsv(csv, {})

  assert.equal(result.totalRows, 2)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 1)
  assert.equal(result.duplicates, 1)
  assert.deepEqual(result.errors, [])
  assert.equal(countRows('raw_import_items'), 1)
  assert.equal(countRows('staged_transactions'), 1)
  assert.equal(countRows('transactions'), 0)
})

test('archives invalid rows and stages them with validation errors', () => {
  const csv = [
    'Date,Description,Amount,Account,Category,Status',
    '2026-05-01,Coffee Shop,-3.50,Unknown Account,Expenses:Food:Coffee,posted',
  ].join('\n')
  const result = stageTransactionsCsv(csv, {})

  assert.equal(result.totalRows, 1)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 0)
  assert.equal(result.duplicates, 0)
  assert.deepEqual(result.errors, [{ rowNumber: 2, error: 'Unable to match account' }])
  assert.equal(countRows('raw_import_items'), 1)
  assert.equal(countRows('staged_transactions'), 1)
  assert.equal(countRows('transactions'), 0)

  const staged = sqlite.prepare(`
    SELECT status,
           validation_errors AS validationErrors,
           source_account_id AS sourceAccountId,
           source_item_key AS sourceItemKey,
           normalized_payload AS normalizedPayload
    FROM staged_transactions
    LIMIT 1
  `).get() as {
    status: string
    validationErrors: string
    sourceAccountId: string
    sourceItemKey: string
    normalizedPayload: string
  }
  const raw = sqlite.prepare(`
    SELECT source_account_id AS sourceAccountId,
           source_item_key AS sourceItemKey
    FROM raw_import_items
    LIMIT 1
  `).get() as {
    sourceAccountId: string
    sourceItemKey: string
  }
  const sourceAccount = sqlite.prepare(`
    SELECT external_account_id AS externalAccountId,
           name,
           fintrack_account_id AS fintrackAccountId
    FROM source_accounts
    WHERE id = ?
  `).get(staged.sourceAccountId) as {
    externalAccountId: string
    name: string
    fintrackAccountId: string | null
  }
  const normalizedPayload = JSON.parse(staged.normalizedPayload) as {
    sourceAccountId: string
    sourceItemKey: string
  }

  assert.equal(staged.status, 'error')
  assert.deepEqual(JSON.parse(staged.validationErrors), ['Unable to match account'])
  assert.ok(staged.sourceAccountId)
  assert.equal(staged.sourceAccountId, raw.sourceAccountId)
  assert.equal(staged.sourceItemKey, raw.sourceItemKey)
  assert.ok(staged.sourceItemKey.startsWith(`source-account:${encodeURIComponent(staged.sourceAccountId)}:hash:`))
  assert.equal(sourceAccount.externalAccountId, 'Unknown Account')
  assert.equal(sourceAccount.name, 'Unknown Account')
  assert.equal(sourceAccount.fintrackAccountId, null)
  assert.equal(normalizedPayload.sourceAccountId, staged.sourceAccountId)
  assert.equal(normalizedPayload.sourceItemKey, staged.sourceItemKey)
})

test('uses an existing CSV source-account mapping when staging a later import', () => {
  const csv = [
    'Date,Description,Amount,Account,Category,Status',
    '2026-05-01,Coffee Shop,-3.50,Unknown Account,Expenses:Food:Coffee,posted',
  ].join('\n')
  const firstImport = stageTransactionsCsv(csv, {})
  const firstStaged = sqlite.prepare(`
    SELECT source_account_id AS sourceAccountId,
           source_item_key AS sourceItemKey
    FROM staged_transactions
    WHERE import_run_id = ?
    LIMIT 1
  `).get(firstImport.importRunId) as {
    sourceAccountId: string
    sourceItemKey: string
  }

  sqlite.prepare(`
    UPDATE source_accounts
    SET fintrack_account_id = ?
    WHERE id = ?
  `).run('acct-checking', firstStaged.sourceAccountId)

  const secondImport = stageTransactionsCsv(csv, {})

  assert.equal(secondImport.totalRows, 1)
  assert.equal(secondImport.rawInserted, 1)
  assert.equal(secondImport.staged, 1)
  assert.deepEqual(secondImport.errors, [])

  const secondStaged = sqlite.prepare(`
    SELECT account_id AS accountId,
           source_account_id AS sourceAccountId,
           source_item_key AS sourceItemKey,
           status,
           validation_errors AS validationErrors
    FROM staged_transactions
    WHERE import_run_id = ?
    LIMIT 1
  `).get(secondImport.importRunId) as {
    accountId: string
    sourceAccountId: string
    sourceItemKey: string
    status: string
    validationErrors: string
  }

  assert.equal(secondStaged.accountId, 'acct-checking')
  assert.equal(secondStaged.sourceAccountId, firstStaged.sourceAccountId)
  assert.equal(secondStaged.sourceItemKey, firstStaged.sourceItemKey)
  assert.equal(secondStaged.status, 'staged')
  assert.deepEqual(JSON.parse(secondStaged.validationErrors), [])
})

test('uses the default account when the CSV has no account column', () => {
  const csv = [
    'Date,Description,Amount,Category,Status,External ID',
    '2026-05-01,Coffee Shop,-3.50,Expenses:Food:Coffee,posted,no-account-001',
  ].join('\n')
  const result = stageTransactionsCsv(csv, {}, 'acct-checking')

  assert.equal(result.totalRows, 1)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 1)
  assert.equal(result.duplicates, 0)
  assert.deepEqual(result.errors, [])
  assert.equal(countRows('transactions'), 0)

  const staged = sqlite.prepare(`
    SELECT account_id AS accountId,
           source_account_id AS sourceAccountId,
           source_item_key AS sourceItemKey,
           status
    FROM staged_transactions
    LIMIT 1
  `).get() as {
    accountId: string
    sourceAccountId: string
    sourceItemKey: string
    status: string
  }

  assert.equal(staged.accountId, 'acct-checking')
  assert.ok(staged.sourceAccountId)
  assert.equal(staged.sourceItemKey, `source-account:${encodeURIComponent(staged.sourceAccountId)}:external:no-account-001`)
  assert.equal(staged.status, 'staged')
})

test('archives Fidelity brokerage CSV rows and blocks cash promotion until investment review/export exists', () => {
  const accountId = insertInvestmentAccount()
  const result = stageTransactionsCsv(
    readFixture('csv', 'fidelity-brokerage.csv'),
    {},
    accountId,
    'Fidelity Brokerage',
    null,
    undefined,
    'fidelity-brokerage-csv',
  )

  assert.equal(result.parserProfileId, 'fidelity-brokerage-csv')
  assert.equal(result.parserProfileName, 'Fidelity Brokerage CSV')
  assert.equal(result.totalRows, 5)
  assert.equal(result.rawInserted, 5)
  assert.equal(result.staged, 0)
  assert.equal(result.duplicates, 0)
  assert.equal(result.errors.length, 5)
  assert.equal(countRows('raw_import_items'), 5)
  assert.equal(countRows('staged_transactions'), 5)
  assert.equal(countRows('investment_activities'), 5)
  assert.equal(countRows('securities'), 1)
  assert.equal(countRows('transactions'), 0)

  const run = sqlite.prepare(`
    SELECT status, item_count AS itemCount, error
    FROM import_runs
    WHERE id = ?
  `).get(result.importRunId) as { status: string; itemCount: number; error: string }
  assert.equal(run.status, 'completed')
  assert.equal(run.itemCount, 5)
  assert.match(run.error, /row validation error/)

  const staged = sqlite.prepare(`
    SELECT account_id AS accountId,
           status,
           validation_errors AS validationErrors,
           normalizer_version AS normalizerVersion,
           normalized_payload AS normalizedPayload
    FROM staged_transactions
    ORDER BY posted ASC, id ASC
    LIMIT 1
  `).get() as {
    accountId: string
    status: string
    validationErrors: string
    normalizerVersion: string
    normalizedPayload: string
  }

  assert.equal(staged.accountId, accountId)
  assert.equal(staged.status, 'error')
  assert.equal(staged.normalizerVersion, 'fidelity-brokerage-csv-v1')
  assert.deepEqual(JSON.parse(staged.validationErrors), [
    'Investment activity review/export is required before this parser profile can be promoted',
  ])

  const normalizedPayload = JSON.parse(staged.normalizedPayload) as {
    parserProfileId: string
    investmentActivity: { activityType: string; action: string }
  }
  assert.equal(normalizedPayload.parserProfileId, 'fidelity-brokerage-csv')
  assert.equal(normalizedPayload.investmentActivity.activityType, 'cash_transfer')
  assert.equal(normalizedPayload.investmentActivity.action, 'DIRECT DEPOSIT (PAYROLL)')

  const raw = sqlite.prepare(`
    SELECT status, raw_payload AS rawPayload
    FROM raw_import_items
    ORDER BY rowid ASC
    LIMIT 1
  `).get() as { status: string; rawPayload: string }
  assert.equal(raw.status, 'error')
  assert.equal(JSON.parse(raw.rawPayload).row.Action, 'DIRECT DEPOSIT (PAYROLL)')

  const connection = sqlite.prepare(`
    SELECT config
    FROM source_connections
    WHERE id = 'csv:fidelity-brokerage'
  `).get() as { config: string }
  assert.equal(JSON.parse(connection.config).parserProfileId, 'fidelity-brokerage-csv')
})

test('mapping a Fidelity source account keeps investment rows blocked but clears account validation', () => {
  const accountId = insertInvestmentAccount()
  const csv = [
    'Run Date,Account,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date',
    '05/15/2026,Individual,"YOU BOUGHT FICTCORP COM (FCT)",FCT,FICTCORP COM,Margin,40.00,1,0.65,,,-40.65,05/16/2026',
  ].join('\n')
  const result = stageTransactionsCsv(csv, {}, undefined, 'Fidelity Brokerage')

  assert.equal(result.parserProfileId, 'fidelity-brokerage-csv')
  assert.equal(result.totalRows, 1)
  assert.equal(result.rawInserted, 1)
  assert.equal(result.staged, 0)
  assert.deepEqual(result.errors.map(error => error.error), [
    'Unable to match account',
    'Investment activity review/export is required before this parser profile can be promoted',
  ])

  const sourceAccount = sqlite.prepare(`
    SELECT id
    FROM source_accounts
    LIMIT 1
  `).get() as { id: string }

  updateSourceAccountMapping({
    importRunId: result.importRunId,
    sourceAccountId: sourceAccount.id,
    accountId,
  })

  const staged = sqlite.prepare(`
    SELECT account_id AS accountId,
           currency,
           status,
           validation_errors AS validationErrors
    FROM staged_transactions
    LIMIT 1
  `).get() as {
    accountId: string
    currency: string
    status: string
    validationErrors: string
  }
  assert.equal(staged.accountId, accountId)
  assert.equal(staged.currency, 'USD')
  assert.equal(staged.status, 'error')
  assert.deepEqual(JSON.parse(staged.validationErrors), [
    'Investment activity review/export is required before this parser profile can be promoted',
  ])

  const activity = sqlite.prepare(`
    SELECT account_id AS accountId,
           currency,
           status,
           validation_errors AS validationErrors
    FROM investment_activities
    LIMIT 1
  `).get() as {
    accountId: string
    currency: string
    status: string
    validationErrors: string
  }
  assert.equal(activity.accountId, accountId)
  assert.equal(activity.currency, 'USD')
  assert.equal(activity.status, 'blocked')
  assert.deepEqual(JSON.parse(activity.validationErrors), [])
})

test('stages Fidelity option activities with security and position effect metadata', () => {
  const accountId = insertInvestmentAccount()
  const csv = [
    'Run Date,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Cash Balance ($),Settlement Date',
    '04/20/2025,"YOU BOUGHT OPENING TRANSACTION CALL (FCT) FICTCORP 250620 C $50 (MARGIN)",-FCT250620C50,FICTCORP CALL,Margin,1.25,1,0.65,,,-125.65,5000.00,04/21/2025',
    '04/21/2025,"YOU SOLD CLOSING TRANSACTION PUT (FCT) FICTCORP 250620 P $45 (MARGIN)",-FCT250620P45,FICTCORP PUT,Margin,2.10,1,0.65,,,209.35,5209.35,04/22/2025',
  ].join('\n')

  const result = stageTransactionsCsv(
    csv,
    {},
    accountId,
    'Fidelity Options',
    null,
    undefined,
    'fidelity-brokerage-csv',
  )

  assert.equal(result.totalRows, 2)
  assert.equal(result.staged, 0)
  assert.equal(countRows('investment_activities'), 2)
  assert.equal(countRows('securities'), 2)

  const rows = sqlite.prepare(`
    SELECT ia.activity_type AS activityType,
           ia.instrument_type AS instrumentType,
           ia.position_effect AS positionEffect,
           ia.option_type AS optionType,
           ia.quantity,
           ia.price,
           ia.amount,
           ia.status,
           s.underlying_symbol AS underlyingSymbol,
           s.contract_symbol AS contractSymbol,
           s.expiration_date AS expirationDate,
           s.strike_price AS strikePrice
    FROM investment_activities ia
    JOIN securities s ON s.id = ia.security_id
    ORDER BY ia.trade_date ASC, ia.activity_type ASC
  `).all() as Array<{
    activityType: string
    instrumentType: string
    positionEffect: string
    optionType: string
    quantity: string
    price: string
    amount: string
    status: string
    underlyingSymbol: string
    contractSymbol: string
    expirationDate: string
    strikePrice: string
  }>

  assert.equal(rows[0].activityType, 'buy')
  assert.equal(rows[0].instrumentType, 'option')
  assert.equal(rows[0].positionEffect, 'open')
  assert.equal(rows[0].optionType, 'call')
  assert.equal(rows[0].quantity, '1')
  assert.equal(rows[0].price, '1.25')
  assert.equal(rows[0].amount, '-125.65')
  assert.equal(rows[0].status, 'blocked')
  assert.equal(rows[0].underlyingSymbol, 'FCT')
  assert.equal(rows[0].contractSymbol, '-FCT250620C50')
  assert.equal(rows[0].expirationDate, '2025-06-20')
  assert.equal(rows[0].strikePrice, '50')

  assert.equal(rows[1].activityType, 'sell')
  assert.equal(rows[1].instrumentType, 'option')
  assert.equal(rows[1].positionEffect, 'close')
  assert.equal(rows[1].optionType, 'put')
  assert.equal(rows[1].strikePrice, '45')
})

test('stages Fidelity position snapshots with source item provenance', () => {
  const accountId = insertInvestmentAccount()
  const result = stageTransactionsCsv(
    readFixture('csv', 'fidelity-positions.csv'),
    {},
    accountId,
    'Fidelity Positions',
    null,
    undefined,
    'fidelity-positions-csv',
  )

  assert.equal(result.parserProfileId, 'fidelity-positions-csv')
  assert.equal(result.parserProfileName, 'Fidelity Positions CSV')
  assert.equal(result.totalRows, 2)
  assert.equal(result.rawInserted, 2)
  assert.equal(result.staged, 0)
  assert.equal(result.duplicates, 0)
  assert.equal(result.errors.length, 2)
  assert.equal(countRows('raw_import_items'), 2)
  assert.equal(countRows('staged_transactions'), 2)
  assert.equal(countRows('investment_positions'), 2)
  assert.equal(countRows('investment_activities'), 0)
  assert.equal(countRows('securities'), 2)
  assert.equal(countRows('transactions'), 0)

  const rows = sqlite.prepare(`
    SELECT p.import_run_id AS importRunId,
           p.raw_item_id AS rawItemId,
           p.source_connection_id AS sourceConnectionId,
           p.source_account_id AS sourceAccountId,
           p.account_id AS accountId,
           p.external_id AS externalId,
           p.source_item_key AS sourceItemKey,
           p.as_of_date AS asOfDate,
           p.quantity,
           p.market_value AS marketValue,
           p.price,
           p.currency,
           p.status,
           p.validation_errors AS validationErrors,
           p.normalizer_version AS normalizerVersion,
           p.raw_payload AS rawPayload,
           s.source_symbol AS sourceSymbol,
           s.name AS securityName,
           s.instrument_type AS instrumentType
    FROM investment_positions p
    JOIN securities s ON s.id = p.security_id
    ORDER BY p.as_of_date ASC, s.source_symbol ASC
  `).all() as Array<{
    importRunId: string
    rawItemId: string
    sourceConnectionId: string
    sourceAccountId: string
    accountId: string
    externalId: string
    sourceItemKey: string
    asOfDate: string
    quantity: string
    marketValue: string
    price: string
    currency: string
    status: string
    validationErrors: string
    normalizerVersion: string
    rawPayload: string
    sourceSymbol: string
    securityName: string
    instrumentType: string
  }>

  assert.equal(rows[0].importRunId, result.importRunId)
  assert.equal(rows[0].rawItemId.length > 0, true)
  assert.equal(rows[0].sourceConnectionId, 'csv:fidelity-positions')
  assert.equal(rows[0].accountId, accountId)
  assert.equal(rows[0].externalId, 'fake-position-fct-20260430')
  assert.equal(
    rows[0].sourceItemKey,
    `source-account:${encodeURIComponent(rows[0].sourceAccountId)}:position-external:fake-position-fct-20260430`,
  )
  assert.equal(rows[0].asOfDate, '2026-04-30')
  assert.equal(rows[0].quantity, '12.3456')
  assert.equal(rows[0].marketValue, '493.824')
  assert.equal(rows[0].price, '40.00')
  assert.equal(rows[0].currency, 'USD')
  assert.equal(rows[0].status, 'needs_review')
  assert.deepEqual(JSON.parse(rows[0].validationErrors), [])
  assert.equal(rows[0].normalizerVersion, 'fidelity-positions-csv-v1')
  assert.equal(JSON.parse(rows[0].rawPayload).symbol, 'FCT')
  assert.equal(rows[0].sourceSymbol, 'FCT')
  assert.equal(rows[0].securityName, 'Fictitious Corp')
  assert.equal(rows[0].instrumentType, 'equity')

  assert.equal(rows[1].sourceSymbol, 'FMFXX')
  assert.equal(rows[1].instrumentType, 'fund')
})

test('reviewed Fidelity position snapshots reach balance assertion preflight', () => {
  const accountId = insertInvestmentAccount()
  const result = stageTransactionsCsv(
    readFixture('csv', 'fidelity-positions.csv'),
    {},
    accountId,
    'Fidelity Positions',
    null,
    undefined,
    'fidelity-positions-csv',
  )

  const positions = sqlite.prepare(`
    SELECT p.id,
           p.source_connection_id AS sourceConnectionId,
           p.source_account_id AS sourceAccountId,
           p.source_item_key AS sourceItemKey,
           s.id AS securityId,
           s.source_symbol AS sourceSymbol
    FROM investment_positions p
    JOIN securities s ON s.id = p.security_id
    ORDER BY s.source_symbol ASC
  `).all() as Array<{
    id: string
    sourceConnectionId: string
    sourceAccountId: string
    sourceItemKey: string
    securityId: string
    sourceSymbol: string
  }>

  for (const position of positions) {
    updateSecurityMapping({
      importRunId: result.importRunId,
      securityId: position.securityId,
      beancountCommodity: position.sourceSymbol,
      actor: 'test',
      reason: 'position export e2e',
    })
    updateInvestmentPositionStatus({
      importRunId: result.importRunId,
      investmentPositionId: position.id,
      status: 'reviewed',
      audit: {
        actor: 'test',
        reason: 'position export e2e',
      },
    })
  }

  const preflight = runBalanceAssertionPreflight({ period: '2026-04', beancountRoot })

  assert.equal(preflight.ok, true)
  assert.equal(preflight.summary.positionAssertionsScanned, 2)
  assert.equal(preflight.summary.exportablePositionAssertions, 2)
  assert.equal(preflight.exportableCandidates.length, 2)
  const expectedSourceIdByCurrency = new Map(positions.map(position => [
    position.sourceSymbol,
    [
      'fintrack',
      'position-source',
      encodeURIComponent(position.sourceConnectionId),
      encodeURIComponent(position.sourceAccountId),
      encodeURIComponent(position.sourceItemKey),
    ].join(':'),
  ]))
  assert.deepEqual(
    preflight.exportableCandidates
      .map(candidate => ({
        account: candidate.account,
        amount: candidate.amount,
        currency: candidate.currency,
        sourceId: candidate.sourceId,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    [
      {
        account: 'Assets:US:Fidelity:Brokerage',
        amount: '12.3456',
        currency: 'FCT',
        sourceId: expectedSourceIdByCurrency.get('FCT'),
      },
      {
        account: 'Assets:US:Fidelity:Brokerage',
        amount: '100.0000',
        currency: 'FMFXX',
        sourceId: expectedSourceIdByCurrency.get('FMFXX'),
      },
    ],
  )
})
