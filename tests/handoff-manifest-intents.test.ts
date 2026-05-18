import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-handoff-manifest-intents-'))
const dbPath = path.join(tempDir, 'fintrack.db')
const beancountRoot = path.join(tempDir, 'beancount')
process.env.DB_PATH = dbPath

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  buildBeancountHandoffManifest,
} = require('../lib/export/handoff-manifest') as typeof import('../lib/export/handoff-manifest')

const posted = Math.floor(Date.UTC(2026, 3, 15) / 1000)

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM balance_assertions;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function writeLedger(): void {
  fs.mkdirSync(beancountRoot, { recursive: true })
  fs.writeFileSync(
    path.join(beancountRoot, 'main.bean'),
    [
      'option "title" "Handoff Manifest Intent Test"',
      '2026-01-01 open Assets:US:Banks:ManifestChecking USD',
      '2026-01-01 open Expenses:Food:Coffee USD',
      '',
    ].join('\n'),
  )
}

function seedExportableRows(): void {
  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'acct-manifest-checking',
    'Manifest Checking',
    'USD',
    '1234.56',
    posted,
    'manifest-test',
    'Manifest Bank',
    'manifest.test',
    'depository',
    null,
    'Assets:US:Banks:ManifestChecking',
    posted,
  )

  sqlite.prepare(`
    INSERT INTO transactions (
      id,
      account_id,
      source,
      posted,
      transacted_at,
      amount,
      description,
      pending,
      status,
      category,
      suggested_cat,
      notes,
      tags,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'txn-manifest-cash',
    'acct-manifest-checking',
    'csv',
    posted,
    posted,
    '-4.75',
    'Coffee',
    0,
    'posted',
    'Expenses:Food:Coffee',
    null,
    null,
    null,
    posted,
    posted,
  )

  sqlite.prepare(`
    INSERT INTO balance_assertions (
      id,
      fintrack_account_id,
      beancount_account,
      assertion_date,
      amount,
      currency,
      source_id,
      status,
      note,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'assertion-manifest-balance',
    'acct-manifest-checking',
    'Assets:US:Banks:ManifestChecking',
    '2026-04-30',
    '1234.56',
    'USD',
    'fintrack:balance:acct-manifest-checking:2026-04-30',
    'draft',
    'Statement balance',
    posted,
    posted,
  )
}

beforeEach(() => {
  resetDb()
  writeLedger()
  seedExportableRows()
})

after(() => {
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('handoff manifest source ids and counts follow export candidates', () => {
  const manifest = buildBeancountHandoffManifest({
    period: '2026-04',
    generatedAt: new Date('2026-05-13T12:00:00.000Z'),
    beancountRoot,
  })

  assert.equal(manifest.ok, true)
  assert.deepEqual(manifest.counts, {
    transactions: 1,
    transfers: 0,
    balanceAssertions: 1,
    skipped: 0,
    transactionBlockers: 0,
    balanceAssertionBlockers: 0,
    reviewItems: 0,
    duplicateCandidates: 0,
  })
  assert.deepEqual(manifest.sourceIds, [
    'fintrack:acct-manifest-checking:txn-manifest-cash',
    'fintrack:balance:acct-manifest-checking:2026-04-30',
  ])
})
