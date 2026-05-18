import assert from 'node:assert/strict'
import { after, beforeEach, describe, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-import-runs-api-'))
const beancountRoot = path.join(tempDir, 'beancount')
const originalBeancountRoot = process.env.BEANCOUNT_ROOT
const originalBeancountValidation = process.env.FINTRACK_BEANCOUNT_VALIDATION
const originalBeancountValidator = process.env.FINTRACK_BEANCOUNT_VALIDATOR
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const store = require('../lib/ingest/store') as typeof import('../lib/ingest/store')
const listRoute = require('../app/api/import/runs/route') as typeof import('../app/api/import/runs/route')
const runRoute = require('../app/api/import/runs/[id]/route') as typeof import('../app/api/import/runs/[id]/route')
const stagedRoute = require('../app/api/import/runs/[id]/staged/route') as typeof import('../app/api/import/runs/[id]/staged/route')
const investmentActivitiesRoute = require('../app/api/import/runs/[id]/investment-activities/route') as typeof import('../app/api/import/runs/[id]/investment-activities/route')
const investmentActivityRoute = require('../app/api/import/runs/[id]/investment-activities/[activityId]/route') as typeof import('../app/api/import/runs/[id]/investment-activities/[activityId]/route')
const investmentPositionsRoute = require('../app/api/import/runs/[id]/investment-positions/route') as typeof import('../app/api/import/runs/[id]/investment-positions/route')
const investmentPositionRoute = require('../app/api/import/runs/[id]/investment-positions/[positionId]/route') as typeof import('../app/api/import/runs/[id]/investment-positions/[positionId]/route')
const securitiesRoute = require('../app/api/import/runs/[id]/securities/route') as typeof import('../app/api/import/runs/[id]/securities/route')
const securityRoute = require('../app/api/import/runs/[id]/securities/[securityId]/route') as typeof import('../app/api/import/runs/[id]/securities/[securityId]/route')
const promoteValidateRoute = require('../app/api/import/runs/[id]/promote/validate/route') as PromoteRoute

interface RouteContext {
  params: Promise<{ id: string }>
}

interface InvestmentActivityRouteContext {
  params: Promise<{ id: string; activityId: string }>
}

interface InvestmentPositionRouteContext {
  params: Promise<{ id: string; positionId: string }>
}

interface SecurityRouteContext {
  params: Promise<{ id: string; securityId: string }>
}

interface PromoteRoute {
  POST(req: NextRequest, context: RouteContext): Promise<Response>
}

interface ReplayRoute {
  POST(req: NextRequest, context: RouteContext): Promise<Response>
}

function request(pathname: string, init?: RequestInit): NextRequest {
  return new Request(`http://localhost${pathname}`, init) as NextRequest
}

function params(id: string): RouteContext {
  return { params: Promise.resolve({ id }) }
}

function investmentActivityParams(id: string, activityId: string): InvestmentActivityRouteContext {
  return { params: Promise.resolve({ id, activityId }) }
}

function investmentPositionParams(id: string, positionId: string): InvestmentPositionRouteContext {
  return { params: Promise.resolve({ id, positionId }) }
}

function securityParams(id: string, securityId: string): SecurityRouteContext {
  return { params: Promise.resolve({ id, securityId }) }
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM audit_log;
    DELETE FROM export_runs;
    DELETE FROM balance_assertions;
    DELETE FROM investment_positions;
    DELETE FROM investment_activities;
    DELETE FROM securities;
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

function resetBeancountEnv(): void {
  if (originalBeancountRoot === undefined) delete process.env.BEANCOUNT_ROOT
  else process.env.BEANCOUNT_ROOT = originalBeancountRoot
  if (originalBeancountValidation === undefined) delete process.env.FINTRACK_BEANCOUNT_VALIDATION
  else process.env.FINTRACK_BEANCOUNT_VALIDATION = originalBeancountValidation
  if (originalBeancountValidator === undefined) delete process.env.FINTRACK_BEANCOUNT_VALIDATOR
  else process.env.FINTRACK_BEANCOUNT_VALIDATOR = originalBeancountValidator
}

function writePromotionLedger(openAccounts: string[] = [
  'Assets:US:Banks:APIChecking',
  'Expenses:Food',
  'Expenses:Food:Coffee',
  'Expenses:Food:Groceries',
]): void {
  fs.rmSync(beancountRoot, { recursive: true, force: true })
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Import Runs API Test"',
      ...openAccounts.map(account => `2026-01-01 open ${account} USD`),
      '',
    ].join('\n'),
  )
  process.env.BEANCOUNT_ROOT = beancountRoot
}

function writePassingValidator(): string {
  const validator = path.join(tempDir, `passing-validator-${Date.now()}`)
  fs.writeFileSync(
    validator,
    [
      '#!/usr/bin/env node',
      'process.exit(0)',
      '',
    ].join('\n'),
  )
  fs.chmodSync(validator, 0o755)
  return validator
}

function seedAccount(): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-api-checking',
    'API Checking',
    'USD',
    '0.00',
    1777593600,
    'test-fixtures',
    'Example Bank',
    'examplebank.test',
    'depository',
    null,
    'Assets:US:Banks:APIChecking',
    1777593600,
  )
}

