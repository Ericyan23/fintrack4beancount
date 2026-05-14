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

function updateLedgerClassification(
  statement: SqliteStatement,
  category: string,
  id: string,
): void {
  const timestamp = Math.floor(Date.now() / 1000)
  const isReviewCategory = REVIEW_CATEGORY_SET.has(category)
  statement.run(
    isReviewCategory ? null : category,
    isReviewCategory ? 'needs_review' : 'reviewed',
    category,
    timestamp,
    id,
  )
}

export async function classifyNewTransactions(ids: string[]): Promise<void> {
  if (ids.length === 0) return

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

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const rows = sqlite.prepare(`
      SELECT id, description, amount, status, category, ledger_account AS ledgerAccount
      FROM transactions
      WHERE id IN (${chunk.map(() => '?').join(', ')})
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
        if (txn.ledgerAccount) continue

        const category =
          classifyByRules(txn.description, ruleList) ??
          fallbackReviewCategoryForPosted(txn.amount, txn.status)
        if (category) updateLedgerClassification(updateCategory, category, txn.id)
      }
    })()
  }
}

export async function reclassifyUnmatched(): Promise<void> {
  const unclassified = sqlite.prepare(`
    SELECT id, description, amount, status
    FROM transactions
    WHERE status = 'posted'
      AND ledger_account IS NULL
  `).all() as Array<{
    id: string
    description: string
    amount: string
    status: string
  }>

  if (unclassified.length === 0) return

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

  sqlite.transaction(() => {
    for (const txn of unclassified) {
      const category =
        classifyByRules(txn.description, ruleList) ??
        fallbackReviewCategoryForPosted(txn.amount, txn.status)
      if (category) {
        updateLedgerClassification(updateCategory, category, txn.id)
      }
    }
  })()
}
