import { NextRequest, NextResponse } from 'next/server'
import { readHandoffReviewState, reviewErrorStatus } from '@/lib/export/handoff-review'
import { currentPeriod } from '@/lib/export/preflight'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentPeriod()

  try {
    return NextResponse.json(readHandoffReviewState({ period }), {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: reviewErrorStatus(err) })
  }
}
