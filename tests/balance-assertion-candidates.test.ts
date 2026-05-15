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
  renderBalanceAssertionDraft,
  runBalanceAssertionPreflight,
} = require('../lib/export/balance-assertions') as typeof import('../lib/export/balance-assertions')

const posted = Math.floor(Date.UTC(2026, 3, 30) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM investment_positions;
    DELETE FROM securities;
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
      '2026-01-01 open Assets:US:Fidelity:Brokerage USD',
      '',
    ].join('\n'),
  )
}

function insertInvestmentAccount(): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-fidelity',
    'Fidelity Brokerage',
    'USD',
    '0.00',
    posted,
    'candidate-test',
    'Fidelity',
    'fidelity.test',
    'investment',
    null,
    'Assets:US:Fidelity:Brokerage',
    posted,
  )
}

function insertSecurity(input: {
  id: string
  sourceSymbol: string
  commodity: string | null
}): void {
  sqlite.prepare(`
    INSERT INTO securities (
      id,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.sourceSymbol,
    input.sourceSymbol,
    'equity',
    null,
    null,
    null,
    null,
    null,
    input.commodity,
    JSON.stringify({ fixture: true }),
    posted,
    posted,
  )
}

function insertInvestmentPosition(input: {
  id: string
  securityId: string
  quantity: string
  asOfDate?: string
}): void {
  sqlite.prepare(`
    INSERT INTO investment_positions (
      id,
      source_connection_id,
      source_account_id,
      account_id,
      security_id,
      as_of_date,
      quantity,
      market_value,
      price,
      currency,
      raw_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    null,
    null,
    'acct-fidelity',
    input.securityId,
    input.asOfDate ?? '2026-04-30',
    input.quantity,
    '493.824',
    '40.00',
    'USD',
    JSON.stringify({ fixture: true }),
    posted,
    posted,
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
  insertInvestmentAccount()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('investment positions become Beancount position balance assertion candidates', () => {
  insertSecurity({
    id: 'security-fct',
    sourceSymbol: 'FCT',
    commodity: 'FCT',
  })
  insertInvestmentPosition({
    id: 'position-fct-2026-04-30',
    securityId: 'security-fct',
    quantity: '12.3456',
  })

  const result = runBalanceAssertionPreflight({ period: '2026-04', beancountRoot })
  const draft = renderBalanceAssertionDraft(result, { generatedAt: new Date('2026-05-15T12:00:00.000Z') })

  assert.equal(result.ok, true)
  assert.equal(result.summary.assertionsScanned, 1)
  assert.equal(result.summary.positionAssertionsScanned, 1)
  assert.equal(result.summary.exportableAssertions, 1)
  assert.equal(result.summary.exportablePositionAssertions, 1)
  assert.deepEqual(result.exportableCandidates, [
    {
      id: 'candidate:balance:position:position-fct-2026-04-30',
      kind: 'balance_assertion',
      sourceId: 'fintrack:position:position-fct-2026-04-30',
      date: '2026-04-30',
      account: 'Assets:US:Fidelity:Brokerage',
      amount: '12.3456',
      currency: 'FCT',
      fintrackAccountId: 'acct-fidelity',
      note: 'Investment position FCT; market value 493.824 USD',
    },
  ])
  assert.match(draft, /2026-04-30 balance Assets:US:Fidelity:Brokerage\s+12\.3456 FCT/)
  assert.match(draft, /source_id: "fintrack:position:position-fct-2026-04-30"/)
  assert.match(draft, /fintrack_note: "Investment position FCT; market value 493\.824 USD"/)
})

test('investment positions without security commodity mappings are blocked', () => {
  insertSecurity({
    id: 'security-unmapped',
    sourceSymbol: 'FCT',
    commodity: null,
  })
  insertInvestmentPosition({
    id: 'position-unmapped',
    securityId: 'security-unmapped',
    quantity: '1',
  })

  const result = runBalanceAssertionPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.summary.positionAssertionsScanned, 1)
  assert.equal(result.summary.exportablePositionAssertions, 0)
  assert.equal(result.exportableCandidates.length, 0)
  assert.ok(
    result.blockers.some(issue =>
      issue.balanceAssertionId === 'position:position-unmapped' &&
      issue.code === 'missing_position_commodity_mapping'
    ),
    `Expected missing commodity mapping issue, got ${JSON.stringify(result.blockers)}`,
  )
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
