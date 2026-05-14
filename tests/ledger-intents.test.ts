import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  BalanceAssertionCandidateInput,
  LedgerIntentTransactionInput,
  LedgerIntentTransferInput,
} from '../lib/export/ledger-intents'

const {
  exportCandidateFromBalanceAssertion,
  ledgerIntentFromTransaction,
  ledgerIntentFromTransfer,
  negateDecimalString,
} = require('../lib/export/ledger-intents') as typeof import('../lib/export/ledger-intents')

function transaction(overrides: Partial<LedgerIntentTransactionInput> = {}): LedgerIntentTransactionInput {
  return {
    id: 'txn-cash-001',
    sourceId: 'fintrack:acct-checking:txn-cash-001',
    date: '2026-04-01',
    description: 'Coffee Shop',
    amount: '-4.75',
    beancountAccount: 'Assets:US:Banks:Checking',
    category: 'Expenses:Food:Coffee',
    currency: 'USD',
    ...overrides,
  }
}

test('cash transaction produces source and category postings', () => {
  const input = transaction()

  assert.deepEqual(ledgerIntentFromTransaction(input), {
    id: 'intent:transaction:txn-cash-001',
    kind: 'cash_transaction',
    sourceId: 'fintrack:acct-checking:txn-cash-001',
    date: '2026-04-01',
    description: 'Coffee Shop',
    postings: [
      {
        account: 'Assets:US:Banks:Checking',
        amount: '-4.75',
        currency: 'USD',
        role: 'source',
        transactionId: 'txn-cash-001',
      },
      {
        account: 'Expenses:Food:Coffee',
        amount: '4.75',
        currency: 'USD',
        role: 'category',
        transactionId: 'txn-cash-001',
      },
    ],
    transactionIds: ['txn-cash-001'],
  })
})

test('split transaction produces source and split counter-postings', () => {
  const input = transaction({
    id: 'txn-split-001',
    sourceId: 'fintrack:acct-checking:txn-split-001',
    amount: '-10.00',
    category: null,
    splitPostings: [
      {
        id: 'split:txn-split-001:0',
        parentTransactionId: 'txn-split-001',
        amount: '-4.25',
        currency: 'USD',
        ledgerAccount: 'Expenses:Food:Groceries',
        memo: 'Groceries',
        notes: null,
      },
      {
        id: 'split:txn-split-001:1',
        parentTransactionId: 'txn-split-001',
        amount: '-5.75',
        currency: 'USD',
        ledgerAccount: 'Expenses:Office',
        memo: null,
        notes: 'Supplies',
      },
    ],
  })

  assert.deepEqual(ledgerIntentFromTransaction(input), {
    id: 'intent:transaction:txn-split-001',
    kind: 'split_transaction',
    sourceId: 'fintrack:acct-checking:txn-split-001',
    date: '2026-04-01',
    description: 'Coffee Shop',
    postings: [
      {
        account: 'Assets:US:Banks:Checking',
        amount: '-10.00',
        currency: 'USD',
        role: 'source',
        transactionId: 'txn-split-001',
      },
      {
        account: 'Expenses:Food:Groceries',
        amount: '4.25',
        currency: 'USD',
        role: 'split',
        transactionId: 'txn-split-001',
        splitId: 'split:txn-split-001:0',
        memo: 'Groceries',
        notes: null,
      },
      {
        account: 'Expenses:Office',
        amount: '5.75',
        currency: 'USD',
        role: 'split',
        transactionId: 'txn-split-001',
        splitId: 'split:txn-split-001:1',
        memo: null,
        notes: 'Supplies',
      },
    ],
    transactionIds: ['txn-split-001'],
  })
})

test('confirmed transfer produces paired transfer postings', () => {
  const input: LedgerIntentTransferInput = {
    id: 42,
    sourceId: 'fintrack:transfer:42',
    date: '2026-04-03',
    outflow: transaction({
      id: 'txn-transfer-out',
      sourceId: 'fintrack:acct-checking:txn-transfer-out',
      date: '2026-04-03',
      description: 'Credit Card Payment',
      amount: '-120.00',
      beancountAccount: 'Assets:US:Banks:Checking',
      category: 'Transfer:CreditCardPayment',
    }),
    inflow: transaction({
      id: 'txn-transfer-in',
      sourceId: 'fintrack:acct-card:txn-transfer-in',
      date: '2026-04-03',
      description: 'Payment Received',
      amount: '120.00',
      beancountAccount: 'Liabilities:US:CreditCard',
      category: 'Transfer:CreditCardPayment',
    }),
  }

  assert.deepEqual(ledgerIntentFromTransfer(input), {
    id: 'intent:transfer:42',
    kind: 'confirmed_transfer',
    sourceId: 'fintrack:transfer:42',
    date: '2026-04-03',
    description: 'Transfer',
    postings: [
      {
        account: 'Assets:US:Banks:Checking',
        amount: '-120.00',
        currency: 'USD',
        role: 'transfer',
        transactionId: 'txn-transfer-out',
      },
      {
        account: 'Liabilities:US:CreditCard',
        amount: '120.00',
        currency: 'USD',
        role: 'transfer',
        transactionId: 'txn-transfer-in',
      },
    ],
    transactionIds: ['txn-transfer-out', 'txn-transfer-in'],
    transferMatchId: 42,
  })
})

test('balance assertion adapter produces a balance assertion candidate', () => {
  const assertion: BalanceAssertionCandidateInput = {
    id: 'assertion-001',
    sourceId: 'fintrack:balance:acct-checking:2026-04-30',
    assertionDate: '2026-04-30',
    beancountAccount: 'Assets:US:Banks:Checking',
    amount: '1234.56',
    currency: 'USD',
    fintrackAccountId: 'acct-checking',
    note: 'Statement balance',
  }

  assert.deepEqual(exportCandidateFromBalanceAssertion(assertion), {
    id: 'candidate:balance:assertion-001',
    kind: 'balance_assertion',
    sourceId: 'fintrack:balance:acct-checking:2026-04-30',
    date: '2026-04-30',
    account: 'Assets:US:Banks:Checking',
    amount: '1234.56',
    currency: 'USD',
    fintrackAccountId: 'acct-checking',
    note: 'Statement balance',
  })
})

test('negateDecimalString handles positive, negative, and zero strings', () => {
  assert.equal(negateDecimalString('12.34'), '-12.34')
  assert.equal(negateDecimalString('-12.34'), '12.34')
  assert.equal(negateDecimalString('0'), '0')
  assert.equal(negateDecimalString('0.00'), '0.00')
  assert.equal(negateDecimalString('-0.00'), '0.00')
})
