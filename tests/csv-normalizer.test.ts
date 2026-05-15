import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildCsvSourceItemKey, normalizeCsvTransactions } from '../lib/ingest/csv'
import { readFixture } from './helpers/fixtures'

describe('CSV ingestion normalizer', () => {
  test('detects the generic bank CSV mapping', () => {
    const csv = readFixture('csv', 'generic-bank.csv')
    const result = normalizeCsvTransactions(csv)

    assert.deepEqual(result.columns, [
      'Date',
      'Description',
      'Amount',
      'Account',
      'Category',
      'Notes',
      'Tags',
      'Status',
      'External ID',
    ])
    assert.deepEqual(result.mapping, {
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
      account: 'Account',
      category: 'Category',
      notes: 'Notes',
      tags: 'Tags',
      status: 'Status',
      externalId: 'External ID',
    })
    assert.equal(result.totalRows, 3)
    assert.equal(result.validRows, 3)
    assert.equal(result.errorRows, 0)
    assert.equal(result.parserProfile, null)
  })

  test('normalizes posted and pending rows without converting amounts to numbers', () => {
    const csv = readFixture('csv', 'generic-bank.csv')
    const result = normalizeCsvTransactions(csv)

    assert.equal(result.rows[0].status, 'posted')
    assert.equal(result.rows[0].pending, false)
    assert.equal(result.rows[0].amount, '-4.75')
    assert.equal(typeof result.rows[0].amount, 'string')

    assert.equal(result.rows[1].status, 'posted')
    assert.equal(result.rows[1].amount, '1250.00')

    assert.equal(result.rows[2].status, 'pending')
    assert.equal(result.rows[2].pending, true)
    assert.equal(result.rows[2].amount, '-42.10')
  })

  test('keeps category, notes, and tags as editable staging fields', () => {
    const csv = readFixture('csv', 'generic-bank.csv')
    const result = normalizeCsvTransactions(csv)

    assert.deepEqual(result.rows[0], {
      rowNumber: 2,
      posted: 1775001600,
      date: '2026-04-01',
      amount: '-4.75',
      description: 'Coffee Shop "Downtown"',
      accountName: 'Main Checking',
      externalAccountId: 'Main Checking',
      sourceAccountId: null,
      pending: false,
      status: 'posted',
      category: 'Expenses:Food:Coffee',
      notes: 'Morning coffee',
      tags: ['coffee', 'work'],
      externalId: 'bank-csv-001',
      sourceItemKey: null,
      sourceItemIdentityInput: null,
      parserProfileId: null,
      investmentActivity: null,
      rawPayload: {
        rowNumber: 2,
        columns: result.columns,
        values: [
          '2026-04-01',
          'Coffee Shop "Downtown"',
          '-4.75',
          'Main Checking',
          'Expenses:Food:Coffee',
          'Morning coffee',
          'coffee;work',
          'posted',
          'bank-csv-001',
        ],
        row: {
          Date: '2026-04-01',
          Description: 'Coffee Shop "Downtown"',
          Amount: '-4.75',
          Account: 'Main Checking',
          Category: 'Expenses:Food:Coffee',
          Notes: 'Morning coffee',
          Tags: 'coffee;work',
          Status: 'posted',
          'External ID': 'bank-csv-001',
        },
      },
      validationErrors: [],
    })
    assert.equal(result.rows[1].notes, null)
    assert.deepEqual(result.rows[1].tags, ['paycheck'])
    assert.equal(result.rows[2].category, 'Expenses:Auto:Fuel')
  })

  test('produces the same source item key for duplicate external IDs', () => {
    const csv = readFixture('csv', 'duplicate-import.csv')
    const result = normalizeCsvTransactions(csv, {
      sourceAccountId: 'source-account-main-checking',
    })

    assert.equal(result.totalRows, 2)
    assert.equal(result.validRows, 2)
    assert.equal(result.rows[0].externalId, 'duplicate-001')
    assert.equal(result.rows[1].externalId, 'duplicate-001')
    assert.equal(result.rows[0].sourceItemKey, 'source-account:source-account-main-checking:external:duplicate-001')
    assert.equal(result.rows[0].sourceItemKey, result.rows[1].sourceItemKey)
    assert.equal(result.rows[0].sourceItemIdentityInput?.sourceAccountId, 'source-account-main-checking')
    assert.equal(result.rows[1].sourceItemIdentityInput?.sourceAccountId, 'source-account-main-checking')
    assert.equal(result.rows[0].sourceItemIdentityInput?.externalId, 'duplicate-001')
    assert.equal(result.rows[1].sourceItemIdentityInput?.externalId, 'duplicate-001')
  })

  test('keeps fallback keys stable when editable CSV fields or columns change', () => {
    const first = normalizeCsvTransactions(
      [
        'Date,Description,Amount,Account,Category,Notes,Tags,Status',
        '2026-05-01,Coffee Shop,-3.50,Main Checking,Expenses:Food:Coffee,Morning,coffee,posted',
      ].join('\n'),
    )
    const edited = normalizeCsvTransactions(
      [
        'Extra,Tags,Notes,Status,Account,Amount,Description,Date,Category',
        'ignored,reviewed;tax,Edited note,posted,Main Checking,-3.50,Coffee Shop,2026-05-01,Expenses:Reviewed',
      ].join('\n'),
    )

    const sourceAccountId = 'source-account-main-checking'
    assert.equal(first.rows[0].externalId, null)
    assert.equal(edited.rows[0].externalId, null)
    assert.equal(
      buildCsvSourceItemKey(first.rows[0], sourceAccountId),
      buildCsvSourceItemKey(edited.rows[0], sourceAccountId),
    )
  })
})

