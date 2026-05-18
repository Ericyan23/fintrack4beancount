import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSourceItemKey } from '../lib/ingest/identity'
import {
  buildSimpleFinSourceAccountId,
  normalizeSimpleFinPayload,
  SIMPLEFIN_NORMALIZER_VERSION,
  simpleFinUnixDate,
  type SimpleFinPayload,
} from '../lib/ingest/simplefin'
import { readJsonFixture } from './helpers/fixtures'

test('normalizes SimpleFIN accounts, balances, and transactions into ingestion DTOs', () => {
  const payload = readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
  const result = normalizeSimpleFinPayload(payload, {
    sourceConnectionId: 'simplefin-conn-001',
  })

  assert.equal(result.errors.length, 0)
  assert.equal(result.accounts.length, 2)
  assert.equal(result.balances.length, 2)
  assert.equal(result.transactions.length, 7)

  const checkingAccount = result.accounts.find(account => account.externalAccountId === 'simplefin-checking-001')
  const creditAccount = result.accounts.find(account => account.externalAccountId === 'simplefin-credit-001')

  assert.ok(checkingAccount)
  assert.ok(creditAccount)
  assert.equal(checkingAccount.sourceConnectionId, 'simplefin-conn-001')
  assert.equal(
    checkingAccount.sourceAccountId,
    buildSimpleFinSourceAccountId('simplefin-conn-001', 'simplefin-checking-001'),
  )
  assert.equal(checkingAccount.accountType, 'depository')
  assert.equal(creditAccount.accountType, 'credit')
  assert.equal(checkingAccount.balance?.date, '2026-04-01')
  assert.equal(checkingAccount.balance?.amount, '2048.25')
})

test('keeps SimpleFIN source item identity stable when user-editable fields later change', () => {
  const payload = readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
  const result = normalizeSimpleFinPayload(payload, {
    sourceConnectionId: 'simplefin-conn-001',
  })

  const payroll = result.transactions.find(transaction => transaction.externalId === 'sf-checking-payroll-001')

  assert.ok(payroll)
  assert.equal(payroll.normalizerVersion, SIMPLEFIN_NORMALIZER_VERSION)
  assert.equal(payroll.date, '2026-03-23')
  assert.equal(payroll.amount, '1500.00')
  assert.equal(payroll.pending, false)
  assert.equal(payroll.status, 'posted')
  assert.equal(
    payroll.sourceItemKey,
    buildSourceItemKey({
      sourceAccountId: payroll.sourceAccountId,
      externalId: payroll.externalId,
      date: payroll.date,
      amount: payroll.amount,
      description: payroll.description,
      rawPayload: payroll.rawPayload,
    }),
  )

  const editedDescriptionKey = buildSourceItemKey({
    sourceAccountId: payroll.sourceAccountId,
    externalId: payroll.externalId,
    date: payroll.date,
    amount: payroll.amount,
    description: 'Edited later in Ledger Prep',
  })

  assert.equal(editedDescriptionKey, payroll.sourceItemKey)
})

test('uses transacted-at as the normalized date for pending SimpleFIN transactions', () => {
  const payload = readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
  const result = normalizeSimpleFinPayload(payload, {
    sourceConnectionId: 'simplefin-conn-001',
  })

  const pendingFuel = result.transactions.find(
    transaction => transaction.externalId === 'sf-checking-pending-fuel-001',
  )
  const postedGrocery = result.transactions.find(transaction => transaction.externalId === 'sf-credit-grocery-001')

  assert.ok(pendingFuel)
  assert.equal(pendingFuel.date, '2026-03-25')
  assert.equal(pendingFuel.transactedAt, '2026-03-25')
  assert.equal(pendingFuel.amount, '-42.10')
  assert.equal(pendingFuel.pending, true)
  assert.equal(pendingFuel.status, 'pending')
  assert.equal(pendingFuel.rawPayload.accountId, 'simplefin-checking-001')
  assert.equal(
    (pendingFuel.rawPayload.transaction as { id?: string }).id,
    'sf-checking-pending-fuel-001',
  )

  assert.ok(postedGrocery)
  assert.equal(postedGrocery.date, '2026-03-23')
  assert.equal(postedGrocery.transactedAt, '2026-03-22')
})

test('normalizes provider errors and rejects malformed SimpleFIN transactions', () => {
  const result = normalizeSimpleFinPayload(
    {
      accounts: [
        {
          id: 'simplefin-checking-001',
          name: 'Main Checking',
          currency: 'USD',
          balance: '1.00',
          'balance-date': 1775001600,
          transactions: [
            {
              id: 'bad-transaction',
              posted: 0,
              amount: 'not-money',
              description: '',
            },
          ],
        },
      ],
      errors: [{ code: 'BAD_REQUEST', message: 'Bad request' }],
      errlist: [{ code: 'WARN', msg: 'Legacy warning' }],
    },
    { sourceConnectionId: 'simplefin-conn-001' },
  )

  assert.equal(simpleFinUnixDate(1775001600), '2026-04-01')
  assert.equal(result.accounts.length, 1)
  assert.equal(result.transactions.length, 0)
  assert.deepEqual(
    result.errors.map(error => error.code),
    [
      'BAD_REQUEST',
      'WARN',
      'invalid_transaction_date',
      'invalid_transaction_amount',
      'invalid_transaction_description',
    ],
  )
})

test('rejects SimpleFIN transactions without provider ids instead of creating unstable fallback keys', () => {
  const result = normalizeSimpleFinPayload(
    {
      accounts: [
        {
          id: 'simplefin-checking-001',
          name: 'Main Checking',
          currency: 'USD',
          balance: '1.00',
          'balance-date': 1775001600,
          transactions: [
            {
              posted: 0,
              'transacted-at': 1774396800,
              amount: '-42.10',
              description: 'Pending Fuel Stop',
              pending: true,
            },
          ],
        },
      ],
    },
    { sourceConnectionId: 'simplefin-conn-001' },
  )

  assert.equal(result.transactions.length, 0)
  assert.deepEqual(
    result.errors.map(error => error.code),
    ['invalid_transaction_id'],
  )
})
