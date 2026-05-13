import { NextRequest, NextResponse } from 'next/server'
import {
  listTransferMatches,
  listUnmatchedTransferTransactions,
  transferSummary,
  type TransferMatchStatus,
} from '@/lib/transfers/matcher'

function parseStatus(value: string | null): TransferMatchStatus | 'all' | undefined {
  if (value === 'suggested' || value === 'confirmed' || value === 'ignored' || value === 'all') {
    return value
  }
  return undefined
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const status = parseStatus(req.nextUrl.searchParams.get('status'))
  return NextResponse.json({
    matches: listTransferMatches(status),
    unmatched: listUnmatchedTransferTransactions(),
    summary: transferSummary(),
  })
}
