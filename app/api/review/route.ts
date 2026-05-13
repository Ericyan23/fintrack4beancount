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
  const category = body.category?.trim()
  const transactionIds = Array.from(new Set(body.transactionIds ?? [])).filter(Boolean)

  if (!category) return NextResponse.json({ error: 'category required' }, { status: 400 })
  if (transactionIds.length === 0) return NextResponse.json({ error: 'transactionIds required' }, { status: 400 })
  if (!categoryExists(category)) {
    return NextResponse.json({ error: `category not found: ${category}` }, { status: 400 })
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
      SET category = ?, suggested_cat = NULL
      WHERE id IN (${idPlaceholders})
        AND status != 'cancelled'
        AND (
          category IS NULL
          OR category = ''
          OR category IN (${reviewPlaceholders})
        )
    `).run(category, ...transactionIds, ...REVIEW_CATEGORY_NAMES)
    changed = result.changes

    if (shouldCreateRule && pattern) {
      const existing = sqlite.prepare(`
        SELECT 1 FROM rules WHERE pattern = ? AND category = ?
      `).get(pattern, category)
      if (!existing) {
        sqlite.prepare(`
          INSERT INTO rules (pattern, category, priority, created_at)
          VALUES (?, ?, ?, ?)
        `).run(pattern, category, body.priority ?? 80, Math.floor(Date.now() / 1000))
        ruleCreated = true
      }
    }
  })()

  return NextResponse.json({
    changed,
    requested: transactionIds.length,
    ruleCreated,
    summary: loadReviewGroups().summary,
  })
}