describe('Fidelity brokerage CSV', () => {
  test('auto-detects Run Date / Action / Amount ($) columns despite UTF-8 BOM', () => {
    const csv = readFixture('csv', 'fidelity-brokerage.csv')
    const result = normalizeCsvTransactions(csv)

    assert.equal(result.parserProfile?.id, 'fidelity-brokerage-csv')
    assert.equal(result.mapping.date, 'Run Date')
    assert.equal(result.mapping.description, 'Action')
    assert.equal(result.mapping.amount, 'Amount ($)')
  })

  test('parses all 5 transaction rows and skips footer disclaimer rows', () => {
    const csv = readFixture('csv', 'fidelity-brokerage.csv')
    const result = normalizeCsvTransactions(csv)

    assert.equal(result.totalRows, 5, 'footer disclaimer rows must be excluded')
    // No account column in Fidelity CSV — all rows have "Missing account" error, which is expected
    const amountErrors = result.rows.filter(r =>
      r.validationErrors.some(e => e === 'Invalid amount' || e === 'Invalid date'),
    )
    assert.equal(amountErrors.length, 0, 'no date or amount parse errors')
  })

  test('correctly parses amounts including negative stock purchases and positive sales', () => {
    const csv = readFixture('csv', 'fidelity-brokerage.csv')
    const result = normalizeCsvTransactions(csv)

    const [deposit, buy, dividend, transfer, sell] = result.rows
    assert.equal(deposit.amount, '2500.00')
    assert.equal(buy.amount, '-500.00')
    assert.equal(dividend.amount, '12.50')
    assert.equal(transfer.amount, '-200.00')
    assert.equal(sell.amount, '549.35')
  })

  test('parses MM/DD/YYYY dates', () => {
    const csv = readFixture('csv', 'fidelity-brokerage.csv')
    const result = normalizeCsvTransactions(csv)

    assert.ok(result.rows[0].posted !== null, 'date should parse')
    assert.equal(result.rows[0].date, '04/01/2025')
  })

  test('extracts Fidelity investment activity metadata without treating it as cash ledger data', () => {
    const csv = readFixture('csv', 'fidelity-brokerage.csv')
    const result = normalizeCsvTransactions(csv)

    const [, buy, dividend,, sell] = result.rows
    assert.equal(buy.parserProfileId, 'fidelity-brokerage-csv')
    assert.equal(buy.investmentActivity?.activityType, 'buy')
    assert.equal(buy.investmentActivity?.symbol, 'FCT')
    assert.equal(buy.investmentActivity?.quantity, '10')
    assert.equal(buy.investmentActivity?.price, '50.00')
    assert.equal(dividend.investmentActivity?.activityType, 'dividend')
    assert.equal(sell.investmentActivity?.activityType, 'sell')
    assert.equal(result.parserProfile?.blocksCashPromotion, true)
  })
})
