import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { classifyByAI, recordAiLedgerAccountSuggestion } from '@/lib/classify/ai'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const [txn] = db.select().from(transactions).where(eq(transactions.id, id)).all()
  if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (txn.status !== 'posted') {
    return NextResponse.json({ error: 'AI suggestions are only available for posted transactions' }, { status: 409 })
  }
  if (txn.ledgerAccount || txn.reviewStatus === 'reviewed') {
    return NextResponse.json({ error: 'Transaction already has a reviewed ledger account' }, { status: 409 })
  }
  if (txn.suggestedLedgerAccount) {
    return NextResponse.json({
      suggestedCat: null,
      suggestedLedgerAccount: txn.suggestedLedgerAccount,
      info: 'Transaction already has an AI suggestion',
    })
  }

  let suggested: string | null
  try {
    suggested = await classifyByAI(txn.description)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `AI request failed: ${msg}` }, { status: 502 })
  }
  if (!suggested) {
    return NextResponse.json({ error: 'No suitable ledger account was matched. Check your API key configuration' }, { status: 422 })
  }

  const changed = recordAiLedgerAccountSuggestion(id, suggested)
  if (changed === 0) {
    return NextResponse.json({ error: 'Transaction is no longer eligible for AI suggestion' }, { status: 409 })
  }
  return NextResponse.json({ suggestedCat: null, suggestedLedgerAccount: suggested })
}