function seedImportRun(): { runId: string } {
  seedAccount()

  const source = store.ensureSource({
    id: 'source-api-csv',
    kind: 'csv',
    name: 'API CSV Imports',
  })
  const connection = store.ensureSourceConnection({
    id: 'connection-api-csv',
    sourceId: source.id,
    name: 'API CSV Connection',
  })
  const sourceAccount = store.ensureSourceAccount({
    id: 'source-account-api-checking',
    sourceConnectionId: connection.id,
    fintrackAccountId: 'acct-api-checking',
    externalAccountId: 'checking-001',
    name: 'Imported Checking',
    currency: 'USD',
  })
  const run = store.createImportRun({
    id: 'run-api-review',
    sourceConnectionId: connection.id,
    startedAt: 1777593600,
  })

  const rawStaged = store.insertRawImportItem({
    id: 'raw-staged',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-staged',
    sourceItemKey: 'key-staged',
    rawPayload: { description: 'Coffee Shop' },
  })
  const rawReady = store.insertRawImportItem({
    id: 'raw-ready',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-ready',
    sourceItemKey: 'key-ready',
    rawPayload: { description: 'Grocer' },
  })
  const rawMerged = store.insertRawImportItem({
    id: 'raw-merged',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-merged',
    sourceItemKey: 'key-merged',
    rawPayload: { description: 'Merged Txn' },
  })
  const rawError = store.insertRawImportItem({
    id: 'raw-error',
    importRunId: run.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-error',
    sourceItemKey: 'key-error',
    rawPayload: { description: 'Invalid Txn' },
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
    'txn-merged',
    'acct-api-checking',
    connection.id,
    sourceAccount.id,
    'external-merged',
    'key-merged',
    run.id,
    rawMerged.item.id,
    'test-normalizer-v1',
    'csv',
    1777766400,
    null,
    '-20.00',
    'Merged Txn',
    0,
    'posted',
    'Expenses:Food',
    null,
    'Already promoted',
    JSON.stringify(['imported']),
    1777766400,
    1777766400,
  )

  store.insertStagedTransaction({
    id: 'staged-pending',
    importRunId: run.id,
    rawItemId: rawStaged.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-api-checking',
    externalId: 'external-staged',
    sourceItemKey: 'key-staged',
    posted: 1777593600,
    amount: '-4.75',
    currency: 'USD',
    description: 'Coffee Shop',
    status: 'staged',
    category: 'Expenses:Food:Coffee',
    notes: 'Morning coffee',
  })
  store.insertStagedTransaction({
    id: 'staged-ready',
    importRunId: run.id,
    rawItemId: rawReady.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-api-checking',
    externalId: 'external-ready',
    sourceItemKey: 'key-ready',
    posted: 1777680000,
    amount: '-12.34',
    currency: 'USD',
    description: 'Grocer',
    status: 'ready',
    category: 'Expenses:Food:Groceries',
  })
  store.insertStagedTransaction({
    id: 'staged-merged',
    importRunId: run.id,
    rawItemId: rawMerged.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    accountId: 'acct-api-checking',
    transactionId: 'txn-merged',
    externalId: 'external-merged',
    sourceItemKey: 'key-merged',
    posted: 1777766400,
    amount: '-20.00',
    currency: 'USD',
    description: 'Merged Txn',
    status: 'merged',
  })
  store.insertStagedTransaction({
    id: 'staged-error',
    importRunId: run.id,
    rawItemId: rawError.item.id,
    sourceConnectionId: connection.id,
    sourceAccountId: sourceAccount.id,
    externalId: 'external-error',
    sourceItemKey: 'key-error',
    amount: '-1.00',
    currency: 'USD',
    description: 'Invalid Txn',
    status: 'error',
    validationErrors: ['Missing posted date'],
  })

  store.finishImportRun({ id: run.id })

  return { runId: run.id }
}

function seedInvestmentActivity(runId: string): string {
  sqlite.prepare(`
    INSERT INTO securities (
      id,
      source_connection_id,
      source_symbol,
      name,
      instrument_type,
      underlying_symbol,
      contract_symbol,
      option_type,
      expiration_date,
      strike_price,
      beancount_commodity,
      raw_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'security-api-option',
    'connection-api-csv',
    '-FCT250620C50',
    'FICTCORP CALL',
    'option',
    'FCT',
    '-FCT250620C50',
    'call',
    '2025-06-20',
    '50',
    null,
    JSON.stringify({ fixture: true }),
    1777680000,
    1777680000,
  )

  const activityId = 'investment-activity-api-option'
  sqlite.prepare(`
    INSERT INTO investment_activities (
      id,
      import_run_id,
      raw_item_id,
      staged_transaction_id,
      source_connection_id,
      source_account_id,
      account_id,
      security_id,
      external_id,
      source_item_key,
      trade_date,
      settlement_date,
      activity_type,
      instrument_type,
      position_effect,
      option_type,
      quantity,
      price,
      amount,
      currency,
      commission,
      fees,
      accrued_interest,
      cash_balance,
      action,
      description,
      status,
      validation_errors,
      normalized_payload,
      normalizer_version,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    activityId,
    runId,
    'raw-ready',
    'staged-ready',
    'connection-api-csv',
    'source-account-api-checking',
    'acct-api-checking',
    'security-api-option',
    'external-investment',
    'key-investment',
    1777680000,
    '2026-05-02',
    'buy',
    'option',
    'open',
    'call',
    '1',
    '1.25',
    '-125.65',
    'USD',
    '0.65',
    null,
    null,
    '5000.00',
    'YOU BOUGHT OPENING TRANSACTION CALL',
    'FICTCORP CALL',
    'blocked',
    JSON.stringify(['Investment activity review/export is required before this parser profile can be promoted']),
    JSON.stringify({ fixture: true }),
    'fidelity-brokerage-csv-v1',
    1777680000,
    1777680000,
  )

  return activityId
}

function seedTreasuryBillActivity(runId: string): string {
  sqlite.prepare(`
    INSERT INTO securities (
      id,
      source_connection_id,
      source_symbol,
      name,
      instrument_type,
      underlying_symbol,
      contract_symbol,
      option_type,
      expiration_date,
      strike_price,
      beancount_commodity,
      raw_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'security-api-tbill',
    'connection-api-csv',
    '912797SX6',
    'UNITED STATES TREAS BILLS ZERO CPN',
    'cash',
    null,
    null,
    null,
    null,
    null,
    null,
    JSON.stringify({ fixture: true }),
    1777680000,
    1777680000,
  )

  const activityId = 'investment-activity-api-tbill'
  sqlite.prepare(`
    INSERT INTO investment_activities (
      id,
      import_run_id,
      raw_item_id,
      staged_transaction_id,
      source_connection_id,
      source_account_id,
      account_id,
      security_id,
      external_id,
      source_item_key,
      trade_date,
      settlement_date,
      activity_type,
      instrument_type,
      position_effect,
      option_type,
      quantity,
      price,
      amount,
      currency,
      commission,
      fees,
      accrued_interest,
      cash_balance,
      action,
      description,
      status,
      validation_errors,
      normalized_payload,
      normalizer_version,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    activityId,
    runId,
    'raw-ready',
    'staged-ready',
    'connection-api-csv',
    'source-account-api-checking',
    'acct-api-checking',
    'security-api-tbill',
    'external-tbill',
    'key-tbill',
    1777680000,
    '2026-05-02',
    'buy',
    'cash',
    'none',
    null,
    '1',
    '99.50',
    '-99.50',
    'USD',
    null,
    null,
    null,
    null,
    'YOU BOUGHT UNITED STATES TREAS BILLS',
    'UNITED STATES TREAS BILLS ZERO CPN',
    'blocked',
    JSON.stringify([]),
    JSON.stringify({ fixture: true }),
    'fidelity-brokerage-csv-v1',
    1777680000,
    1777680000,
  )

  return activityId
}

function seedInvestmentPosition(runId: string): string {
  sqlite.prepare(`
    INSERT OR IGNORE INTO securities (
      id,
      source_connection_id,
      source_symbol,
      name,
      instrument_type,
      underlying_symbol,
      contract_symbol,
      option_type,
      expiration_date,
      strike_price,
      beancount_commodity,
      raw_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'security-api-position',
    'connection-api-csv',
    'FCT',
    'Fictitious Corp',
    'equity',
    null,
    null,
    null,
    null,
    null,
    'FCT',
    JSON.stringify({ fixture: true }),
    1777680000,
    1777680000,
  )

  const positionId = 'investment-position-api-fct'
  sqlite.prepare(`
    INSERT INTO investment_positions (
      id,
      source_connection_id,
      source_account_id,
      import_run_id,
      raw_item_id,
      account_id,
      security_id,
      external_id,
      source_item_key,
      as_of_date,
      quantity,
      market_value,
      price,
      currency,
      status,
      validation_errors,
      raw_payload,
      normalizer_version,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    positionId,
    'connection-api-csv',
    'source-account-api-checking',
    runId,
    'raw-ready',
    'acct-api-checking',
    'security-api-position',
    'external-position',
    'position-key-fct',
    '2026-05-01',
    '12.3456',
    '493.824',
    '40.00',
    'USD',
    'needs_review',
    JSON.stringify(['Position snapshot requires review']),
    JSON.stringify({ fixture: true }),
    'fidelity-positions-csv-v1',
    1777680000,
    1777680000,
  )

  return positionId
}

beforeEach(() => {
  resetBeancountEnv()
  fs.rmSync(beancountRoot, { recursive: true, force: true })
  resetDb()
})

after(() => {
  resetBeancountEnv()
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('GET /api/import/runs/:id returns the import run and review summary', async () => {
  const { runId } = seedImportRun()
  const response = await runRoute.GET(request(`/api/import/runs/${runId}`), params(runId))
  const payload = await response.json() as {
    run: { id: string; sourceConnectionId: string; status: string; lifecycleState: string; itemCount: number }
    summary: Record<string, number>
    lifecycle: {
      raw: Record<string, number>
      staged: Record<string, number>
      canonical: Record<string, number>
    }
  }

  assert.equal(response.status, 200)
  assert.equal(payload.run.id, runId)
  assert.equal(payload.run.sourceConnectionId, 'connection-api-csv')
  assert.equal(payload.run.status, 'completed')
  assert.equal(payload.run.lifecycleState, 'reviewed')
  assert.equal(payload.run.itemCount, 4)
  assert.deepEqual(payload.summary, {
    raw: 4,
    staged: 1,
    ready: 1,
    merged: 1,
    ignored: 0,
    deleted: 0,
    error: 1,
    canonical: 1,
  })
  assert.deepEqual(payload.lifecycle.raw, {
    raw_imported: 4,
    staged: 0,
    needs_review: 0,
    reviewed: 0,
    ignored: 0,
    deleted: 0,
    export_ready: 0,
    exported: 0,
    failed: 0,
  })
  assert.deepEqual(payload.lifecycle.staged, {
    raw_imported: 0,
    staged: 1,
    needs_review: 1,
    reviewed: 1,
    ignored: 0,
    deleted: 0,
    export_ready: 1,
    exported: 0,
    failed: 0,
  })
  assert.deepEqual(payload.lifecycle.canonical, {
    raw_imported: 0,
    staged: 0,
    needs_review: 1,
    reviewed: 0,
    ignored: 0,
    deleted: 0,
    export_ready: 0,
    exported: 0,
    failed: 0,
  })
})

test('GET /api/import/runs/:id returns 404 JSON for a missing run', async () => {
  const response = await runRoute.GET(request('/api/import/runs/missing-run'), params('missing-run'))
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('GET /api/import/runs/:id/staged returns staged rows with source account names', async () => {
  const { runId } = seedImportRun()
  const response = await stagedRoute.GET(request(`/api/import/runs/${runId}/staged`), params(runId))
  const payload = await response.json() as {
    rows: Array<{
      id: string
      status: string
      lifecycleState: string
      accountId: string | null
      sourceAccountId: string | null
      sourceAccountName: string | null
      posted: number | null
      amount: string | null
      description: string | null
      category: string | null
      notes: string | null
      transactionId: string | null
      rawItemId: string | null
      sourceItemKey: string | null
      validationErrors: string[]
      updatedAt: number
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 4)

  const ready = payload.rows.find(row => row.id === 'staged-ready')
  assert.ok(ready)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.lifecycleState, 'reviewed')
  assert.equal(ready.accountId, 'acct-api-checking')
  assert.equal(ready.sourceAccountId, 'source-account-api-checking')
  assert.equal(ready.sourceAccountName, 'Imported Checking')
  assert.equal(ready.posted, 1777680000)
  assert.equal(ready.amount, '-12.34')
  assert.equal(ready.description, 'Grocer')
  assert.equal(ready.category, 'Expenses:Food:Groceries')
  assert.equal(ready.transactionId, null)
  assert.equal(ready.rawItemId, 'raw-ready')
  assert.equal(ready.sourceItemKey, 'key-ready')
  assert.equal(typeof ready.updatedAt, 'number')

  const merged = payload.rows.find(row => row.id === 'staged-merged')
  assert.ok(merged)
  assert.equal(merged.transactionId, 'txn-merged')
  assert.equal(merged.lifecycleState, 'export_ready')

  const error = payload.rows.find(row => row.id === 'staged-error')
  assert.ok(error)
  assert.equal(error.lifecycleState, 'needs_review')
  assert.deepEqual(error.validationErrors, ['Missing posted date'])
})

test('GET /api/import/runs/:id/staged returns 404 JSON for a missing run', async () => {
  const response = await stagedRoute.GET(
    request('/api/import/runs/missing-run/staged'),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('GET /api/import/runs/:id/investment-activities returns staged investment metadata', async () => {
  const { runId } = seedImportRun()
  const activityId = seedInvestmentActivity(runId)
  const response = await investmentActivitiesRoute.GET(
    request(`/api/import/runs/${runId}/investment-activities`),
    params(runId),
  )
  const payload = await response.json() as {
    rows: Array<{
      id: string
      status: string
      stagedTransactionId: string
      stagedStatus: string
      accountName: string
      sourceAccountName: string
      sourceSymbol: string
      securityName: string
      activityType: string
      instrumentType: string
      positionEffect: string
      optionType: string
      quantity: string
      price: string
      amount: string
      commission: string
      tradeDate: number
      settlementDate: string
      validationErrors: string[]
      normalizerVersion: string
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 1)

  const row = payload.rows[0]
  assert.equal(row.id, activityId)
  assert.equal(row.status, 'blocked')
  assert.equal(row.stagedTransactionId, 'staged-ready')
  assert.equal(row.stagedStatus, 'ready')
  assert.equal(row.accountName, 'API Checking')
  assert.equal(row.sourceAccountName, 'Imported Checking')
  assert.equal(row.sourceSymbol, '-FCT250620C50')
  assert.equal(row.securityName, 'FICTCORP CALL')
  assert.equal(row.activityType, 'buy')
  assert.equal(row.instrumentType, 'option')
  assert.equal(row.positionEffect, 'open')
  assert.equal(row.optionType, 'call')
  assert.equal(row.quantity, '1')
  assert.equal(row.price, '1.25')
  assert.equal(row.amount, '-125.65')
  assert.equal(row.commission, '0.65')
  assert.equal(row.tradeDate, 1777680000)
  assert.equal(row.settlementDate, '2026-05-02')
  assert.deepEqual(row.validationErrors, [
    'Investment activity review/export is required before this parser profile can be promoted',
  ])
  assert.equal(row.normalizerVersion, 'fidelity-brokerage-csv-v1')
})

test('GET /api/import/runs/:id/investment-activities returns 404 JSON for a missing run', async () => {
  const response = await investmentActivitiesRoute.GET(
    request('/api/import/runs/missing-run/investment-activities'),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('PATCH /api/import/runs/:id/investment-activities/:activityId updates review status with audit', async () => {
  const { runId } = seedImportRun()
  const activityId = seedInvestmentActivity(runId)
  const response = await investmentActivityRoute.PATCH(
    request(`/api/import/runs/${runId}/investment-activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed', actor: 'tester', reason: 'investment review' }),
    }),
    investmentActivityParams(runId, activityId),
  )
  const payload = await response.json() as { id: string; status: string; updatedAt: number }

  assert.equal(response.status, 200)
  assert.equal(payload.id, activityId)
  assert.equal(payload.status, 'reviewed')
  assert.equal(typeof payload.updatedAt, 'number')

  const row = sqlite.prepare(`
    SELECT status
    FROM investment_activities
    WHERE id = ?
  `).get(activityId) as { status: string }
  assert.equal(row.status, 'reviewed')

  const audit = sqlite.prepare(`
    SELECT action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata
    FROM audit_log
    WHERE entity_type = 'investment_activity'
      AND entity_id = ?
  `).get(activityId) as {
    action: string
    actor: string
    reason: string
    beforeValues: string
    afterValues: string
    metadata: string
  }
  assert.equal(audit.action, 'investment_activity_review')
  assert.equal(audit.actor, 'tester')
  assert.equal(audit.reason, 'investment review')
  assert.equal((JSON.parse(audit.beforeValues) as { investmentActivity: { status: string } }).investmentActivity.status, 'blocked')
  assert.equal((JSON.parse(audit.afterValues) as { investmentActivity: { status: string } }).investmentActivity.status, 'reviewed')
  assert.equal((JSON.parse(audit.metadata) as { importRunId: string }).importRunId, runId)
})

test('PATCH /api/import/runs/:id/investment-activities/:activityId rejects invalid status', async () => {
  const { runId } = seedImportRun()
  const activityId = seedInvestmentActivity(runId)
  const response = await investmentActivityRoute.PATCH(
    request(`/api/import/runs/${runId}/investment-activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'posted' }),
    }),
    investmentActivityParams(runId, activityId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'status must be blocked, needs_review, reviewed, or ignored')
})

test('GET /api/import/runs/:id/investment-positions returns staged position snapshots', async () => {
  const { runId } = seedImportRun()
  const positionId = seedInvestmentPosition(runId)
  const response = await investmentPositionsRoute.GET(
    request(`/api/import/runs/${runId}/investment-positions`),
    params(runId),
  )
  const payload = await response.json() as {
    rows: Array<{
      id: string
      status: string
      rawItemId: string
      accountName: string
      sourceAccountName: string
      sourceSymbol: string
      securityName: string
      beancountCommodity: string
      externalId: string
      sourceItemKey: string
      asOfDate: string
      quantity: string
      marketValue: string
      price: string
      currency: string
      validationErrors: string[]
      normalizerVersion: string
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 1)

  const row = payload.rows[0]
  assert.equal(row.id, positionId)
  assert.equal(row.status, 'needs_review')
  assert.equal(row.rawItemId, 'raw-ready')
  assert.equal(row.accountName, 'API Checking')
  assert.equal(row.sourceAccountName, 'Imported Checking')
  assert.equal(row.sourceSymbol, 'FCT')
  assert.equal(row.securityName, 'Fictitious Corp')
  assert.equal(row.beancountCommodity, 'FCT')
  assert.equal(row.externalId, 'external-position')
  assert.equal(row.sourceItemKey, 'position-key-fct')
  assert.equal(row.asOfDate, '2026-05-01')
  assert.equal(row.quantity, '12.3456')
  assert.equal(row.marketValue, '493.824')
  assert.equal(row.price, '40.00')
  assert.equal(row.currency, 'USD')
  assert.deepEqual(row.validationErrors, ['Position snapshot requires review'])
  assert.equal(row.normalizerVersion, 'fidelity-positions-csv-v1')
})

test('GET /api/import/runs/:id/investment-positions returns 404 JSON for a missing run', async () => {
  const response = await investmentPositionsRoute.GET(
    request('/api/import/runs/missing-run/investment-positions'),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('PATCH /api/import/runs/:id/investment-positions/:positionId updates review status with audit', async () => {
  const { runId } = seedImportRun()
  const positionId = seedInvestmentPosition(runId)
  const response = await investmentPositionRoute.PATCH(
    request(`/api/import/runs/${runId}/investment-positions/${positionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reviewed', actor: 'tester', reason: 'position review' }),
    }),
    investmentPositionParams(runId, positionId),
  )
  const payload = await response.json() as { id: string; status: string; updatedAt: number }

  assert.equal(response.status, 200)
  assert.equal(payload.id, positionId)
  assert.equal(payload.status, 'reviewed')
  assert.equal(typeof payload.updatedAt, 'number')

  const row = sqlite.prepare(`
    SELECT status
    FROM investment_positions
    WHERE id = ?
  `).get(positionId) as { status: string }
  assert.equal(row.status, 'reviewed')

  const audit = sqlite.prepare(`
    SELECT action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata
    FROM audit_log
    WHERE entity_type = 'investment_position'
      AND entity_id = ?
  `).get(positionId) as {
    action: string
    actor: string
    reason: string
    beforeValues: string
    afterValues: string
    metadata: string
  }
  assert.equal(audit.action, 'investment_position_review')
  assert.equal(audit.actor, 'tester')
  assert.equal(audit.reason, 'position review')
  assert.equal((JSON.parse(audit.beforeValues) as { investmentPosition: { status: string } }).investmentPosition.status, 'needs_review')
  assert.equal((JSON.parse(audit.afterValues) as { investmentPosition: { status: string } }).investmentPosition.status, 'reviewed')
  assert.equal((JSON.parse(audit.metadata) as { importRunId: string }).importRunId, runId)
})

test('PATCH /api/import/runs/:id/investment-positions/:positionId rejects invalid status', async () => {
  const { runId } = seedImportRun()
  const positionId = seedInvestmentPosition(runId)
  const response = await investmentPositionRoute.PATCH(
    request(`/api/import/runs/${runId}/investment-positions/${positionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'posted' }),
    }),
    investmentPositionParams(runId, positionId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'status must be blocked, needs_review, reviewed, or ignored')
})

test('GET /api/import/runs/:id/securities includes position-only securities', async () => {
  const { runId } = seedImportRun()
  seedInvestmentPosition(runId)
  const response = await securitiesRoute.GET(
    request(`/api/import/runs/${runId}/securities`),
    params(runId),
  )
  const payload = await response.json() as {
    securities: Array<{
      id: string
      sourceSymbol: string
      suggestedCommodity: string
      activityCount: number
      blockedCount: number
      needsReviewCount: number
      reviewedCount: number
      ignoredCount: number
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.securities.length, 1)
  assert.equal(payload.securities[0].id, 'security-api-position')
  assert.equal(payload.securities[0].sourceSymbol, 'FCT')
  assert.equal(payload.securities[0].suggestedCommodity, 'FCT')
  assert.equal(payload.securities[0].activityCount, 1)
  assert.equal(payload.securities[0].blockedCount, 0)
  assert.equal(payload.securities[0].needsReviewCount, 1)
  assert.equal(payload.securities[0].reviewedCount, 0)
  assert.equal(payload.securities[0].ignoredCount, 0)
})

test('GET /api/import/runs/:id/securities returns securities needing Beancount mapping', async () => {
  const { runId } = seedImportRun()
  seedInvestmentActivity(runId)
  const response = await securitiesRoute.GET(
    request(`/api/import/runs/${runId}/securities`),
    params(runId),
  )
  const payload = await response.json() as {
    securities: Array<{
      id: string
      sourceSymbol: string
      name: string
      instrumentType: string
      underlyingSymbol: string
      contractSymbol: string
      optionType: string
      expirationDate: string
      strikePrice: string
      beancountCommodity: string | null
      suggestedCommodity: string
      activityCount: number
      blockedCount: number
      needsReviewCount: number
      reviewedCount: number
      ignoredCount: number
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.securities.length, 1)

  const security = payload.securities[0]
  assert.equal(security.id, 'security-api-option')
  assert.equal(security.sourceSymbol, '-FCT250620C50')
  assert.equal(security.name, 'FICTCORP CALL')
  assert.equal(security.instrumentType, 'option')
  assert.equal(security.underlyingSymbol, 'FCT')
  assert.equal(security.contractSymbol, '-FCT250620C50')
  assert.equal(security.optionType, 'call')
  assert.equal(security.expirationDate, '2025-06-20')
  assert.equal(security.strikePrice, '50')
  assert.equal(security.beancountCommodity, null)
  assert.equal(security.suggestedCommodity, 'FCT250620C50')
  assert.equal(security.activityCount, 1)
  assert.equal(security.blockedCount, 1)
  assert.equal(security.needsReviewCount, 0)
  assert.equal(security.reviewedCount, 0)
  assert.equal(security.ignoredCount, 0)
})

test('GET /api/import/runs/:id/securities suggests stable CUSIP commodities', async () => {
  const { runId } = seedImportRun()
  seedTreasuryBillActivity(runId)
  const response = await securitiesRoute.GET(
    request(`/api/import/runs/${runId}/securities`),
    params(runId),
  )
  const payload = await response.json() as {
    securities: Array<{
      id: string
      sourceSymbol: string
      suggestedCommodity: string
    }>
  }

  assert.equal(response.status, 200)
  assert.equal(payload.securities.length, 1)
  assert.equal(payload.securities[0].id, 'security-api-tbill')
  assert.equal(payload.securities[0].sourceSymbol, '912797SX6')
  assert.equal(payload.securities[0].suggestedCommodity, 'CUSIP_912797SX6')
})

test('GET /api/import/runs/:id/securities returns 404 JSON for a missing run', async () => {
  const response = await securitiesRoute.GET(
    request('/api/import/runs/missing-run/securities'),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('PATCH /api/import/runs/:id/securities/:securityId maps Beancount commodity with audit', async () => {
  const { runId } = seedImportRun()
  seedInvestmentActivity(runId)
  const response = await securityRoute.PATCH(
    request(`/api/import/runs/${runId}/securities/security-api-option`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        beancountCommodity: 'fct250620c50',
        actor: 'tester',
        reason: 'map option commodity',
      }),
    }),
    securityParams(runId, 'security-api-option'),
  )
  const payload = await response.json() as {
    security: {
      id: string
      beancountCommodity: string
      suggestedCommodity: string
    }
  }

  assert.equal(response.status, 200)
  assert.equal(payload.security.id, 'security-api-option')
  assert.equal(payload.security.beancountCommodity, 'FCT250620C50')
  assert.equal(payload.security.suggestedCommodity, 'FCT250620C50')

  const row = sqlite.prepare(`
    SELECT beancount_commodity AS beancountCommodity
    FROM securities
    WHERE id = ?
  `).get('security-api-option') as { beancountCommodity: string }
  assert.equal(row.beancountCommodity, 'FCT250620C50')

  const audit = sqlite.prepare(`
    SELECT action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata
    FROM audit_log
    WHERE entity_type = 'security'
      AND entity_id = 'security-api-option'
  `).get() as {
    action: string
    actor: string
    reason: string
    beforeValues: string
    afterValues: string
    metadata: string
  }
  assert.equal(audit.action, 'security_mapping_update')
  assert.equal(audit.actor, 'tester')
  assert.equal(audit.reason, 'map option commodity')
  assert.equal((JSON.parse(audit.beforeValues) as { security: { beancountCommodity: string | null } }).security.beancountCommodity, null)
  assert.equal((JSON.parse(audit.afterValues) as { security: { beancountCommodity: string } }).security.beancountCommodity, 'FCT250620C50')
  assert.equal((JSON.parse(audit.metadata) as { importRunId: string }).importRunId, runId)
})

test('PATCH /api/import/runs/:id/securities/:securityId clears Beancount commodity mapping', async () => {
  const { runId } = seedImportRun()
  seedInvestmentActivity(runId)
  sqlite.prepare(`
    UPDATE securities
    SET beancount_commodity = 'FCT250620C50'
    WHERE id = 'security-api-option'
  `).run()

  const response = await securityRoute.PATCH(
    request(`/api/import/runs/${runId}/securities/security-api-option`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beancountCommodity: null }),
    }),
    securityParams(runId, 'security-api-option'),
  )
  const payload = await response.json() as {
    security: {
      beancountCommodity: string | null
      suggestedCommodity: string
    }
  }

  assert.equal(response.status, 200)
  assert.equal(payload.security.beancountCommodity, null)
  assert.equal(payload.security.suggestedCommodity, 'FCT250620C50')
})

test('PATCH /api/import/runs/:id/securities/:securityId rejects invalid commodity symbols', async () => {
  const { runId } = seedImportRun()
  seedInvestmentActivity(runId)
  const response = await securityRoute.PATCH(
    request(`/api/import/runs/${runId}/securities/security-api-option`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beancountCommodity: 'bad commodity' }),
    }),
    securityParams(runId, 'security-api-option'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'beancountCommodity must be a Beancount commodity symbol or null')
})

const promoteServicePath = path.join(process.cwd(), 'lib', 'ingest', 'promote.ts')
const skipPromoteTests = fs.existsSync(promoteServicePath)
  ? false
  : 'lib/ingest/promote.ts is not present yet'

test('POST /api/import/runs/:id/promote returns 404 JSON for a missing run', { skip: skipPromoteTests }, async () => {
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request('/api/import/runs/missing-run/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedTransactionIds: ['staged-ready'] }),
    }),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('POST /api/import/runs/:id/promote rejects malformed JSON bodies without promoting all rows', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    }),
    params(runId),
  )
  const payload = await response.json() as { error?: string }
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Request body must be a JSON object')
  assert.equal(transactionCount.value, 1)
})

test('POST /api/import/runs/:id/promote rejects non-completed runs', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  sqlite.prepare(`
    UPDATE import_runs
    SET status = 'running'
    WHERE id = ?
  `).run(runId)

  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedTransactionIds: ['staged-ready'] }),
    }),
    params(runId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'Import run must be completed before promote: running')
})

test('POST /api/import/runs/:id/promote delegates to promoteStagedTransactions', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedTransactionIds: ['staged-ready'] }),
    }),
    params(runId),
  )
  const payload = await response.json() as { promoted: unknown; skipped: unknown; errors: unknown }

  assert.equal(response.status, 200)
  assert.equal(typeof payload.promoted, 'number')
  assert.equal(typeof payload.skipped, 'number')
  assert.ok(Array.isArray(payload.errors))
  assert.equal('validation' in payload, false)
})

