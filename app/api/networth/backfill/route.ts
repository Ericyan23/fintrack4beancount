import { NextResponse } from 'next/server'
import { backfillNetWorthHistory } from '@/lib/networth'

export async function POST(): Promise<NextResponse> {
  try {
    await backfillNetWorthHistory()
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
