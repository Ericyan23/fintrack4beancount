import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accounts, syncLog } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export async function GET(): Promise<NextResponse> {
  const allAccounts = db.select().from(accounts).all()
  const lastSync = db
    .select()
    .from(syncLog)
    .orderBy(desc(syncLog.syncedAt))
    .limit(5)
    .all()

  return NextResponse.json({ accounts: allAccounts, lastSync })
}