test('POST /api/import/runs/:id/promote blocks required Beancount validation failures before writing', { skip: skipPromoteTests }, async () => {
  writePromotionLedger(['Assets:US:Banks:APIChecking'])
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationMode: 'required' }),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    error?: string
    validation?: {
      ok: boolean
      validation: { stage: string; summary: { blockers: number } }
    }
  }
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }
  const mergedStagedCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM staged_transactions
    WHERE status = 'merged'
      AND id IN ('staged-pending', 'staged-ready')
  `).get() as { value: number }

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'Beancount validation failed; promotion was not run')
  assert.equal(payload.validation?.ok, false)
  assert.equal(payload.validation?.validation.stage, 'preflight')
  assert.equal((payload.validation?.validation.summary.blockers ?? 0) > 0, true)
  assert.equal(transactionCount.value, 1)
  assert.equal(mergedStagedCount.value, 0)
})

test('POST /api/import/runs/:id/promote runs after required Beancount validation passes', { skip: skipPromoteTests }, async () => {
  writePromotionLedger()
  process.env.FINTRACK_BEANCOUNT_VALIDATOR = writePassingValidator()
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationMode: 'required' }),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    promoted: number
    skipped: number
    errors: unknown[]
    validation?: { ok: boolean; validation: { checker: { status: string; mode: string } } }
  }
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }
  const mergedStagedCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM staged_transactions
    WHERE status = 'merged'
      AND id IN ('staged-pending', 'staged-ready')
  `).get() as { value: number }

  assert.equal(response.status, 200)
  assert.equal(payload.promoted, 2)
  assert.equal(payload.skipped, 2)
  assert.deepEqual(payload.errors, [])
  assert.equal(payload.validation?.ok, true)
  assert.equal(payload.validation?.validation.checker.status, 'passed')
  assert.equal(payload.validation?.validation.checker.mode, 'required')
  assert.equal(transactionCount.value, 3)
  assert.equal(mergedStagedCount.value, 2)
})

