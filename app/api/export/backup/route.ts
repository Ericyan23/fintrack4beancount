import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  accounts,
  categories,
  netWorthSnapshots,
  rules,
  syncLog,
  transactions,
  transferMatches,
} from '@/lib/db/schema'

export async function GET(): Promise<NextResponse> {
  const exportedAt = new Date().toISOString()
  const backup = {
    schemaVersion: 1,
    exportedAt,
    secretsIncluded: false,
    accounts: db.select().from(accounts).all(),
    transactions: db.select().from(transactions).all(),
    categories: db.select().from(categories).all(),
    rules: db.select().from(rules).all(),
    transferMatches: db.select().from(transferMatches).all(),
    netWorthSnapshots: db.select().from(netWorthSnapshots).all(),
    syncLog: db.select().from(syncLog).all(),
  }

  return NextResponse.json(backup, {
    headers: {
      'Content-Disposition': `attachment; filename="fintrack-backup-${exportedAt.slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
