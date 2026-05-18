import { NextRequest, NextResponse } from 'next/server'
import { buildBeancountHandoffManifest } from '@/lib/export/handoff-manifest'
import { currentPeriod } from '@/lib/export/preflight'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentPeriod()
  const excludeExported = req.nextUrl.searchParams.get('excludeExported') === '1'

  try {
    return NextResponse.json(buildBeancountHandoffManifest({ period, excludeExported }), {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
