import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rules } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET(): Promise<NextResponse> {
  const allRules = db.select().from(rules).orderBy(desc(rules.priority)).all()
  return NextResponse.json({ rules: allRules })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    pattern: string
    category: string
    priority?: number
  }

  if (!body.pattern || !body.category) {
    return NextResponse.json({ error: 'pattern and ledger account required' }, { status: 400 })
  }

  // Validate regex
  try {
    new RegExp(body.pattern)
  } catch {
    return NextResponse.json({ error: 'Invalid regex pattern' }, { status: 400 })
  }

  db.insert(rules)
    .values({
      pattern: body.pattern,
      category: body.category,
      priority: body.priority ?? 0,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .run()

  const allRules = db.select().from(rules).orderBy(desc(rules.priority)).all()
  return NextResponse.json({ rules: allRules }, { status: 201 })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  db.delete(rules).where(eq(rules.id, parseInt(id, 10))).run()
  return NextResponse.json({ success: true })
}