test('POST /api/import/runs/:id/promote honors required env validation and sanitizes checker failures', { skip: skipPromoteTests }, async () => {
  writePromotionLedger()
  process.env.FINTRACK_BEANCOUNT_VALIDATION = 'required'
  process.env.FINTRACK_BEANCOUNT_VALIDATOR = path.join(tempDir, 'missing-bean-check')
  const { runId } = seedImportRun()
  const promoteRoute = require('../app/api/import/runs/[id]/promote/route') as PromoteRoute
  const response = await promoteRoute.POST(
    request(`/api/import/runs/${runId}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    error?: string
    validation?: {
      ok: boolean
      validation: { stage: string; checker: { status: string; message: string | null } }
    }
  }
  const serialized = JSON.stringify(payload)
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'Beancount validation failed; promotion was not run')
  assert.equal(payload.validation?.ok, false)
  assert.equal(payload.validation?.validation.stage, 'external')
  assert.equal(payload.validation?.validation.checker.status, 'failed')
  assert.equal(payload.validation?.validation.checker.message, '[path] was not found')
  assert.equal(serialized.includes(beancountRoot), false)
  assert.equal(serialized.includes(tempDir), false)
  assert.equal(transactionCount.value, 1)
})

test('POST /api/import/runs/:id/promote/validate returns 404 JSON for a missing run', { skip: skipPromoteTests }, async () => {
  const response = await promoteValidateRoute.POST(
    request('/api/import/runs/missing-run/promote/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationMode: 'disabled' }),
    }),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

test('POST /api/import/runs/:id/promote/validate rejects non-completed runs', { skip: skipPromoteTests }, async () => {
  const { runId } = seedImportRun()
  sqlite.prepare(`
    UPDATE import_runs
    SET status = 'running'
    WHERE id = ?
  `).run(runId)

  const response = await promoteValidateRoute.POST(
    request(`/api/import/runs/${runId}/promote/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationMode: 'disabled' }),
    }),
    params(runId),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 409)
  assert.equal(payload.error, 'Import run must be completed before validate: running')
})

