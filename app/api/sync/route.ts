import { NextResponse } from 'next/server'
import { syncSimpleFin } from '@/lib/sync/simplefin'

export async function POST(): Promise<NextResponse> {
  try {
    const result = await syncSimpleFin()
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }
    return NextResponse.json({ success: true, newCount: result.newCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
