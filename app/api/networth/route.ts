import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { netWorthSnapshots } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export async function GET(): Promise<NextResponse> {
  const snapshots = db
    .select()
    .from(netWorthSnapshots)
    .orderBy(desc(netWorthSnapshots.snapshotAt))
    .limit(180)
    .all()

  return NextResponse.json({ snapshots: snapshots.reverse() })
}