test('POST /api/import/runs/:id/promote/validate previews promotion and rolls back writes', { skip: skipPromoteTests }, async () => {
  writePromotionLedger()
  const { runId } = seedImportRun()
  const response = await promoteValidateRoute.POST(
    request(`/api/import/runs/${runId}/promote/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationMode: 'disabled' }),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    ok: boolean
    period: string
    promotion: { promoted: number; skipped: number; errors: unknown[] }
    validation: {
      ok: boolean
      stage: string
      summary: { exportableTransactions: number; blockers: number }
      checker: { status: string; mode: string }
    }
  }
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }
  const mergedStagedCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM staged_transactions
    WHERE status = 'merged'
      AND id IN ('staged-pending', 'staged-ready')
  `).get() as { value: number }

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.period, '2026-05')
  assert.equal(payload.promotion.promoted, 2)
  assert.equal(payload.promotion.skipped, 2)
  assert.deepEqual(payload.promotion.errors, [])
  assert.equal(payload.validation.ok, true)
  assert.equal(payload.validation.stage, 'external')
  assert.equal(payload.validation.summary.exportableTransactions, 3)
  assert.equal(payload.validation.summary.blockers, 0)
  assert.equal(payload.validation.checker.status, 'skipped')
  assert.equal(payload.validation.checker.mode, 'disabled')
  assert.equal(transactionCount.value, 1)
  assert.equal(mergedStagedCount.value, 0)
})

