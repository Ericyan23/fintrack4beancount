import { db, sqlite } from '@/lib/db'
import { rules } from '@/lib/db/schema'
import type { Rule } from '@/lib/db/schema'
import { REVIEW_CATEGORY_NAMES, reviewCategoryForAmount } from '@/lib/classify/defaults'

type SqliteStatement = import('better-sqlite3').Statement

const REVIEW_CATEGORY_SET = new Set(REVIEW_CATEGORY_NAMES)

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
): number {
  const timestamp = Math.floor(Date.now() / 1000)
  const isReviewCategory = REVIEW_CATEGORY_SET.has(category)
  return statement.run(
    isReviewCategory ? null : category,
    isReviewCategory ? 'needs_review' : 'reviewed',
    category,
    timestamp,
    id,
  ).changes
}

export function classifyNewTransactions(ids: string[]): number {
  if (ids.length === 0) return 0

  const ruleList = db.select().from(rules).orderBy(rules.priority).all()
  const updateCategory = sqlite.prepare(`
    UPDATE transactions
    SET ledger_account = ?,
        review_status = ?,
        category = ?,
        classifier = 'rule',
        updated_at = ?
    WHERE id = ?
  `)
  const chunkSize = 500
  let classified = 0

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const rows = sqlite.prepare(`
      SELECT id, description, amount, status, category, ledger_account AS ledgerAccount
      FROM transactions
      WHERE id IN (${chunk.map(() => '?').join(', ')})
        AND status = 'posted'
    `).all(...chunk) as Array<{
      id: string
      description: string
      amount: string
      status: string
      category: string | null
      ledgerAccount: string | null
    }>

    sqlite.transaction(() => {
      for (const txn of rows) {
        if (hasEffectiveLedgerAccount(txn.ledgerAccount, txn.category)) continue

        const category =
          classifyByRules(txn.description, ruleList) ??
          fallbackReviewCategoryForPosted(txn.amount, txn.status)
        if (category) classified += updateLedgerClassification(updateCategory, category, txn.id)
      }
    })()
  }

  return classified
}

export function reclassifyUnmatched(): number {
  const reviewPlaceholders = REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')
  const unclassified = sqlite.prepare(`
    SELECT id, description, amount, status, category, ledger_account AS ledgerAccount
    FROM transactions
    WHERE status = 'posted'
      AND (ledger_account IS NULL OR ledger_account = '')
      AND (
        category IS NULL
        OR category = ''
        OR category IN (${reviewPlaceholders})
      )
  `).all(...REVIEW_CATEGORY_NAMES) as Array<{
    id: string
    description: string
    amount: string
    status: string
    category: string | null
    ledgerAccount: string | null
  }>

  if (unclassified.length === 0) return 0

  const ruleList = db.select().from(rules).orderBy(rules.priority).all()
  const updateCategory = sqlite.prepare(`
    UPDATE transactions
    SET ledger_account = ?,
        review_status = ?,
        category = ?,
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
        classified += updateLedgerClassification(updateCategory, category, txn.id)
      }
    }
  })()

  return classified
}
