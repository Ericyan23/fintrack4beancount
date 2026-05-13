import { NextRequest, NextResponse } from 'next/server'
import {
  currentBalanceAssertionPeriod,
  runBalanceAssertionPreflight,
} from '@/lib/export/balance-assertions'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentBalanceAssertionPeriod()

  try {
    return NextResponse.json(runBalanceAssertionPreflight({ period }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
