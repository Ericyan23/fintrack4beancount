import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InvestmentActivityType, InvestmentOptionType, InvestmentPositionEffect } from '../lib/ingest/types'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-beancount-investments-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const { renderBeancountDraft } = require('../lib/export/beancount') as typeof import('../lib/export/beancount')
const { runBeancountPreflight } = require('../lib/export/preflight') as typeof import('../lib/export/preflight')

const tradeDate = Math.floor(Date.UTC(2026, 3, 20) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM investment_positions;
    DELETE FROM investment_activities;
    DELETE FROM securities;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function writeLedger(extraAccounts: string[] = []): void {
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Investment Export Test"',
      '2026-01-01 open Assets:US:Fidelity:Brokerage USD',
      '2026-01-01 open Expenses:Fees:Financial USD',
      '2026-01-01 open Income:Investment:Dividends USD',
      '2026-01-01 open Income:Investment:Interest USD',
      '2026-01-01 open Income:Investments:Trading USD',
      ...extraAccounts.map(account => `2026-01-01 open ${account} USD`),
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
    tradeDate,
    'investment-test',
    'Fidelity',
    'fidelity.test',
    'investment',
    null,
    'Assets:US:Fidelity:Brokerage',
    tradeDate,
  )
}

function insertSecurity(input: {
  id: string
  sourceSymbol: string
  commodity: string | null
  name?: string
  instrumentType?: string
  optionType?: string | null
  expirationDate?: string | null
  strikePrice?: string | null
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
    input.name ?? input.sourceSymbol,
    input.instrumentType ?? 'option',
    'FCT',
    input.sourceSymbol,
    input.optionType ?? 'call',
    input.expirationDate ?? '2025-06-20',
    input.strikePrice ?? '50',
    input.commodity,
    JSON.stringify({ fixture: true }),
    tradeDate,
    tradeDate,
  )
}

