import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSourceItemKey } from '../lib/ingest/identity'

test('source item key prefers provider external id in source-account namespace', () => {
  const key = buildSourceItemKey({
    sourceAccountId: 'source-acct-1',
    externalId: 'provider-txn-1',
    date: '2026-05-13',
    amount: '-12.34',
    description: 'Coffee',
    rawPayload: { ignored: 'for external ids' },
  })

  assert.equal(key, 'source-account:source-acct-1:external:provider-txn-1')
  assert.equal(
    buildSourceItemKey({
      sourceAccountId: 'source-acct-2',
      externalId: 'provider-txn-1',
      date: '2026-05-13',
      amount: '-12.34',
      description: 'Coffee',
      rawPayload: { ignored: 'for external ids' },
    }),
    'source-account:source-acct-2:external:provider-txn-1',
  )
})

test('fallback source item key hash is deterministic', () => {
  const input = {
    sourceAccountId: 'source-acct-1',
    date: '2026-05-13',
    amount: '-12.34',
    description: 'Coffee',
    rawPayload: { id: null, memo: 'morning' },
  }

  assert.equal(buildSourceItemKey(input), buildSourceItemKey(input))
})

test('fallback source item key ignores user editable fields', () => {
  const baseInput = {
    sourceAccountId: 'source-acct-1',
    date: '2026-05-13',
    amount: '-12.34',
    description: 'Coffee',
    rawPayload: { id: null, memo: 'morning' },
    category: 'Expenses:Food:Coffee',
    notes: 'first note',
    tags: ['coffee'],
  }

  assert.equal(
    buildSourceItemKey(baseInput),
    buildSourceItemKey({
      ...baseInput,
      category: 'Expenses:Reviewed',
      notes: 'edited note',
      tags: ['reviewed', 'tax'],
    }),
  )
})

test('fallback source item key hash ignores raw payload object key order', () => {
  const first = buildSourceItemKey({
    sourceAccountId: 'source-acct-1',
    date: '2026-05-13',
    amount: '-12.34',
    description: 'Coffee',
    rawPayload: {
      transaction: {
        id: 'no-provider-id',
        nested: { b: 2, a: 1 },
      },
      account: 'checking',
    },
  })
  const second = buildSourceItemKey({
    sourceAccountId: 'source-acct-1',
    date: '2026-05-13',
    amount: '-12.34',
    description: 'Coffee',
    rawPayload: {
      account: 'checking',
      transaction: {
        nested: { a: 1, b: 2 },
        id: 'no-provider-id',
      },
    },
  })

  assert.equal(first, second)
})
