import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-unexported-preflight-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { runBeancountPreflight } = require('../lib/export/preflight') as typeof import('../lib/export/preflight')
const {
  runBalanceAssertionPreflight,
} = require('../lib/export/balance-assertions') as typeof import('../lib/export/balance-assertions')

const posted = Math.floor(Date.UTC(2026, 3, 15) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM export_runs;
    DELETE FROM balance_assertions;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function writeLedger(): void {
  fs.rmSync(beancountRoot, { recursive: true, force: true })
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Unexported Preflight Test"',
      '2026-01-01 open Assets:US:Banks:UnexportedChecking USD',
      '2026-01-01 open Expenses:Food:Coffee USD',
      '2026-01-01 open Expenses:Food:Lunch USD',
      '',
    ].join('\n'),
  )
}

function insertAccount(): string {
  const id = 'acct-unexported-checking'

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Unexported Checking',
    'USD',
    '1234.56',
    posted,
    'unexported-test',
    'Unexported Bank',
    'unexported.test',
    'depository',
    null,
    'Assets:US:Banks:UnexportedChecking',
    posted,
  )

  return id
}

function insertTransaction(input: {
  id: string
  accountId: string
  amount: string
  description: string
  category: string
}): void {
  sqlite.prepare(`
    INSERT INTO transactions (
      id,
      account_id,
      source,
      posted,
      transacted_at,
      amount,
      description,
      pending,
      status,
      category,
      ledger_account,
      review_status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.accountId,
    'csv',
    posted,
    posted,
    input.amount,
    input.description,
    0,
    'posted',
    input.category,
    input.category,
    'reviewed',
    posted,
    posted,
  )
}

function insertBalanceAssertion(input: {
  id: string
  accountId: string
  assertionDate: string
  sourceId: string
}): void {
  sqlite.prepare(`
    INSERT INTO balance_assertions (
      id,
      fintrack_account_id,
      beancount_account,
      assertion_date,
      amount,
      currency,
      source_id,
      status,
      note,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.accountId,
    'Assets:US:Banks:UnexportedChecking',
    input.assertionDate,
    '1234.56',
    'USD',
    input.sourceId,
    'draft',
    null,
    posted,
    posted,
  )
}

function insertExportRun(sourceIds: string[]): void {
  sqlite.prepare(`
    INSERT INTO export_runs (
      id,
      period,
      status,
      export_range_start,
      export_range_end,
      generated_file_names,
      manifest_path,
      ledger_revision,
      exported_source_ids,
      export_target,
      metadata,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `export-run-${sourceIds.join('-').replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    '2026-04',
    'handoff_written',
    '2026-04-01',
    '2026-04-30',
    JSON.stringify(['2026-04/fintrack/2026-04.bean']),
    '2026-04/fintrack/manifest.json',
    'test-ledger',
    JSON.stringify(sourceIds),
    'beancount_handoff',
    JSON.stringify({ test: true }),
    posted,
    posted,
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

test('transaction preflight can hide source ids already written to export runs', () => {
  const accountId = insertAccount()
  insertTransaction({
    id: 'txn-unexported-previous',
    accountId,
    amount: '-4.75',
    description: 'Coffee',
    category: 'Expenses:Food:Coffee',
  })
  insertTransaction({
    id: 'txn-unexported-next',
    accountId,
    amount: '-12.00',
    description: 'Lunch',
    category: 'Expenses:Food:Lunch',
  })
  insertExportRun(['fintrack:acct-unexported-checking:txn-unexported-previous'])

  const monthly = runBeancountPreflight({ period: '2026-04', beancountRoot })
  assert.deepEqual(monthly.exportableTransactions.map(txn => txn.id), [
    'txn-unexported-next',
    'txn-unexported-previous',
  ])
  assert.equal(monthly.summary.previouslyExported, 0)

  const unexported = runBeancountPreflight({
    period: '2026-04',
    beancountRoot,
    excludeExported: true,
  })
  assert.deepEqual(unexported.exportableTransactions.map(txn => txn.id), ['txn-unexported-next'])
  assert.equal(unexported.summary.previouslyExported, 1)
  assert.deepEqual(unexported.skipped, [
    { transactionId: 'txn-unexported-previous', reason: 'already_exported' },
  ])
})

test('balance assertion preflight can hide source ids already written to export runs', () => {
  const accountId = insertAccount()
  insertBalanceAssertion({
    id: 'assertion-unexported-previous',
    accountId,
    assertionDate: '2026-04-29',
    sourceId: 'fintrack:balance:acct-unexported-checking:2026-04-29',
  })
  insertBalanceAssertion({
    id: 'assertion-unexported-next',
    accountId,
    assertionDate: '2026-04-30',
    sourceId: 'fintrack:balance:acct-unexported-checking:2026-04-30',
  })
  insertExportRun(['fintrack:balance:acct-unexported-checking:2026-04-29'])

  const unexported = runBalanceAssertionPreflight({
    period: '2026-04',
    beancountRoot,
    excludeExported: true,
  })
  assert.deepEqual(unexported.exportableAssertions.map(assertion => assertion.id), [
    'assertion-unexported-next',
  ])
  assert.equal(unexported.summary.previouslyExported, 1)
})
