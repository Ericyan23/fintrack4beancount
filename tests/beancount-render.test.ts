import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFixture } from './helpers/fixtures'
import type { BeancountPreflightResult, PreflightTransaction } from '../lib/export/preflight'

const { renderBeancountDraft } = require('../lib/export/beancount') as typeof import('../lib/export/beancount')

const checkingAccount = 'Assets:US:Banks:MainChecking'

function transaction(overrides: Partial<PreflightTransaction>): PreflightTransaction {
  return {
    id: 'csv:bank-csv-001',
    sourceId: 'fintrack:acct-checking:csv:bank-csv-001',
    date: '2026-04-01',
    description: 'Coffee Shop "Downtown"',
    amount: '-4.75',
    accountId: 'acct-checking',
    accountName: 'Main Checking',
    accountType: 'depository',
    accountTypeOverride: null,
    beancountAccount: checkingAccount,
    category: 'Expenses:Food:Coffee',
    currency: 'USD',
    ...overrides,
  }
}

test('renders a stable Beancount draft snapshot', () => {
  const preflight: BeancountPreflightResult = {
    ok: true,
    period: '2026-04',
    dateRange: { start: '2026-04-01', end: '2026-04-30' },
    beancountRoot: '/tmp/beancount-test',
    ledger: { filesScanned: 1, openAccounts: 4, sourceIds: 0 },
    proposedStaging: 'staging/2026-04/fintrack/draft/2026-04.bean',
    summary: {
      transactionsScanned: 4,
      exportableTransactions: 2,
      mergedTransfers: 1,
      skipped: 2,
      blockers: 0,
      reviewItems: 0,
      duplicateCandidates: 0,
    },
    blockers: [],
    reviewItems: [],
    duplicateCandidates: [],
    skipped: [
      { transactionId: 'csv:card-payment-out', reason: 'merged_into_confirmed_transfer', transferMatchId: 7 },
      { transactionId: 'csv:card-payment-in', reason: 'merged_into_confirmed_transfer', transferMatchId: 7 },
    ],
    exportableTransactions: [
      transaction({}),
      transaction({
        id: 'csv:bank-csv-002',
        sourceId: 'fintrack:acct-checking:csv:bank-csv-002',
        date: '2026-04-02',
        description: 'Payroll',
        amount: '1250.00',
        category: 'Income:Salary',
      }),
    ],
    mergedTransfers: [
      {
        id: 7,
        sourceId: 'fintrack:pair:test-transfer',
        date: '2026-04-03',
        kind: 'credit_card_payment',
        outflow: transaction({
          id: 'csv:card-payment-out',
          sourceId: 'fintrack:acct-checking:csv:card-payment-out',
          date: '2026-04-03',
          description: 'Credit Card Payment',
          amount: '-120.00',
          category: 'Transfer:CreditCardPayment',
        }),
        inflow: transaction({
          id: 'csv:card-payment-in',
          sourceId: 'fintrack:acct-card:csv:card-payment-in',
          date: '2026-04-03',
          description: 'Payment Received',
          amount: '120.00',
          accountId: 'acct-card',
          accountName: 'Rewards Card',
          accountType: 'credit',
          beancountAccount: 'Liabilities:US:CreditCard',
          category: 'Transfer:CreditCardPayment',
        }),
      },
    ],
  }

  assert.equal(
    renderBeancountDraft(preflight, { generatedAt: new Date('2026-05-13T12:00:00.000Z') }),
    readFixture('beancount', 'expected-draft.bean'),
  )
})
