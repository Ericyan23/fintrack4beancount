import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { toCsv } from '@/lib/csv'

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString()
}

export async function GET(): Promise<NextResponse> {
  const rows = db.select().from(accounts).all()
  const csv = toCsv(
    [
      'account_id',
      'name',
      'org_name',
      'org_domain',
      'type',
      'type_override',
      'beancount_account',
      'currency',
      'balance',
      'balance_date',
      'connection_id',
      'updated_at',
    ],
    rows.map(row => [
      row.id,
      row.name,
      row.orgName,
      row.orgDomain,
      row.accountType,
      row.accountTypeOverride,
      row.beancountAccount,
      row.currency,
      row.balance,
      formatDate(row.balanceDate),
      row.connId,
      formatDate(row.updatedAt),
    ]),
  )

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fintrack-accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
