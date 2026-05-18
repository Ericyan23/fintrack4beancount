import { db, sqlite } from '@/lib/db'
import { rules } from '@/lib/db/schema'
import type { Rule } from '@/lib/db/schema'
import { REVIEW_CATEGORY_NAMES, reviewCategoryForAmount } from '@/lib/classify/defaults'

type SqliteStatement = import('better-sqlite3').Statement

const REVIEW_CATEGORY_SET = new Set(REVIEW_CATEGORY_NAMES)

type ClassificationAuditSource = 'classify_new_transactions' | 'reclassify_unmatched'

interface ClassifiableTransactionRow {
  id: string
  description: string
  amount: string
  status: string
  category: string | null
  suggestedCat: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  suggestedLedgerAccount: string | null
  classifier: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  sourceItemKey: string | null
  importRunId: string | null
  rawItemId: string | null
}

interface ClassificationAuditSnapshot {
  category: string | null
  suggestedCat: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  suggestedLedgerAccount: string | null
  classifier: string | null
}

export function classifyByRules(description: string, ruleList: Rule[]): string | null {
  const sorted = [...ruleList].sort((a, b) => b.priority - a.priority)
  for (const rule of sorted) {
    try {
      if (new RegExp(rule.pattern, 'i').test(description)) {
        return rule.category
      }
    } catch {
      // skip invalid regex
    }
  }
  return null
}

function fallbackReviewCategoryForPosted(amountText: string, status: string): string | null {
  if (status !== 'posted') return null
  return reviewCategoryForAmount(Number.parseFloat(amountText))
}

function hasEffectiveLedgerAccount(ledgerAccount: string | null, category: string | null): boolean {
  if (ledgerAccount?.trim()) return true
  return Boolean(category?.trim() && !REVIEW_CATEGORY_SET.has(category))
}

function updateLedgerClassification(
  statement: SqliteStatement,
  category: string,
  id: string,
  timestamp: number,
): number {
  const isReviewCategory = REVIEW_CATEGORY_SET.has(category)
  return statement.run(
    isReviewCategory ? null : category,
    isReviewCategory ? 'needs_review' : 'reviewed',
    timestamp,
    id,
  ).changes
}

