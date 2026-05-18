import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { transactionEditHistory, transactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

interface RouteParams {
  params: Promise<{ id: string }>
}

function actorLabel(value: unknown): string {
  if (typeof value !== 'string') return 'local'
  const trimmed = value.trim()
  return trimmed || 'local'
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
  }
  return left === right
}

function isLegacyCategoryMirror(existing: typeof transactions.$inferSelect): boolean {
  const category = existing.category?.trim()
  const ledgerAccount = existing.ledgerAccount?.trim()
  return Boolean(category && ledgerAccount && category === ledgerAccount)
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
    ledgerAccount?: string | null
    reviewStatus?: string | null
    suggestedLedgerAccount?: string | null
    notes?: string | null
    tags?: string[]
    actor?: string | null
    editReason?: string | null
  }

  type TxnUpdate = {
    category?: string | null
    suggestedCat?: string | null
    ledgerAccount?: string | null
    reviewStatus?: string | null
    suggestedLedgerAccount?: string | null
    classifier?: string | null
    confidence?: number | null
    suggestedAt?: number | null
    updatedAt?: number
    updatedBy?: string | null
    notes?: string | null
    tags?: string[]
  }

  const [existing] = db.select().from(transactions).where(eq(transactions.id, id)).all()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: TxnUpdate = {}
  if ('category' in body) {
    update.ledgerAccount = body.category
    if (isLegacyCategoryMirror(existing)) update.category = null
    update.reviewStatus = body.category ? 'reviewed' : 'needs_review'
    if (body.category) {
      update.suggestedCat = null
      update.suggestedLedgerAccount = null
      update.classifier = 'manual_edit'
      update.confidence = null
      update.suggestedAt = null
    }
  }
  if ('ledgerAccount' in body) {
    update.ledgerAccount = body.ledgerAccount
    if (isLegacyCategoryMirror(existing)) update.category = null
    update.reviewStatus = body.ledgerAccount ? 'reviewed' : 'needs_review'
    if (body.ledgerAccount) {
      update.suggestedCat = null
      update.suggestedLedgerAccount = null
      update.classifier = 'manual_edit'
      update.confidence = null
      update.suggestedAt = null
    }
  }
  if ('suggestedCat' in body) {
    update.suggestedLedgerAccount = body.suggestedCat
    update.suggestedCat = null
  }
  if ('suggestedLedgerAccount' in body) {
    update.suggestedLedgerAccount = body.suggestedLedgerAccount
    update.suggestedCat = null
  }
  if ('reviewStatus' in body) update.reviewStatus = body.reviewStatus
  if ('notes' in body) update.notes = body.notes
  if ('tags' in body) update.tags = body.tags

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const existingRecord = existing as Record<string, unknown>
  const updateRecord = update as Record<string, unknown>
  const changedFields = Object.keys(updateRecord).filter(field => (
    updateRecord[field] !== undefined && !valuesEqual(existingRecord[field], updateRecord[field])
  ))

  if (changedFields.length === 0) {
    return NextResponse.json(existing)
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const actor = actorLabel(body.actor)
  update.updatedAt = timestamp
  update.updatedBy = actor

  const beforeValues: Record<string, unknown> = {}
  const afterValues: Record<string, unknown> = {}
  for (const field of changedFields) {
    beforeValues[field] = existingRecord[field] ?? null
    afterValues[field] = updateRecord[field] ?? null
  }

  db.transaction((tx) => {
    tx.update(transactions)
      .set(update)
      .where(eq(transactions.id, id))
      .run()

    tx.insert(transactionEditHistory)
      .values({
        transactionId: id,
        actor,
        reason: optionalText(body.editReason),
        fields: changedFields,
        beforeValues,
        afterValues,
        createdAt: timestamp,
      })
      .run()
  })

  const [updated] = db.select().from(transactions).where(eq(transactions.id, id)).all()
  return NextResponse.json(updated)
}
