import { NextResponse } from 'next/server'
import { scanTransferMatches } from '@/lib/transfers/matcher'

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(scanTransferMatches())
}
