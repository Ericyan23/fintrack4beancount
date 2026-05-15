import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rules } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

function parseRuleId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function parsePriority(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  const priority = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(priority) ? Math.trunc(priority) : fallback
}

function validateRule(pattern: string, category: string): string | null {
  if (!pattern || !category) return 'pattern and ledger account required'
  try {
    new RegExp(pattern)
  } catch {
    return 'Invalid regex pattern'
  }
  return null
}

function orderedRules() {
  return db.select().from(rules).orderBy(desc(rules.priority)).all()
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ rules: orderedRules() })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    pattern: string
    category: string
    priority?: number
  }

  const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const validationError = validateRule(pattern, category)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  db.insert(rules)
    .values({
      pattern,
      category,
      priority: parsePriority(body.priority, 0),
      createdAt: Math.floor(Date.now() / 1000),
    })
    .run()

  return NextResponse.json({ rules: orderedRules() }, { status: 201 })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    id?: number | string
    pattern?: string
    category?: string
    priority?: number | string
  }
  const id = parseRuleId(body.id)
  if (!id) return NextResponse.json({ error: 'valid id required' }, { status: 400 })

  const [existing] = db.select().from(rules).where(eq(rules.id, id)).all()
  if (!existing) return NextResponse.json({ error: 'rule not found' }, { status: 404 })

  const pattern = typeof body.pattern === 'string' ? body.pattern.trim() : existing.pattern
  const category = typeof body.category === 'string' ? body.category.trim() : existing.category
  const priority = parsePriority(body.priority, existing.priority)
  const validationError = validateRule(pattern, category)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  db.update(rules)
    .set({ pattern, category, priority })
    .where(eq(rules.id, id))
    .run()

  return NextResponse.json({ rules: orderedRules() })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  db.delete(rules).where(eq(rules.id, parseInt(id, 10))).run()
  return NextResponse.json({ success: true })
}
