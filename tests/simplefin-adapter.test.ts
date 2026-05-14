import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readJsonFixture } from './helpers/fixtures'
import type { SimpleFinPayload } from '../lib/ingest/simplefin'

interface SimpleFinAdapterApi {
  fetchSimpleFINPayload(
    accessUrl: string,
    options: {
      startDate: number
      pending?: boolean
      version?: number
      fetchImpl?: typeof fetch
    },
  ): Promise<SimpleFinPayload>
}

function loadAdapterApi(): SimpleFinAdapterApi | null {
  try {
    const mod = require('../lib/sync/simplefin-adapter') as Partial<SimpleFinAdapterApi>
    assert.equal(typeof mod.fetchSimpleFINPayload, 'function')
    return mod as SimpleFinAdapterApi
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND' &&
      String((error as { message?: unknown }).message).includes('simplefin-adapter')
    ) {
      return null
    }
    throw error
  }
}

test('SimpleFIN adapter fetches fixture payload through the source adapter boundary without leaking URL credentials', async t => {
  const api = loadAdapterApi()
  if (!api) {
    t.skip('blocked until ../lib/sync/simplefin-adapter exports fetchSimpleFINPayload')
    return
  }

  const payload = readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
  const requests: Array<{ url: string; authorization: string | null }> = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)
    requests.push({
      url,
      authorization: headers.get('authorization'),
    })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const result = await api.fetchSimpleFINPayload(
    'https://fixture-user:fixture-pass@simplefin.example.test/access',
    {
      startDate: 1774224000,
      pending: true,
      version: 2,
      fetchImpl: fakeFetch,
    },
  )

  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /\/access\/accounts\?/)
  assert.match(requests[0].url, /version=2/)
  assert.match(requests[0].url, /start-date=1774224000/)
  assert.match(requests[0].url, /pending=1/)
  assert.doesNotMatch(requests[0].url, /fixture-user|fixture-pass|@/)
  assert.match(requests[0].authorization ?? '', /^Basic\s+/)
  assert.equal(
    Buffer.from((requests[0].authorization ?? '').replace(/^Basic\s+/, ''), 'base64').toString('utf8'),
    'fixture-user:fixture-pass',
  )
  assert.equal(result.accounts?.length, 2)
  assert.ok(
    result.accounts
      ?.flatMap(account => account.transactions ?? [])
      .some(transaction => transaction.id === 'sf-checking-pending-fuel-001'),
  )
})

test('SimpleFIN adapter decodes URL-encoded credentials before building Basic auth', async t => {
  const api = loadAdapterApi()
  if (!api) {
    t.skip('blocked until ../lib/sync/simplefin-adapter exports fetchSimpleFINPayload')
    return
  }

  const requests: Array<{ authorization: string | null }> = []
  const fakeFetch: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers)
    requests.push({ authorization: headers.get('authorization') })
    return new Response(JSON.stringify({ accounts: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await api.fetchSimpleFINPayload(
    'https://fixture-user%40example.test:fixture%3Apass@simplefin.example.test/access',
    {
      startDate: 1774224000,
      fetchImpl: fakeFetch,
    },
  )

  assert.equal(requests.length, 1)
  assert.equal(
    Buffer.from((requests[0].authorization ?? '').replace(/^Basic\s+/, ''), 'base64').toString('utf8'),
    'fixture-user@example.test:fixture:pass',
  )
})
