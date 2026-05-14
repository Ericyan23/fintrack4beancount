import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'
import { REVIEW_CATEGORY_NAMES } from '@/lib/classify/defaults'
import { loadReviewGroups } from '@/lib/review'

interface ApplyBody {
  transactionIds?: string[]
  category?: string
  createRule?: boolean
  pattern?: string
  priority?: number
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function categoryExists(name: string): boolean {
  return Boolean(sqlite.prepare('SELECT 1 FROM categories WHERE name = ?').get(name))
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(loadReviewGroups())
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as ApplyBody
  const ledgerAccount = body.category?.trim()
  const transactionIds = Array.from(new Set(body.transactionIds ?? [])).filter(Boolean)

  if (!ledgerAccount) return NextResponse.json({ error: 'category required' }, { status: 400 })
  if (transactionIds.length === 0) return NextResponse.json({ error: 'transactionIds required' }, { status: 400 })
  if (!categoryExists(ledgerAccount)) {
    return NextResponse.json({ error: `category not found: ${ledgerAccount}` }, { status: 400 })
  }

  const shouldCreateRule = Boolean(body.createRule)
  const pattern = body.pattern?.trim()
  if (shouldCreateRule) {
    if (!pattern) return NextResponse.json({ error: 'pattern required when createRule is true' }, { status: 400 })
    try {
      new RegExp(pattern, 'i')
    } catch {
      return NextResponse.json({ error: 'invalid rule pattern' }, { status: 400 })
    }
  }

  const reviewPlaceholders = placeholders(REVIEW_CATEGORY_NAMES.length)
  const idPlaceholders = placeholders(transactionIds.length)
  let changed = 0
  let ruleCreated = false

  sqlite.transaction(() => {
    const result = sqlite.prepare(`
      UPDATE transactions
      SET ledger_account = ?,
          review_status = 'reviewed',
          suggested_ledger_account = NULL,
          category = ?,
          suggested_cat = NULL,
          classifier = 'manual_review',
          confidence = NULL,
          suggested_at = NULL,
          updated_at = ?
      WHERE id IN (${idPlaceholders})
        AND status != 'cancelled'
        AND (
          review_status = 'needs_review'
          OR ledger_account IS NULL
          OR ledger_account = ''
          OR (
            review_status IS NULL
            AND (
              category IS NULL
              OR category = ''
              OR category IN (${reviewPlaceholders})
            )
          )
        )
    `).run(ledgerAccount, ledgerAccount, Math.floor(Date.now() / 1000), ...transactionIds, ...REVIEW_CATEGORY_NAMES)
    changed = result.changes

    if (shouldCreateRule && pattern) {
      const existing = sqlite.prepare(`
        SELECT 1 FROM rules WHERE pattern = ? AND category = ?
      `).get(pattern, ledgerAccount)
      if (!existing) {
        sqlite.prepare(`
          INSERT INTO rules (pattern, category, priority, created_at)
          VALUES (?, ?, ?, ?)
        `).run(pattern, ledgerAccount, body.priority ?? 80, Math.floor(Date.now() / 1000))
        ruleCreated = true
      }
    }
  })()

  return NextResponse.json({
    changed,
    requested: transactionIds.length,
    ruleCreated,
    ledgerAccount,
    summary: loadReviewGroups().summary,
  })
}
