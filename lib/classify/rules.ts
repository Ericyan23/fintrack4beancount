import { db, sqlite } from '@/lib/db'
import { rules, transactions } from '@/lib/db/schema'
import { isNull, and, eq } from 'drizzle-orm'
import type { Rule } from '@/lib/db/schema'
import { reviewCategoryForAmount } from '@/lib/classify/defaults'

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

export async function classifyNewTransactions(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  const ruleList = db.select().from(rules).orderBy(rules.priority).all()
  const updateCategory = sqlite.prepare('UPDATE transactions SET category = ? WHERE id = ?')
  const chunkSize = 500

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const rows = sqlite.prepare(`
      SELECT id, description, amount, status, category
      FROM transactions
      WHERE id IN (${chunk.map(() => '?').join(', ')})
    `).all(...chunk) as Array<{
      id: string
      description: string
      amount: string
      status: string
      category: string | null
    }>

    sqlite.transaction(() => {
      for (const txn of rows) {
        if (txn.category) continue

        const category =
          classifyByRules(txn.description, ruleList) ??
          fallbackReviewCategoryForPosted(txn.amount, txn.status)
        if (category) updateCategory.run(category, txn.id)
      }
    })()
  }
}

export async function reclassifyUnmatched(): Promise<void> {
  const unclassified = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.category), eq(transactions.status, 'posted')))
    .all()

  if (unclassified.length === 0) return

  const ruleList = db.select().from(rules).orderBy(rules.priority).all()
  const updateCategory = sqlite.prepare('UPDATE transactions SET category = ? WHERE id = ?')

  sqlite.transaction(() => {
    for (const txn of unclassified) {
      const category =
        classifyByRules(txn.description, ruleList) ??
        fallbackReviewCategoryForPosted(txn.amount, txn.status)
      if (category) {
        updateCategory.run(category, txn.id)
      }
    }
  })()
}