test('POST /api/import/runs/:id/promote/validate returns sanitized preflight blockers without invoking checker', { skip: skipPromoteTests }, async () => {
  writePromotionLedger(['Assets:US:Banks:APIChecking'])
  const { runId } = seedImportRun()
  const response = await promoteValidateRoute.POST(
    request(`/api/import/runs/${runId}/promote/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationMode: 'required' }),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    ok: boolean
    validation: {
      ok: boolean
      stage: string
      summary: { blockers: number }
      blockers: Array<{ code: string; message: string }>
      checker: unknown
    }
  }
  const serialized = JSON.stringify(payload)
  const transactionCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM transactions
  `).get() as { value: number }

  assert.equal(response.status, 200)
  assert.equal(payload.ok, false)
  assert.equal(payload.validation.ok, false)
  assert.equal(payload.validation.stage, 'preflight')
  assert.equal(payload.validation.summary.blockers > 0, true)
  assert.equal(payload.validation.blockers.some(issue => issue.code === 'category_not_open'), true)
  assert.equal(payload.validation.checker, null)
  assert.equal(serialized.includes(beancountRoot), false)
  assert.equal(serialized.includes('source_id'), false)
  assert.equal(transactionCount.value, 1)
})

test('POST /api/import/runs/:id/promote/validate reports required checker failures without leaking paths', { skip: skipPromoteTests }, async () => {
  writePromotionLedger()
  process.env.FINTRACK_BEANCOUNT_VALIDATION = 'required'
  process.env.FINTRACK_BEANCOUNT_VALIDATOR = path.join(tempDir, 'missing-bean-check')
  const { runId } = seedImportRun()
  const response = await promoteValidateRoute.POST(
    request(`/api/import/runs/${runId}/promote/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    ok: boolean
    validation: {
      ok: boolean
      stage: string
      checker: { status: string; mode: string; message: string | null }
    }
  }
  const serialized = JSON.stringify(payload)

  assert.equal(response.status, 200)
  assert.equal(payload.ok, false)
  assert.equal(payload.validation.ok, false)
  assert.equal(payload.validation.stage, 'external')
  assert.equal(payload.validation.checker.status, 'failed')
  assert.equal(payload.validation.checker.mode, 'required')
  assert.equal(payload.validation.checker.message, '[path] was not found')
  assert.equal(serialized.includes(beancountRoot), false)
  assert.equal(serialized.includes(tempDir), false)
})

test('POST /api/import/runs/:id/replay creates a new staged review run from raw archive', async () => {
  const { runId } = seedImportRun()
  const replayRoute = require('../app/api/import/runs/[id]/replay/route') as ReplayRoute
  const response = await replayRoute.POST(
    request(`/api/import/runs/${runId}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 'tester', reason: 'regression replay' }),
    }),
    params(runId),
  )
  const payload = await response.json() as {
    importRunId: string
    reviewUrl: string
    replay: {
      sourceImportRunId: string
      rawReplayed: number
      stagedReplayed: number
      skippedStagedRows: number
    }
  }

  assert.equal(response.status, 201)
  assert.notEqual(payload.importRunId, runId)
  assert.equal(payload.reviewUrl, `/import/runs/${encodeURIComponent(payload.importRunId)}`)
  assert.equal(payload.replay.sourceImportRunId, runId)
  assert.equal(payload.replay.rawReplayed, 4)
  assert.equal(payload.replay.stagedReplayed, 4)
  assert.equal(payload.replay.skippedStagedRows, 0)

  const replayRun = sqlite.prepare(`
    SELECT source_connection_id AS sourceConnectionId,
           status,
           item_count AS itemCount
    FROM import_runs
    WHERE id = ?
  `).get(payload.importRunId) as { sourceConnectionId: string; status: string; itemCount: number }
  assert.deepEqual(replayRun, {
    sourceConnectionId: 'connection-api-csv',
    status: 'completed',
    itemCount: 4,
  })

  const newRawCount = sqlite.prepare(`
    SELECT COUNT(*) AS value
    FROM raw_import_items
    WHERE import_run_id = ?
  `).get(payload.importRunId) as { value: number }
  assert.equal(newRawCount.value, 4)

  const replayRows = sqlite.prepare(`
    SELECT source_item_key AS sourceItemKey,
           status,
           account_id AS accountId,
           transaction_id AS transactionId,
           validation_errors AS validationErrors
    FROM staged_transactions
    WHERE import_run_id = ?
    ORDER BY source_item_key ASC
  `).all(payload.importRunId) as Array<{
    sourceItemKey: string
    status: string
    accountId: string | null
    transactionId: string | null
    validationErrors: string
  }>

  assert.deepEqual(replayRows.map(row => [row.sourceItemKey, row.status]), [
    ['key-error', 'error'],
    ['key-merged', 'merged'],
    ['key-ready', 'ready'],
    ['key-staged', 'staged'],
  ])
  const errorRow = replayRows.find(row => row.sourceItemKey === 'key-error')
  assert.ok(errorRow)
  assert.equal(errorRow.accountId, 'acct-api-checking')
  assert.deepEqual(JSON.parse(errorRow.validationErrors) as string[], ['Missing required field: posted'])

  const mergedRow = replayRows.find(row => row.sourceItemKey === 'key-merged')
  assert.ok(mergedRow)
  assert.equal(mergedRow.transactionId, 'txn-merged')
  assert.deepEqual(JSON.parse(mergedRow.validationErrors) as string[], [])

  const auditRow = sqlite.prepare(`
    SELECT action,
           actor,
           reason,
           metadata
    FROM audit_log
    WHERE entity_type = 'import_run'
      AND entity_id = ?
  `).get(payload.importRunId) as { action: string; actor: string; reason: string; metadata: string }
  assert.equal(auditRow.action, 'import_run_replay')
  assert.equal(auditRow.actor, 'tester')
  assert.equal(auditRow.reason, 'regression replay')
  assert.equal((JSON.parse(auditRow.metadata) as { sourceImportRunId: string }).sourceImportRunId, runId)
})

