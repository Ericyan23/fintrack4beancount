import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonFixture } from './helpers/fixtures'
import { fakeSimpleFinAccessUrl } from './helpers/simplefin'
import type { SimpleFinPayload } from '../lib/ingest/simplefin'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-simplefin-sync-compat-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalFetch = globalThis.fetch
const originalSimpleFinAccessUrl = process.env.SIMPLEFIN_ACCESS_URL
const { sqlite, setSetting } = require('../lib/db') as typeof import('../lib/db')
const route = require('../app/api/sync/route') as typeof import('../app/api/sync/route')

interface SyncCompatPayload {
  success: boolean
  error?: string
  compatibilityMode?: string
  promoted?: boolean
  newCount?: number
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
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
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

test('POST /api/sync stages SimpleFIN payloads without canonical writes', async () => {
  const payload = readJsonFixture<SimpleFinPayload>('simplefin', 'multi-account-pending.json')
  setSetting('simplefin_access_url', fakeSimpleFinAccessUrl())
  setFetch(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))

  const response = await route.POST()
  const result = (await response.json()) as SyncCompatPayload

  assert.equal(response.status, 200)
  assert.equal(result.success, true)
  assert.equal(result.compatibilityMode, 'staged')
  assert.equal(result.promoted, false)
  assert.equal(result.newCount, 0)
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
})

test('POST /api/sync keeps configuration errors explicit', async () => {
  const response = await route.POST()
  const payload = (await response.json()) as SyncCompatPayload

  assert.equal(response.status, 400)
  assert.deepEqual(payload, {
    success: false,
    error: 'No SimpleFIN access URL configured',
  })
  assert.equal(countRows('import_runs'), 0)
})
