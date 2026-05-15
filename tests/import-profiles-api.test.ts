import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NextRequest } from 'next/server'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-import-profiles-api-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const profilesRoute = require('../app/api/import/profiles/route') as typeof import('../app/api/import/profiles/route')
const stageRoute = require('../app/api/import/transactions/stage/route') as typeof import('../app/api/import/transactions/stage/route')

interface ProfilePayload {
  profile: {
    id: string
    name: string
    sourceId: string
    kind: string
    mapping: Record<string, string>
    config: {
      connectionName: string | null
      defaultAccountId: string | null
      defaultLedgerAccount: string | null
    }
  }
}

function request(pathname: string, body: unknown): NextRequest {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
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
  `)
}

function insertAccount(id = 'acct-profile-checking'): string {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Profile Checking',
    'USD',
    '0.00',
    1777593600,
    'profile-test',
    'Profile Bank',
    'profile.test',
    'depository',
    null,
    'Assets:US:Banks:ProfileChecking',
    1777593600,
  )
  return id
}

function countRows(table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }
  return row.value
}

beforeEach(() => {
  resetDb()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('POST and GET /api/import/profiles persist a reusable CSV mapping profile', async () => {
  const accountId = insertAccount()

  const response = await profilesRoute.POST(request('/api/import/profiles', {
    name: 'Profile Bank CSV',
    connectionName: 'Profile Bank Checking',
    defaultAccountId: accountId,
    defaultLedgerAccount: 'Expenses:Food:Restaurants',
    mapping: {
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
      status: 'Status',
    },
  }))
  const payload = (await response.json()) as ProfilePayload

  assert.equal(response.status, 200)
  assert.equal(payload.profile.sourceId, 'csv')
  assert.equal(payload.profile.kind, 'csv')
  assert.equal(payload.profile.name, 'Profile Bank CSV')
  assert.deepEqual(payload.profile.mapping, {
    date: 'Date',
    amount: 'Amount',
    description: 'Description',
    status: 'Status',
  })
  assert.deepEqual(payload.profile.config, {
    connectionName: 'Profile Bank Checking',
    defaultAccountId: accountId,
    defaultLedgerAccount: 'Expenses:Food:Restaurants',
  })
  assert.equal(countRows('sources'), 1)
  assert.equal(countRows('import_profiles'), 1)
  assert.equal(countRows('import_profile_mappings'), 4)

  const listResponse = await profilesRoute.GET()
  const listPayload = (await listResponse.json()) as { profiles: ProfilePayload['profile'][] }
  assert.equal(listResponse.status, 200)
  assert.equal(listPayload.profiles.length, 1)
  assert.equal(listPayload.profiles[0].id, payload.profile.id)
  assert.equal(listPayload.profiles[0].mapping.status, 'Status')
})

test('POST /api/import/profiles upserts by name and replaces old mapping rows', async () => {
  insertAccount()

  const first = await profilesRoute.POST(request('/api/import/profiles', {
    name: 'Reusable CSV',
    mapping: {
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
      status: 'Status',
    },
  }))
  const firstPayload = (await first.json()) as ProfilePayload

  const second = await profilesRoute.POST(request('/api/import/profiles', {
    name: 'Reusable CSV',
    defaultLedgerAccount: 'Expenses:Travel:Airfare',
    mapping: {
      date: 'Posted',
      amount: 'Value',
      description: 'Memo',
      externalId: 'Transaction ID',
    },
  }))
  const secondPayload = (await second.json()) as ProfilePayload

  assert.equal(firstPayload.profile.id, secondPayload.profile.id)
  assert.equal(countRows('import_profiles'), 1)
  assert.equal(countRows('import_profile_mappings'), 4)
  assert.deepEqual(secondPayload.profile.mapping, {
    date: 'Posted',
    amount: 'Value',
    description: 'Memo',
    externalId: 'Transaction ID',
  })
  assert.equal(secondPayload.profile.config.defaultLedgerAccount, 'Expenses:Travel:Airfare')
})

test('staged CSV imports can link to a profile and apply default ledger hints', async () => {
  const accountId = insertAccount()
  const profileResponse = await profilesRoute.POST(request('/api/import/profiles', {
    name: 'Profile Stage CSV',
    connectionName: 'Profile Bank Checking',
    defaultAccountId: accountId,
    defaultLedgerAccount: 'Expenses:Food:Coffee',
    mapping: {
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
    },
  }))
  const { profile } = (await profileResponse.json()) as ProfilePayload

  const response = await stageRoute.POST(request('/api/import/transactions/stage', {
    csv: [
      'Date,Description,Amount',
      '2026-05-01,Coffee Shop,-4.75',
    ].join('\n'),
    mapping: profile.mapping,
    defaultAccountId: profile.config.defaultAccountId,
    connectionName: profile.config.connectionName,
    importProfileId: profile.id,
    defaultLedgerAccount: profile.config.defaultLedgerAccount,
  }))
  const payload = (await response.json()) as { importRunId: string; staged: number }

  assert.equal(response.status, 200)
  assert.equal(payload.staged, 1)

  const run = sqlite.prepare(`
    SELECT import_profile_id AS importProfileId,
           source_connection_id AS sourceConnectionId
    FROM import_runs
    WHERE id = ?
  `).get(payload.importRunId) as { importProfileId: string; sourceConnectionId: string }
  assert.equal(run.importProfileId, profile.id)
  assert.equal(run.sourceConnectionId, 'csv:profile-bank-checking')

  const staged = sqlite.prepare(`
    SELECT account_id AS accountId,
           category,
           status
    FROM staged_transactions
    WHERE import_run_id = ?
  `).get(payload.importRunId) as { accountId: string; category: string; status: string }
  assert.equal(staged.accountId, accountId)
  assert.equal(staged.category, 'Expenses:Food:Coffee')
  assert.equal(staged.status, 'staged')
})

test('POST /api/import/profiles rejects missing profile names', async () => {
  const response = await profilesRoute.POST(request('/api/import/profiles', {
    mapping: {
      date: 'Date',
    },
  }))
  const payload = (await response.json()) as { error?: string }

  assert.equal(response.status, 400)
  assert.equal(payload.error, 'Profile name is required')
  assert.equal(countRows('import_profiles'), 0)
})