test('POST /api/import/runs/:id/replay returns 404 JSON for a missing run', async () => {
  const replayRoute = require('../app/api/import/runs/[id]/replay/route') as ReplayRoute
  const response = await replayRoute.POST(
    request('/api/import/runs/missing-run/replay', { method: 'POST' }),
    params('missing-run'),
  )
  const payload = await response.json() as { error?: string }

  assert.equal(response.status, 404)
  assert.equal(payload.error, 'Import run not found')
})

// ── GET /api/import/runs (list) ───────────────────────────────────────────────

describe('GET /api/import/runs', () => {
  test('returns empty list when no runs exist', async () => {
    const response = await listRoute.GET()
    const payload = await response.json() as { runs: unknown[] }

    assert.equal(response.status, 200)
    assert.ok(Array.isArray(payload.runs))
    assert.equal(payload.runs.length, 0)
  })

  test('returns run with correct aggregated staged counts', async () => {
    const { runId } = seedImportRun()
    const response = await listRoute.GET()
    const payload = await response.json() as {
      runs: Array<{
        id: string
        status: string
        lifecycleState: string
        itemCount: number
        connectionName: string | null
        sourceKind: string | null
        eligibleCount: number
        errorCount: number
        mergedCount: number
      }>
    }

    assert.equal(response.status, 200)
    assert.equal(payload.runs.length, 1)

    const run = payload.runs[0]
    assert.equal(run.id, runId)
    assert.equal(run.status, 'completed')
    assert.equal(run.lifecycleState, 'reviewed')
    assert.equal(run.itemCount, 4)
    assert.equal(run.connectionName, 'API CSV Connection')
    assert.equal(run.sourceKind, 'csv')
    // staged(1) + ready(1) = 2 eligible
    assert.equal(run.eligibleCount, 2)
    assert.equal(run.errorCount, 1)
    assert.equal(run.mergedCount, 1)
  })

  test('returns most recent run first when multiple runs exist', async () => {
    seedImportRun()
    // Push the first run into the past so ordering is deterministic
    sqlite.prepare(`UPDATE import_runs SET created_at = 1000 WHERE id = 'run-api-review'`).run()
    // second run — bare, no staged rows
    const source = store.ensureSource({ id: 'csv', kind: 'csv', name: 'CSV' })
    const conn = store.ensureSourceConnection({ id: 'csv:manual', sourceId: source.id, name: 'Manual' })
    const run2 = store.createImportRun({ id: 'run-second', sourceConnectionId: conn.id })
    store.finishImportRun({ id: run2.id })

    const response = await listRoute.GET()
    const payload = await response.json() as { runs: Array<{ id: string }> }

    assert.equal(payload.runs.length, 2)
    assert.equal(payload.runs[0].id, 'run-second')
    assert.equal(payload.runs[1].id, 'run-api-review')
  })
})
