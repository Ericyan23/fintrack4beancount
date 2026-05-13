import { NextRequest, NextResponse } from 'next/server'
import { currentPeriod, runBeancountPreflight } from '@/lib/export/preflight'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentPeriod()

  try {
    return NextResponse.json(runBeancountPreflight({ period }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
