import { NextResponse } from 'next/server'
import { reclassifyUnmatched } from '@/lib/classify/rules'
import { db } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
import { isNull, eq, and } from 'drizzle-orm'

function countUnclassified() {
  return db.select().from(transactions)
    .where(and(isNull(transactions.category), eq(transactions.status, 'posted')))
    .all().length
}

export async function POST(): Promise<NextResponse> {
  const before = countUnclassified()
  await reclassifyUnmatched()
  const after = countUnclassified()
  return NextResponse.json({ applied: before - after, remaining: after })
}
