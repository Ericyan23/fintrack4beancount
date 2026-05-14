import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-balance-assertion-candidates-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  runBalanceAssertionPreflight,
} = require('../lib/export/balance-assertions') as typeof import('../lib/export/balance-assertions')

const posted = Math.floor(Date.UTC(2026, 3, 30) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM balance_assertions;
    DELETE FROM accounts;
  `)
}

function writeLedger(): void {
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Balance Assertion Candidate Test"',
      '2026-01-01 open Assets:US:Banks:Checking USD',
      '',
    ].join('\n'),
  )
}

function insertAccount(): void {
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
    '1234.56',
    posted,
    'candidate-test',
    'Example Bank',
    'example.test',
    'depository',
    null,
    'Assets:US:Banks:Checking',
    posted,
  )
}

function insertBalanceAssertion(input: {
  id: string
  beancountAccount: string
  sourceId: string
  amount?: string
  note?: string | null
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
    'acct-checking',
    input.beancountAccount,
    '2026-04-30',
    input.amount ?? '1234.56',
    'USD',
    input.sourceId,
    'draft',
    input.note ?? null,
    posted,
    posted,
  )
}

beforeEach(() => {
  resetDb()
  writeLedger()
  insertAccount()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('balance assertion preflight exposes exportable balance assertion candidates', () => {
  insertBalanceAssertion({
    id: 'assertion-valid',
    beancountAccount: 'Assets:US:Banks:Checking',
    sourceId: 'fintrack:balance:acct-checking:2026-04-30',
    note: 'Statement balance',
  })
  insertBalanceAssertion({
    id: 'assertion-blocked',
    beancountAccount: 'Assets:US:Banks:Missing',
    sourceId: 'fintrack:balance:acct-checking:blocked',
  })

  const result = runBalanceAssertionPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.summary.exportableAssertions, 1)
  assert.deepEqual(result.exportableAssertions.map(assertion => assertion.id), ['assertion-valid'])
  assert.deepEqual(result.exportableCandidates, [
    {
      id: 'candidate:balance:assertion-valid',
      kind: 'balance_assertion',
      sourceId: 'fintrack:balance:acct-checking:2026-04-30',
      date: '2026-04-30',
      account: 'Assets:US:Banks:Checking',
      amount: '1234.56',
      currency: 'USD',
      fintrackAccountId: 'acct-checking',
      note: 'Statement balance',
    },
  ])
  assert.equal(
    result.exportableCandidates.some(candidate =>
      candidate.sourceId === 'fintrack:balance:acct-checking:blocked'
    ),
    false,
  )
  assert.ok(
    result.blockers.some(issue =>
      issue.balanceAssertionId === 'assertion-blocked' &&
      issue.code === 'balance_account_not_open'
    ),
    `Expected blocked assertion issue, got ${JSON.stringify(result.blockers)}`,
  )
})
