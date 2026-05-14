import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fintrack-rule-application-audit-'))
process.env.DB_PATH = path.join(tempDir, 'fintrack.db')

const originalDateNow = Date.now
const fixedNowMs = 1775001600000

const { sqlite } = require('../lib/db') as typeof import('../lib/db')
const {
  classifyNewTransactions,
  reclassifyUnmatched,
} = require('../lib/classify/rules') as typeof import('../lib/classify/rules')

interface AuditLogRow {
  entityType: string
  entityId: string
  action: string
  actor: string
  reason: string | null
  beforeValues: string
  afterValues: string
  metadata: string | null
  createdAt: number
}

function resetDb(): void {
  sqlite.exec(`
    DELETE FROM audit_log;
    DELETE FROM rules;
    DELETE FROM transaction_splits;
    DELETE FROM transfer_matches;
    DELETE FROM transactions;
    DELETE FROM accounts;
  `)
}

function insertAccount(): string {
  const id = 'acct-rule-audit-checking'

  sqlite.prepare(`
    INSERT INTO accounts (
      id, name, currency, balance, balance_date, conn_id, org_name, org_domain,
      account_type, account_type_override, beancount_account, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    'Rule Audit Checking',
    'USD',
    '0.00',
    1775001600,
    'rule-audit-test',
    'Rule Audit Bank',
    'rule-audit.test',
    'depository',
    null,
    'Assets:US:Banks:RuleAuditChecking',
    1775001600,
  )

  return id
}

function insertRule(pattern: string, category: string, priority = 100): void {
  sqlite.prepare(`
    INSERT INTO rules (pattern, category, priority, created_at)
    VALUES (?, ?, ?, ?)
  `).run(pattern, category, priority, 1774915200)
}

function insertTransaction(input: {
  id: string
  accountId: string
  description: string
  amount: string
  category?: string | null
  suggestedCat?: string | null
  ledgerAccount?: string | null
  reviewStatus?: string | null
  suggestedLedgerAccount?: string | null
  classifier?: string | null
}): void {
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
      classifier,
      confidence,
      suggested_at,
      notes,
      tags,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.accountId,
    'manual',
    1774915200,
    1774915200,
    input.amount,
    input.description,
    0,
    'posted',
    input.category ?? null,
    input.suggestedCat ?? null,
    input.ledgerAccount ?? null,
    input.reviewStatus ?? null,
    input.suggestedLedgerAccount ?? null,
    input.classifier ?? null,
    null,
    null,
    null,
    null,
    1774915200,
    1774915200,
  )
}

function readAuditRows(entityId: string): AuditLogRow[] {
  return sqlite.prepare(`
    SELECT entity_type AS entityType,
           entity_id AS entityId,
           action,
           actor,
           reason,
           before_values AS beforeValues,
           after_values AS afterValues,
           metadata,
           created_at AS createdAt
    FROM audit_log
    WHERE entity_type = 'transaction'
      AND entity_id = ?
    ORDER BY id
  `).all(entityId) as AuditLogRow[]
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

test('reclassifyUnmatched records rule application audit rows', () => {
  const accountId = insertAccount()
  insertRule('COFFEE', 'Expenses:Food:Coffee')
  insertTransaction({
    id: 'txn-rule-audit-review',
    accountId,
    description: 'Coffee Shop',
    amount: '-4.50',
    category: 'Expenses:Review',
    reviewStatus: 'needs_review',
    suggestedLedgerAccount: 'Expenses:Food:Coffee',
  })

  assert.equal(reclassifyUnmatched(), 1)

  const updated = sqlite.prepare(`
    SELECT category,
           ledger_account AS ledgerAccount,
           review_status AS reviewStatus,
           suggested_ledger_account AS suggestedLedgerAccount,
           classifier,
           updated_at AS updatedAt
    FROM transactions
    WHERE id = 'txn-rule-audit-review'
  `).get() as {
    category: string | null
    ledgerAccount: string | null
    reviewStatus: string | null
    suggestedLedgerAccount: string | null
    classifier: string | null
    updatedAt: number
  }
  assert.deepEqual(updated, {
    category: 'Expenses:Food:Coffee',
    ledgerAccount: 'Expenses:Food:Coffee',
    reviewStatus: 'reviewed',
    suggestedLedgerAccount: 'Expenses:Food:Coffee',
    classifier: 'rule',
    updatedAt: 1775001600,
  })

  const auditRows = readAuditRows('txn-rule-audit-review')
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].action, 'rule_application')
  assert.equal(auditRows[0].actor, 'system')
  assert.equal(auditRows[0].reason, 'reclassify_unmatched')
  assert.equal(auditRows[0].createdAt, 1775001600)

  const beforeValues = JSON.parse(auditRows[0].beforeValues) as {
    classification: { category: string | null; ledgerAccount: string | null; reviewStatus: string | null }
  }
  const afterValues = JSON.parse(auditRows[0].afterValues) as {
    classification: { category: string | null; ledgerAccount: string | null; reviewStatus: string | null; classifier: string | null }
  }
  const metadata = JSON.parse(auditRows[0].metadata ?? '{}') as {
    source: string
    matchedCategory: string
    fields: string[]
  }
  assert.equal(beforeValues.classification.category, 'Expenses:Review')
  assert.equal(beforeValues.classification.ledgerAccount, null)
  assert.equal(beforeValues.classification.reviewStatus, 'needs_review')
  assert.equal(afterValues.classification.category, 'Expenses:Food:Coffee')
  assert.equal(afterValues.classification.ledgerAccount, 'Expenses:Food:Coffee')
  assert.equal(afterValues.classification.reviewStatus, 'reviewed')
  assert.equal(afterValues.classification.classifier, 'rule')
  assert.equal(metadata.source, 'reclassify_unmatched')
  assert.equal(metadata.matchedCategory, 'Expenses:Food:Coffee')
  assert.ok(metadata.fields.includes('ledgerAccount'))
})

test('classifyNewTransactions records post-import enrichment audit rows', () => {
  const accountId = insertAccount()
  insertRule('PAYROLL|DIRECT DEP', 'Income:Salary')
  insertTransaction({
    id: 'txn-rule-audit-new',
    accountId,
    description: 'Payroll Direct Dep',
    amount: '2500.00',
  })

  assert.equal(classifyNewTransactions(['txn-rule-audit-new']), 1)

  const auditRows = readAuditRows('txn-rule-audit-new')
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].action, 'rule_application')
  assert.equal(auditRows[0].actor, 'system')
  assert.equal(auditRows[0].reason, 'classify_new_transactions')

  const afterValues = JSON.parse(auditRows[0].afterValues) as {
    classification: { category: string | null; ledgerAccount: string | null; reviewStatus: string | null }
  }
  const metadata = JSON.parse(auditRows[0].metadata ?? '{}') as {
    source: string
    matchedCategory: string
    fields: string[]
  }
  assert.equal(afterValues.classification.category, 'Income:Salary')
  assert.equal(afterValues.classification.ledgerAccount, 'Income:Salary')
  assert.equal(afterValues.classification.reviewStatus, 'reviewed')
  assert.equal(metadata.source, 'classify_new_transactions')
  assert.equal(metadata.matchedCategory, 'Income:Salary')
  assert.ok(metadata.fields.includes('classifier'))
})

test('rule classification skips existing ledger accounts without audit noise', () => {
  const accountId = insertAccount()
  insertRule('COFFEE', 'Expenses:Food:Coffee')
  insertTransaction({
    id: 'txn-rule-audit-reviewed',
    accountId,
    description: 'Coffee Shop',
    amount: '-4.50',
    category: 'Expenses:Food:Restaurants',
    ledgerAccount: 'Expenses:Food:Restaurants',
    reviewStatus: 'reviewed',
    classifier: 'manual_review',
  })

  assert.equal(classifyNewTransactions(['txn-rule-audit-reviewed']), 0)
  assert.deepEqual(readAuditRows('txn-rule-audit-reviewed'), [])
})
