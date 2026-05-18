import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-promotion-validation-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  validatePromotionBeancountExport,
} = require('../lib/ingest/promotion-validation') as typeof import('../lib/ingest/promotion-validation')

const posted = Math.floor(Date.UTC(2026, 3, 12) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM export_runs;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function writeLedger(openAccounts: string[]): void {
  fs.rmSync(beancountRoot, { recursive: true, force: true })
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Promotion Validation Test"',
      ...openAccounts.map(account => `2026-01-01 open ${account} USD`),
      '',
    ].join('\n'),
  )
}

function insertAccount(): string {
  const id = 'acct-promotion-checking'

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Promotion Checking',
    'USD',
    '0.00',
    posted,
    'promotion-validation-test',
    'Promotion Bank',
    'promotion.test',
    'depository',
    null,
    'Assets:US:Banks:PromotionChecking',
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

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('promotion Beancount validation renders exportable promoted transactions through the external checker', () => {
  writeLedger([
    'Assets:US:Banks:PromotionChecking',
    'Expenses:Food:Coffee',
  ])
  const accountId = insertAccount()
  insertTransaction({
    id: 'txn-promotion-ok',
    accountId,
    amount: '-4.75',
    description: 'Coffee',
    category: 'Expenses:Food:Coffee',
  })

  const script = [
    'const fs = require("fs");',
    'const file = process.argv[1];',
    'const text = fs.readFileSync(file, "utf8");',
    'if (!text.includes("include \\"")) process.exit(3);',
    'if (!text.includes("Coffee")) process.exit(4);',
    'if (!text.includes("source_id")) process.exit(5);',
    'process.stdout.write("promotion checked");',
  ].join('')

  const result = validatePromotionBeancountExport({
    period: '2026-04',
    beancountRoot,
    generatedAt: new Date('2026-05-17T12:00:00.000Z'),
    validationMode: 'required',
    validatorCommand: process.execPath,
    validatorArgs: ['-e', script],
  })

  assert.equal(result.ok, true)
  assert.equal(result.stage, 'external')
  assert.equal(result.summary.exportableTransactions, 1)
  assert.equal(result.summary.blockers, 0)
  assert.deepEqual(result.blockers, [])
  assert.equal(result.validation?.status, 'passed')
  assert.equal(result.validation?.stdout, 'promotion checked')
})

test('promotion Beancount validation stops at preflight blockers before invoking the external checker', () => {
  writeLedger([
    'Assets:US:Banks:PromotionChecking',
  ])
  const accountId = insertAccount()
  insertTransaction({
    id: 'txn-promotion-blocked',
    accountId,
    amount: '-9.00',
    description: 'Missing category',
    category: 'Expenses:Missing',
  })

  const result = validatePromotionBeancountExport({
    period: '2026-04',
    beancountRoot,
    validationMode: 'required',
    validatorCommand: process.execPath,
    validatorArgs: ['-e', 'process.exit(99)'],
  })

  assert.equal(result.ok, false)
  assert.equal(result.stage, 'preflight')
  assert.equal(result.summary.exportableTransactions, 0)
  assert.equal(result.summary.blockers, 1)
  assert.equal(result.validation, null)
  assert.equal(result.blockers.some(issue => issue.code === 'category_not_open'), true)
})
