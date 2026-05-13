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