const insertAuditLog = sqlite.prepare(`
  INSERT INTO audit_log (
    entity_type,
    entity_id,
    action,
    actor,
    reason,
    before_values,
    after_values,
    metadata,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function classificationBeforeSnapshot(row: ClassifiableTransactionRow): ClassificationAuditSnapshot {
  return {
    category: row.category,
    suggestedCat: row.suggestedCat,
    ledgerAccount: row.ledgerAccount,
    reviewStatus: row.reviewStatus,
    suggestedLedgerAccount: row.suggestedLedgerAccount,
    classifier: row.classifier,
  }
}

function classificationAfterSnapshot(
  row: ClassifiableTransactionRow,
  category: string,
): ClassificationAuditSnapshot {
  const isReviewCategory = REVIEW_CATEGORY_SET.has(category)
  return {
    category: row.category,
    suggestedCat: row.suggestedCat,
    ledgerAccount: isReviewCategory ? null : category,
    reviewStatus: isReviewCategory ? 'needs_review' : 'reviewed',
    suggestedLedgerAccount: row.suggestedLedgerAccount,
    classifier: 'rule',
  }
}

function changedClassificationFields(
  beforeValues: ClassificationAuditSnapshot,
  afterValues: ClassificationAuditSnapshot,
): string[] {
  const fields = Object.keys(afterValues) as Array<keyof ClassificationAuditSnapshot>
  return fields.filter(field => beforeValues[field] !== afterValues[field])
}

function recordClassificationAudit(input: {
  row: ClassifiableTransactionRow
  category: string
  source: ClassificationAuditSource
  timestamp: number
}): void {
  const beforeValues = classificationBeforeSnapshot(input.row)
  const afterValues = classificationAfterSnapshot(input.row, input.category)
  const fields = changedClassificationFields(beforeValues, afterValues)
  if (fields.length === 0) return

  insertAuditLog.run(
    'transaction',
    input.row.id,
    'rule_application',
    'system',
    input.source,
    JSON.stringify({ classification: beforeValues }),
    JSON.stringify({ classification: afterValues }),
    JSON.stringify({
      source: input.source,
      matchedCategory: input.category,
      reviewCategory: REVIEW_CATEGORY_SET.has(input.category),
      sourceConnectionId: input.row.sourceConnectionId,
      sourceAccountId: input.row.sourceAccountId,
      sourceItemKey: input.row.sourceItemKey,
      importRunId: input.row.importRunId,
      rawItemId: input.row.rawItemId,
      fields,
    }),
    input.timestamp,
  )
}

export function classifyNewTransactions(ids: string[]): number {
  if (ids.length === 0) return 0

  const ruleList = db.select().from(rules).orderBy(rules.priority).all()
  const updateCategory = sqlite.prepare(`
    UPDATE transactions
    SET ledger_account = ?,
        review_status = ?,
        category = CASE WHEN category = ledger_account THEN NULL ELSE category END,
        classifier = 'rule',
        updated_at = ?
    WHERE id = ?
  `)
  const chunkSize = 500
  let classified = 0

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const rows = sqlite.prepare(`
      SELECT id,
             description,
             amount,
             status,
             category,
             suggested_cat AS suggestedCat,
             ledger_account AS ledgerAccount,
             review_status AS reviewStatus,
             suggested_ledger_account AS suggestedLedgerAccount,
             classifier,
             source_connection_id AS sourceConnectionId,
             source_account_id AS sourceAccountId,
             source_item_key AS sourceItemKey,
             import_run_id AS importRunId,
             raw_item_id AS rawItemId
      FROM transactions
      WHERE id IN (${chunk.map(() => '?').join(', ')})
        AND status = 'posted'
    `).all(...chunk) as ClassifiableTransactionRow[]

    sqlite.transaction(() => {
      for (const txn of rows) {
        if (hasEffectiveLedgerAccount(txn.ledgerAccount, txn.category)) continue

        const category =
          classifyByRules(txn.description, ruleList) ??
          fallbackReviewCategoryForPosted(txn.amount, txn.status)
        if (category) {
          const timestamp = Math.floor(Date.now() / 1000)
          const changes = updateLedgerClassification(updateCategory, category, txn.id, timestamp)
          classified += changes
          if (changes > 0) {
            recordClassificationAudit({
              row: txn,
              category,
              source: 'classify_new_transactions',
              timestamp,
            })
          }
        }
      }
    })()
  }

  return classified
}

export function reclassifyUnmatched(): number {
  const reviewPlaceholders = REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')
  const unclassified = sqlite.prepare(`
    SELECT id,
           description,
           amount,
           status,
           category,
           suggested_cat AS suggestedCat,
           ledger_account AS ledgerAccount,
           review_status AS reviewStatus,
           suggested_ledger_account AS suggestedLedgerAccount,
           classifier,
           source_connection_id AS sourceConnectionId,
           source_account_id AS sourceAccountId,
           source_item_key AS sourceItemKey,
           import_run_id AS importRunId,
           raw_item_id AS rawItemId
    FROM transactions
    WHERE status = 'posted'
      AND (ledger_account IS NULL OR ledger_account = '')
      AND (
        category IS NULL
        OR category = ''
        OR category IN (${reviewPlaceholders})
      )
  `).all(...REVIEW_CATEGORY_NAMES) as ClassifiableTransactionRow[]

  if (unclassified.length === 0) return 0

  const ruleList = db.select().from(rules).orderBy(rules.priority).all()
  const updateCategory = sqlite.prepare(`
    UPDATE transactions
    SET ledger_account = ?,
        review_status = ?,
        category = CASE WHEN category = ledger_account THEN NULL ELSE category END,
        classifier = 'rule',
        updated_at = ?
    WHERE id = ?
  `)
  let classified = 0

  sqlite.transaction(() => {
    for (const txn of unclassified) {
      if (hasEffectiveLedgerAccount(txn.ledgerAccount, txn.category)) continue

      const category =
        classifyByRules(txn.description, ruleList) ??
        fallbackReviewCategoryForPosted(txn.amount, txn.status)
      if (category) {
        const timestamp = Math.floor(Date.now() / 1000)
        const changes = updateLedgerClassification(updateCategory, category, txn.id, timestamp)
        classified += changes
        if (changes > 0) {
          recordClassificationAudit({
            row: txn,
            category,
            source: 'reclassify_unmatched',
            timestamp,
          })
        }
      }
    }
  })()

  return classified
}
