import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const [txn] = db.select().from(transactions).where(eq(transactions.id, id)).all()
  if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(txn)
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const body = (await req.json()) as {
    category?: string | null
    suggestedCat?: string | null
    notes?: string | null
    tags?: string[]
  }

  type TxnUpdate = {
    category?: string | null
    suggestedCat?: string | null
    notes?: string | null
    tags?: string[]
  }
  const update: TxnUpdate = {}
  if ('category' in body) {
    update.category = body.category
    if (body.category) update.suggestedCat = null
  }
  if ('suggestedCat' in body) update.suggestedCat = body.suggestedCat
  if ('notes' in body) update.notes = body.notes
  if ('tags' in body) update.tags = body.tags

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  db.update(transactions)
    .set(update)
    .where(eq(transactions.id, id))
    .run()

  const [updated] = db.select().from(transactions).where(eq(transactions.id, id)).all()
  return NextResponse.json(updated)
}