function insertInvestmentActivity(input: {
  id: string
  securityId?: string | null
  activityType: InvestmentActivityType
  instrumentType?: string
  positionEffect?: InvestmentPositionEffect
  optionType?: InvestmentOptionType
  quantity?: string | null
  price?: string | null
  amount: string
  commission?: string | null
  fees?: string | null
  action: string
  description?: string
  status?: string
}): void {
  sqlite.prepare(`
    INSERT INTO investment_activities (
      id,
      account_id,
      security_id,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    'acct-fidelity',
    input.securityId ?? null,
    tradeDate,
    '2026-04-21',
    input.activityType,
    input.instrumentType ?? 'option',
    input.positionEffect ?? 'none',
    input.optionType ?? null,
    input.quantity ?? null,
    input.price ?? null,
    input.amount,
    'USD',
    input.commission ?? null,
    input.fees ?? null,
    null,
    null,
    input.action,
    input.description ?? input.action,
    input.status ?? 'reviewed',
    JSON.stringify([]),
    JSON.stringify({ fixture: true }),
    'fidelity-brokerage-csv-v1',
    tradeDate,
    tradeDate,
  )
}

beforeEach(() => {
  resetDb()
  writeLedger()
  insertInvestmentAccount()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('preflight emits and renders reviewed buy-to-open option activity', () => {
  insertSecurity({
    id: 'security-buy-open-call',
    sourceSymbol: '-FCT250620C50',
    commodity: 'FCT250620C50',
  })
  insertInvestmentActivity({
    id: 'investment-buy-open-call',
    securityId: 'security-buy-open-call',
    activityType: 'buy',
    positionEffect: 'open',
    optionType: 'call',
    quantity: '1',
    price: '1.25',
    amount: '-125.65',
    commission: '0.65',
    action: 'YOU BOUGHT OPENING TRANSACTION CALL',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]
  const draft = renderBeancountDraft(result, { generatedAt: new Date('2026-05-15T12:00:00.000Z') })

  assert.equal(result.ok, true)
  assert.equal(result.summary.investmentActivitiesScanned, 1)
  assert.equal(result.summary.exportableInvestmentActivities, 1)
  assert.equal(result.exportableInvestmentActivities?.length, 1)
  assert.equal(intent.kind, 'investment_activity')
  assert.equal(intent.sourceId, 'fintrack:investment:investment-buy-open-call')
  assert.deepEqual(intent.transactionIds, [])
  assert.deepEqual(intent.postings.map(posting => ({
    account: posting.account,
    amount: posting.amount,
    currency: posting.currency,
    role: posting.role,
    cost: posting.cost,
  })), [
    {
      account: 'Assets:US:Fidelity:Brokerage',
      amount: '1',
      currency: 'FCT250620C50',
      role: 'investment_security',
      cost: { amount: '125.00', currency: 'USD' },
    },
    {
      account: 'Assets:US:Fidelity:Brokerage',
      amount: '-125.65',
      currency: 'USD',
      role: 'investment_cash',
      cost: undefined,
    },
    {
      account: 'Expenses:Fees:Financial',
      amount: '0.65',
      currency: 'USD',
      role: 'investment_fee',
      cost: undefined,
    },
  ])
  assert.match(draft, /2026-04-20 \* "YOU BOUGHT OPENING TRANSACTION CALL"/)
  assert.match(draft, /source_id: "fintrack:investment:investment-buy-open-call"/)
  assert.match(draft, /Assets:US:Fidelity:Brokerage\s+1 FCT250620C50 \{125\.00 USD\}/)
  assert.match(draft, /Assets:US:Fidelity:Brokerage\s+-125\.65 USD/)
  assert.match(draft, /Expenses:Fees:Financial\s+0\.65 USD/)
})

test('preflight blocks sell-to-close option activity without explicit lot, cost basis, or override', () => {
  insertSecurity({
    id: 'security-sell-close-put',
    sourceSymbol: '-FCT250620P45',
    commodity: 'FCT250620P45',
    optionType: 'put',
    strikePrice: '45',
  })
  insertInvestmentActivity({
    id: 'investment-sell-close-put',
    securityId: 'security-sell-close-put',
    activityType: 'sell',
    positionEffect: 'close',
    optionType: 'put',
    quantity: '1',
    price: '2.10',
    amount: '209.35',
    commission: '0.65',
    action: 'YOU SOLD CLOSING TRANSACTION PUT',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.reviewItems.length, 0)
  assert.equal(result.summary.exportableInvestmentActivities, 0)
  assert.equal(result.exportableInvestmentActivities?.length, 0)
  assert.equal(result.exportableIntents.length, 0)
  assert.equal(result.blockers.length, 1)
  assert.equal(result.blockers[0].code, 'investment_pnl_requires_lot_review')
  assert.equal(result.blockers[0].severity, 'blocker')
  assert.equal(result.blockers[0].investmentActivityId, 'investment-sell-close-put')
  assert.match(
    result.blockers[0].message,
    /requires explicit lot, cost basis, or manual override/,
  )
  assert.throws(
    () => renderBeancountDraft(result, { generatedAt: new Date('2026-05-15T12:00:00.000Z') }),
    /Cannot render Beancount draft while preflight has blockers/,
  )
})

test('preflight blocks buy-to-close option activity without explicit lot, cost basis, or override', () => {
  insertSecurity({
    id: 'security-buy-close-call',
    sourceSymbol: '-FCT250620C50',
    commodity: 'FCT250620C50',
  })
  insertInvestmentActivity({
    id: 'investment-buy-close-call',
    securityId: 'security-buy-close-call',
    activityType: 'buy',
    positionEffect: 'close',
    optionType: 'call',
    quantity: '1',
    price: '0.50',
    amount: '-50.65',
    commission: '0.65',
    action: 'YOU BOUGHT CLOSING TRANSACTION CALL',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.summary.exportableInvestmentActivities, 0)
  assert.equal(result.exportableIntents.length, 0)
  assert.equal(result.blockers.length, 1)
  assert.equal(result.blockers[0].code, 'investment_pnl_requires_lot_review')
  assert.equal(result.blockers[0].severity, 'blocker')
  assert.equal(result.blockers[0].investmentActivityId, 'investment-buy-close-call')
})

test('preflight blocks transfer-in-kind style investment rows as unsupported', () => {
  insertSecurity({
    id: 'security-transfer-kind',
    sourceSymbol: 'FCT',
    commodity: 'FCT',
    instrumentType: 'equity',
  })
  insertInvestmentActivity({
    id: 'investment-transfer-kind',
    securityId: 'security-transfer-kind',
    activityType: 'other',
    instrumentType: 'equity',
    positionEffect: 'none',
    optionType: null,
    quantity: '10',
    price: null,
    amount: '0.00',
    action: 'TRANSFER OF ASSETS IN KIND',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.summary.exportableInvestmentActivities, 0)
  assert.equal(result.exportableIntents.length, 0)
  assert.equal(result.blockers.length, 1)
  assert.equal(result.blockers[0].code, 'unsupported_investment_activity_type')
  assert.equal(result.blockers[0].severity, 'blocker')
  assert.equal(result.blockers[0].investmentActivityId, 'investment-transfer-kind')
  assert.match(result.blockers[0].message, /not exportable yet/)
})

test('dividend activity renders cash and dividend income postings', () => {
  insertSecurity({
    id: 'security-dividend-equity',
    sourceSymbol: 'FCT',
    commodity: 'FCT',
    instrumentType: 'equity',
  })
  insertInvestmentActivity({
    id: 'investment-dividend',
    securityId: 'security-dividend-equity',
    activityType: 'dividend',
    instrumentType: 'equity',
    positionEffect: 'none',
    quantity: null,
    price: null,
    amount: '12.50',
    action: 'DIVIDEND RECEIVED FICTCORP',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]
  const draft = renderBeancountDraft(result, { generatedAt: new Date('2026-05-15T12:00:00.000Z') })

  assert.equal(result.ok, true)
  assert.equal(result.blockers.length, 0)
  assert.equal(intent.kind, 'investment_activity')
  assert.deepEqual(intent.postings.map(posting => ({
    account: posting.account,
    amount: posting.amount,
    currency: posting.currency,
    role: posting.role,
  })), [
    {
      account: 'Assets:US:Fidelity:Brokerage',
      amount: '12.50',
      currency: 'USD',
      role: 'investment_cash',
    },
    {
      account: 'Income:Investment:Dividends',
      amount: '-12.50',
      currency: 'USD',
      role: 'investment_income',
    },
  ])
  assert.match(draft, /Assets:US:Fidelity:Brokerage\s+12\.50 USD/)
  assert.match(draft, /Income:Investment:Dividends\s+-12\.50 USD/)
})

test('interest activity renders cash and interest income postings without a security', () => {
  insertInvestmentActivity({
    id: 'investment-interest',
    securityId: null,
    activityType: 'interest',
    instrumentType: 'cash',
    positionEffect: 'none',
    quantity: null,
    price: null,
    amount: '4.20',
    action: 'INTEREST EARNED',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]
  const draft = renderBeancountDraft(result, { generatedAt: new Date('2026-05-15T12:00:00.000Z') })

  assert.equal(result.ok, true)
  assert.equal(result.blockers.length, 0)
  assert.equal(intent.kind, 'investment_activity')
  assert.deepEqual(intent.postings.map(posting => ({
    account: posting.account,
    amount: posting.amount,
    currency: posting.currency,
    role: posting.role,
  })), [
    {
      account: 'Assets:US:Fidelity:Brokerage',
      amount: '4.20',
      currency: 'USD',
      role: 'investment_cash',
    },
    {
      account: 'Income:Investment:Interest',
      amount: '-4.20',
      currency: 'USD',
      role: 'investment_income',
    },
  ])
  assert.match(draft, /Assets:US:Fidelity:Brokerage\s+4\.20 USD/)
  assert.match(draft, /Income:Investment:Interest\s+-4\.20 USD/)
})

test('simple reinvested dividend renders security purchase and dividend income postings', () => {
  insertSecurity({
    id: 'security-reinvest-equity',
    sourceSymbol: 'FCT',
    commodity: 'FCT',
    instrumentType: 'equity',
  })
  insertInvestmentActivity({
    id: 'investment-reinvest-dividend',
    securityId: 'security-reinvest-equity',
    activityType: 'reinvest_dividend',
    instrumentType: 'equity',
    positionEffect: 'none',
    quantity: '0.25',
    price: '40.00',
    amount: '10.00',
    action: 'REINVESTMENT FICTCORP',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })
  const intent = result.exportableIntents[0]
  const draft = renderBeancountDraft(result, { generatedAt: new Date('2026-05-15T12:00:00.000Z') })

  assert.equal(result.ok, true)
  assert.equal(result.blockers.length, 0)
  assert.equal(result.reviewItems.length, 1)
  assert.equal(result.reviewItems[0].code, 'reinvest_dividend_requires_review')
  assert.equal(intent.kind, 'investment_activity')
  assert.deepEqual(intent.postings.map(posting => ({
    account: posting.account,
    amount: posting.amount,
    currency: posting.currency,
    role: posting.role,
    cost: posting.cost,
  })), [
    {
      account: 'Assets:US:Fidelity:Brokerage',
      amount: '0.25',
      currency: 'FCT',
      role: 'investment_security',
      cost: { amount: '40.00', currency: 'USD' },
    },
    {
      account: 'Income:Investment:Dividends',
      amount: '-10.00',
      currency: 'USD',
      role: 'investment_income',
      cost: undefined,
    },
  ])
  assert.match(draft, /Assets:US:Fidelity:Brokerage\s+0\.25 FCT \{40\.00 USD\}/)
  assert.match(draft, /Income:Investment:Dividends\s+-10\.00 USD/)
})

test('preflight blocks reviewed investment activity without security commodity mapping', () => {
  insertSecurity({
    id: 'security-unmapped',
    sourceSymbol: 'FCT',
    commodity: null,
    instrumentType: 'equity',
  })
  insertInvestmentActivity({
    id: 'investment-unmapped',
    securityId: 'security-unmapped',
    activityType: 'buy',
    positionEffect: 'open',
    optionType: 'call',
    quantity: '10',
    price: '50.00',
    amount: '-500.00',
    action: 'YOU BOUGHT FICTCORP',
  })

  const result = runBeancountPreflight({ period: '2026-04', beancountRoot })

  assert.equal(result.ok, false)
  assert.equal(result.exportableIntents.length, 0)
  assert.equal(result.blockers.some(blocker => blocker.code === 'missing_security_mapping'), true)
})
