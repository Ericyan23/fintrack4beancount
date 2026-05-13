import { NextRequest, NextResponse } from 'next/server'
import {
  countActiveReviewCategory,
  countActiveUnclassified,
  listTransactions,
  parseTransactionFilters,
} from '@/lib/transactions/query'

function parsePageInt(value: string | null, fallback: number, min: number, max?: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  const bounded = Math.max(min, parsed)
  return max === undefined ? bounded : Math.min(bounded, max)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const filters = parseTransactionFilters(searchParams)
  const limit = parsePageInt(searchParams.get('limit'), 50, 1, 200)
  const offset = parsePageInt(searchParams.get('offset'), 0, 0)
  const { transactions, total, hasMore } = listTransactions(filters, limit, offset)

  return NextResponse.json({
    transactions,
    total,
    hasMore,
    unclassifiedTotal: countActiveUnclassified(),
    reviewCategoryTotal: countActiveReviewCategory(),
  })
}
