import { NextRequest, NextResponse } from 'next/server'
import { toCsv } from '@/lib/csv'
import { listTransactionsForExport, parseTransactionFilters } from '@/lib/transactions/query'

function formatDate(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const filters = parseTransactionFilters(req.nextUrl.searchParams)
  const rows = listTransactionsForExport(filters)
  const csv = toCsv(
    [
      'date',
      'transacted_at',
      'description',
      'amount',
      'status',
      'account_name',
      'account_id',
      'category',
      'category_group',
      'notes',
      'tags',
      'source',
      'transaction_id',
    ],
    rows.map(row => {
      const categoryGroup = row.category?.includes(':') ? row.category.split(':')[0] : row.category ?? ''
      return [
        formatDate(row.posted),
        formatDate(row.transactedAt),
        row.description,
        row.amount,
        row.status,
        row.accountName ?? '',
        row.accountId,
        row.category ?? '',
        categoryGroup,
        row.notes ?? '',
        (row.tags ?? []).join('|'),
        row.source,
        row.id,
      ]
    }),
  )

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="fintrack-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
