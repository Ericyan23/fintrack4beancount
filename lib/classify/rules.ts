import { db } from '@/lib/db'
import { rules, transactions } from '@/lib/db/schema'
import { eq, isNull, and } from 'drizzle-orm'
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

  for (const id of ids) {
    const [txn] = db.select().from(transactions).where(eq(transactions.id, id)).all()
    if (!txn || txn.category) continue

    const category =
      classifyByRules(txn.description, ruleList) ??
      fallbackReviewCategoryForPosted(txn.amount, txn.status)
    if (category) {
      db.update(transactions)
        .set({ category })
        .where(eq(transactions.id, id))
        .run()
    }
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

  for (const txn of unclassified) {
    const category =
      classifyByRules(txn.description, ruleList) ??
      fallbackReviewCategoryForPosted(txn.amount, txn.status)
    if (category) {
      db.update(transactions)
        .set({ category })
        .where(eq(transactions.id, txn.id))
        .run()
    }
  }
}
