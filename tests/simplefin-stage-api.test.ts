import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonFixture } from './helpers/fixtures'
import type { SimpleFinPayload } from '../lib/ingest/simplefin'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-simplefin-stage-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalFetch = globalThis.fetch
const originalSimpleFinAccessUrl = process.env.SIMPLEFIN_ACCESS_URL
const { sqlite, setSetting } = require('../lib/db') as typeof import('../lib/db')
const route = require('../app/api/import/simplefin/stage/route') as typeof import('../app/api/import/simplefin/stage/route')

interface CountRow {
  value: number
}

interface StageApiPayload {
  success: boolean
  error?: string
  importRunId?: string
  rawInserted?: number
  staged?: number
  merged?: number
  duplicates?: number
  errors?: number
  validationErrors?: number
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM staged_transactions;
    DELETE FROM raw_import_items;
    DELETE FROM import_runs;
    DELETE FROM import_profile_mappings;
    DELETE FROM import_profiles;
    DELETE FROM source_accounts;
    DELETE FROM source_connections;
    DELETE FROM sources;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM settings;
  `)
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as CountRow
  return row.value
}

async function responseJson(response: Response): Promise<StageApiPayload> {
  return (await response.json()) as StageApiPayload
}

function setFetch(fetchImpl: typeof fetch): void {
  ;(globalThis as { fetch: typeof fetch }).fetch = fetchImpl
}

beforeEach(() => {
  resetDb()
  delete process.env.SIMPLEFIN_ACCESS_URL
  setFetch(async () => {
    throw new Error('unexpected fetch')
  })
})

after(() => {
  if (originalSimpleFinAccessUrl === undefined) delete process.env.SIMPLEFIN_ACCESS_URL
  else process.env.SIMPLEFIN_ACCESS_URL = originalSimpleFinAccessUrl
  setFetch(originalFetch)
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('POST /api/import/simplefin/stage returns 400 when SimpleFIN is not configured', async () => {
  const response = await route.POST()
  const payload = await responseJson(response)

  assert.equal(response.status, 400)
  assert.deepEqual(payload, {
    success: false,
    error: 'No SimpleFIN access URL configured',
  })
  assert.equal(countRows('import_runs'), 0)
})

test('POST /api/import/simplefin/stage stages fetched SimpleFIN payload without canonical transactions', async () => {
  const payload = readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
  const requests: Array<{ url: string; authorization: string | null }> = []
  setSetting('simplefin_access_url', 'https://fixture-user:fixture-pass@simplefin.example.test/access')
  setFetch(async (input, init) => {
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
  })

  const response = await route.POST()
  const result = await responseJson(response)

  assert.equal(response.status, 200)
  assert.equal(result.success, true)
  assert.ok(result.importRunId)
  assert.equal(result.rawInserted, 7)
  assert.equal(result.staged, 0)
  assert.equal(result.merged, 0)
  assert.equal(result.duplicates, 0)
  assert.equal(result.errors, 0)
  assert.equal(result.validationErrors, 7)
  assert.equal(countRows('import_runs'), 1)
  assert.equal(countRows('raw_import_items'), 7)
  assert.equal(countRows('staged_transactions'), 7)
  assert.equal(countRows('transactions'), 0)

  assert.equal(requests.length, 1)
  assert.doesNotMatch(requests[0].url, /fixture-user|fixture-pass|@/)
  assert.match(requests[0].authorization ?? '', /^Basic\s+/)

  const connection = sqlite.prepare(`
    SELECT id, config
    FROM source_connections
    LIMIT 1
  `).get() as { id: string; config: string }
  assert.equal(connection.id, 'simplefin:primary')
  assert.doesNotMatch(connection.config, /fixture-user|fixture-pass|simplefin\.example\.test|accessUrl|simplefin_access_url/i)
})

test('POST /api/import/simplefin/stage does not leak access URL credentials on fetch errors', async () => {
  setSetting('simplefin_access_url', 'https://fixture-user:fixture-pass@simplefin.example.test/access')
  setFetch(async () => {
    throw new Error('fixture-user fixture-pass network failure')
  })

  const response = await route.POST()
  const payload = await responseJson(response)

  assert.equal(response.status, 502)
  assert.equal(payload.success, false)
  assert.equal(payload.error, 'SimpleFIN stage import failed')
  assert.doesNotMatch(JSON.stringify(payload), /fixture-user|fixture-pass|simplefin\.example\.test/)
  assert.equal(countRows('import_runs'), 0)
  assert.equal(countRows('raw_import_items'), 0)
})

test('POST /api/import/simplefin/stage rejects invalid SimpleFIN access URLs before fetch', async () => {
  setSetting('simplefin_access_url', 'not a url')

  const response = await route.POST()
  const payload = await responseJson(response)

  assert.equal(response.status, 400)
  assert.deepEqual(payload, {
    success: false,
    error: 'Invalid SimpleFIN access URL',
  })
  assert.equal(countRows('import_runs'), 0)
})
