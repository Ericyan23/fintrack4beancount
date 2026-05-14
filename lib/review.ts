import { sqlite } from '@/lib/db'
import { REVIEW_CATEGORY_NAMES } from '@/lib/classify/defaults'

export interface ReviewTransaction {
  id: string
  posted: number
  amount: string
  description: string
  accountId: string
  accountName: string
  category: string | null
  suggestedCat: string | null
  splitCount: number
}

export interface ReviewGroup {
  key: string
  direction: 'spending' | 'income' | 'zero'
  reason: 'uncategorized' | 'review_category' | 'mixed'
  sampleDescription: string
  normalizedDescription: string
  suggestedPattern: string
  transactionIds: string[]
  transactions: ReviewTransaction[]
  count: number
  net: number
  totalAbs: number
  minAbs: number
  maxAbs: number
  latestPosted: number
  splitTransactionCount: number
  splitPostingCount: number
  accounts: string[]
  currentCategories: Array<{ category: string; count: number }>
  suggestedCategories: Array<{ category: string; count: number }>
}

export interface ReviewPayload {
  groups: ReviewGroup[]
  summary: {
    groups: number
    transactions: number
    uncategorized: number
    reviewCategory: number
  }
}

interface ReviewRow extends Omit<ReviewTransaction, 'accountName'> {
  accountName: string | null
}

interface MutableGroup extends Omit<ReviewGroup, 'accounts' | 'currentCategories' | 'suggestedCategories'> {
  accounts: Set<string>
  currentCategories: Map<string, number>
  suggestedCategories: Map<string, number>
  reasonSet: Set<'uncategorized' | 'review_category'>
}

const GENERIC_RULE_TOKENS = new Set([
  'ACH',
  'CARD',
  'CHECKCARD',
  'DEBIT',
  'DES',
  'ID',
  'POS',
  'PURCHASE',
  'RECURRING',
  'TST',
])

function reviewCategoryPlaceholders(): string {
  return REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeReviewDescription(description: string): string {
  return description
    .normalize('NFKD')
    .replace(/\bCONF(?:IRMATION)?\s*#?\s*[A-Z0-9]+\b/gi, 'CONF')
    .replace(/[^\w\s&*.-]/g, ' ')
    .replace(/\b\d{8,}\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\b[A-Z]*\d+[A-Z0-9]*\b/gi, ' ')
    .replace(/[*._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function suggestedReviewRulePattern(description: string): string {
  const tokens = normalizeReviewDescription(description)
    .split(/\s+/)
    .filter(token => token.length > 1 && !GENERIC_RULE_TOKENS.has(token))
    .slice(0, 4)

  if (tokens.length === 0) {
    return regexEscape(description.trim()).replace(/\s+/g, '\\s+')
  }

  return tokens.map(regexEscape).join('.*')
}

function amountDirection(amount: number): ReviewGroup['direction'] {
  if (amount > 0) return 'income'
  if (amount < 0) return 'spending'
  return 'zero'
}

function sortedCounts(counts: Map<string, number>): Array<{ category: string; count: number }> {
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

export function loadReviewGroups(): ReviewPayload {
  const rows = sqlite.prepare(`
    SELECT
      t.id,
      t.posted,
      t.amount,
      t.description,
      t.account_id AS accountId,
      t.category,
      t.suggested_cat AS suggestedCat,
      a.name AS accountName,
      COALESCE(split_counts.splitCount, 0) AS splitCount
    FROM transactions t
    LEFT JOIN (
      SELECT
        parent_transaction_id,
        COUNT(*) AS splitCount
      FROM transaction_splits
      GROUP BY parent_transaction_id
    ) split_counts ON split_counts.parent_transaction_id = t.id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.status != 'cancelled'
      AND (
        t.category IS NULL
        OR t.category = ''
        OR t.category IN (${reviewCategoryPlaceholders()})
      )
    ORDER BY t.posted DESC, t.description
  `).all(...REVIEW_CATEGORY_NAMES) as ReviewRow[]

  const groups = new Map<string, MutableGroup>()
  let uncategorized = 0
  let reviewCategory = 0

  for (const row of rows) {
    const amount = Number.parseFloat(row.amount)
    const direction = amountDirection(amount)
    const normalizedDescription = normalizeReviewDescription(row.description) || row.description.trim().toUpperCase()
    const key = `${direction}:${normalizedDescription}`
    const reason = row.category ? 'review_category' : 'uncategorized'

    if (reason === 'uncategorized') uncategorized += 1
    else reviewCategory += 1

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        direction,
        reason,
        sampleDescription: row.description,
        normalizedDescription,
        suggestedPattern: suggestedReviewRulePattern(row.description),
        transactionIds: [],
        transactions: [],
        count: 0,
        net: 0,
        totalAbs: 0,
        minAbs: Number.POSITIVE_INFINITY,
        maxAbs: 0,
        latestPosted: row.posted,
        splitTransactionCount: 0,
        splitPostingCount: 0,
        accounts: new Set<string>(),
        currentCategories: new Map<string, number>(),
        suggestedCategories: new Map<string, number>(),
        reasonSet: new Set(),
      }
      groups.set(key, group)
    }

    const abs = Math.abs(amount)
    group.transactionIds.push(row.id)
    if (group.transactions.length < 20) {
      group.transactions.push({
        ...row,
        accountName: row.accountName ?? 'Unknown account',
        splitCount: row.splitCount ?? 0,
      })
    }
    group.count += 1
    group.net += amount
    group.totalAbs += abs
    group.minAbs = Math.min(group.minAbs, abs)
    group.maxAbs = Math.max(group.maxAbs, abs)
    group.latestPosted = Math.max(group.latestPosted, row.posted)
    if (row.splitCount > 0) {
      group.splitTransactionCount += 1
      group.splitPostingCount += row.splitCount
    }
    group.accounts.add(row.accountName ?? 'Unknown account')
    group.reasonSet.add(reason)
    if (row.category) {
      group.currentCategories.set(row.category, (group.currentCategories.get(row.category) ?? 0) + 1)
    }
    if (row.suggestedCat) {
      group.suggestedCategories.set(row.suggestedCat, (group.suggestedCategories.get(row.suggestedCat) ?? 0) + 1)
    }
  }

  const result = Array.from(groups.values()).map(group => {
    const {
      accounts,
      currentCategories,
      suggestedCategories,
      reasonSet,
      ...serializable
    } = group

    return {
      ...serializable,
      reason: reasonSet.size > 1 ? 'mixed' as const : group.reason,
      accounts: Array.from(accounts).sort((a, b) => a.localeCompare(b)),
      currentCategories: sortedCounts(currentCategories),
      suggestedCategories: sortedCounts(suggestedCategories),
      minAbs: Number.isFinite(group.minAbs) ? group.minAbs : 0,
    }
  })

  result.sort((a, b) =>
    b.count - a.count
    || b.totalAbs - a.totalAbs
    || b.latestPosted - a.latestPosted
    || a.sampleDescription.localeCompare(b.sampleDescription),
  )

  return {
    groups: result,
    summary: {
      groups: result.length,
      transactions: rows.length,
      uncategorized,
      reviewCategory,
    },
  }
}
