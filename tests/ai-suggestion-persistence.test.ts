import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-ai-suggestion-persistence-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalDateNow = Date.now
const fixedNowMs = 1775088000000

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  recordAiLedgerAccountSuggestion,
} = require('../lib/classify/ai') as typeof import('../lib/classify/ai')

interface TransactionRow {
  category: string | null
  suggestedCat: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  suggestedLedgerAccount: string | null
  classifier: string | null
  suggestedAt: number | null
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(): string {
  const id = 'acct-ai-suggestion-checking'

  sqlite.prepare(`
    INSERT OR IGNORE INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'AI Suggestion Checking',
    'USD',
    '0.00',
    1775001600,
    'ai-suggestion-test',
    'AI Suggestion Bank',
    'ai-suggestion.test',
    'depository',
    null,
    'Assets:US:Banks:AiSuggestionChecking',
    1775001600,
  )

  return id
}

function insertTransaction(input: {
  id: string
  status?: string
  pending?: number
  category?: string | null
  suggestedCat?: string | null
  ledgerAccount?: string | null
  reviewStatus?: string | null
  suggestedLedgerAccount?: string | null
}): string {
  const accountId = insertAccount()

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
      ledger_account,
      review_status,
      suggested_ledger_account,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    accountId,
    'manual',
    1775001600,
    1775001600,
    '-12.34',
    'AI suggestion target',
    input.pending ?? 0,
    input.status ?? 'posted',
    input.category ?? null,
    input.suggestedCat ?? null,
    input.ledgerAccount ?? null,
    input.reviewStatus ?? 'needs_review',
    input.suggestedLedgerAccount ?? null,
    1775001600,
    1775001600,
  )

  return input.id
}

function readTransaction(id: string): TransactionRow {
  return sqlite.prepare(`
    SELECT category,
           suggested_cat AS suggestedCat,
           ledger_account AS ledgerAccount,
           review_status AS reviewStatus,
           suggested_ledger_account AS suggestedLedgerAccount,
           classifier,
           suggested_at AS suggestedAt
    FROM transactions
    WHERE id = ?
  `).get(id) as TransactionRow
}

beforeEach(() => {
  Date.now = () => fixedNowMs
  resetDb()
})

after(() => {
  Date.now = originalDateNow
  sqlite.close()
  ;(globalThis as { __sqlite?: unknown }).__sqlite = undefined
  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('AI suggestion writes only dedicated ledger suggestion fields', () => {
  const id = insertTransaction({
    id: 'txn-ai-suggestion-new',
    category: 'Expenses:Review',
    suggestedCat: 'Expenses:LegacySuggestion',
  })

  assert.equal(recordAiLedgerAccountSuggestion(id, 'Expenses:Food:Restaurants'), 1)

  const row = readTransaction(id)
  assert.equal(row.category, 'Expenses:Review')
  assert.equal(row.suggestedCat, null)
  assert.equal(row.ledgerAccount, null)
  assert.equal(row.reviewStatus, 'needs_review')
  assert.equal(row.suggestedLedgerAccount, 'Expenses:Food:Restaurants')
  assert.equal(row.classifier, 'ai')
  assert.equal(row.suggestedAt, 1775088000)
})

test('AI suggestion does not overwrite reviewed, suggested, or non-posted rows', () => {
  const reviewedId = insertTransaction({
    id: 'txn-ai-suggestion-reviewed',
    ledgerAccount: 'Expenses:Food:Coffee',
    reviewStatus: 'reviewed',
  })
  const suggestedId = insertTransaction({
    id: 'txn-ai-suggestion-existing',
    suggestedLedgerAccount: 'Expenses:Existing',
  })
  const pendingId = insertTransaction({
    id: 'txn-ai-suggestion-pending',
    status: 'pending',
    pending: 1,
  })

  assert.equal(recordAiLedgerAccountSuggestion(reviewedId, 'Expenses:New'), 0)
  assert.equal(recordAiLedgerAccountSuggestion(suggestedId, 'Expenses:New'), 0)
  assert.equal(recordAiLedgerAccountSuggestion(pendingId, 'Expenses:New'), 0)
  assert.equal(recordAiLedgerAccountSuggestion(pendingId, ''), 0)

  assert.equal(readTransaction(reviewedId).suggestedLedgerAccount, null)
  assert.equal(readTransaction(suggestedId).suggestedLedgerAccount, 'Expenses:Existing')
  assert.equal(readTransaction(pendingId).suggestedLedgerAccount, null)
})
