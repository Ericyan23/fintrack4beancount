import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readJsonFixture } from './helpers/fixtures'

const PUBLIC_SIMPLEFIN_FIXTURES = [
  'sample-payload.json',
  'multi-account-pending.json',
]

interface SimpleFinFixtureTransaction {
  id: string
  posted: number
  'transacted-at'?: number
  amount: string
  description: string
  pending?: boolean
}

interface SimpleFinFixtureAccount {
  id: string
  name: string
  currency: string
  balance: string
  'balance-date': number
  org?: {
    domain?: string
    name?: string
  }
  transactions?: SimpleFinFixtureTransaction[]
}

interface SimpleFinFixturePayload {
  accounts: SimpleFinFixtureAccount[]
}

test('multi-account SimpleFIN fixture stays fake and covers posted and pending shapes', () => {
  const payload = readJsonFixture<SimpleFinFixturePayload>('simplefin', 'multi-account-pending.json')
  const allTransactions = payload.accounts.flatMap(account => account.transactions ?? [])

  assert.deepEqual(
    payload.accounts.map(account => account.id),
    ['simplefin-checking-001', 'simplefin-credit-001'],
  )
  assert.ok(allTransactions.some(transaction => transaction.pending === true && transaction.posted === 0))
  assert.ok(allTransactions.some(transaction => transaction.pending === false && transaction.posted > 0))
  assert.ok(allTransactions.some(transaction => Number.parseFloat(transaction.amount) > 0))
  assert.ok(allTransactions.some(transaction => Number.parseFloat(transaction.amount) < 0))

  for (const account of payload.accounts) {
    assert.match(account.id, /^simplefin-(checking|credit)-\d{3}$/)
    assert.match(account.org?.domain ?? '', /^example(bank|card)\.test$/)
    assert.equal(account.currency, 'USD')
  }
})

for (const fixtureName of PUBLIC_SIMPLEFIN_FIXTURES) {
  test(`${fixtureName} does not contain private URL or auth-shaped strings`, () => {
    const fixtureText = JSON.stringify(
      readJsonFixture<SimpleFinFixturePayload>('simplefin', fixtureName),
    )

    assert.doesNotMatch(fixtureText, /simplefin_access_url/i)
    assert.doesNotMatch(fixtureText, /https?:\/\//i)
    assert.doesNotMatch(fixtureText, /authorization/i)
    assert.doesNotMatch(fixtureText, /basic\s+[a-z0-9+/=]+/i)
    assert.doesNotMatch(fixtureText, /\/Users\/eric\/Desktop\/exclude/i)
    assert.doesNotMatch(fixtureText, /@[a-z0-9.-]+\.[a-z]{2,}/i)
  })
}
