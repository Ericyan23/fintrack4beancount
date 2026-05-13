import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { netWorthSnapshots } from '@/lib/db/schema'
import { toCsv } from '@/lib/csv'
import { desc } from 'drizzle-orm'

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString()
}

export async function GET(): Promise<NextResponse> {
  const rows = db.select().from(netWorthSnapshots).orderBy(desc(netWorthSnapshots.snapshotAt)).all()
  const csv = toCsv(
    ['snapshot_at', 'assets', 'liabilities', 'net_worth'],
    rows.map(row => [
      formatDate(row.snapshotAt),
      row.assets,
      row.liabilities,
      row.netWorth,
    ]),
  )

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fintrack-networth-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
