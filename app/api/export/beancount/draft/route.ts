import { NextRequest, NextResponse } from 'next/server'
import { renderBeancountDraft } from '@/lib/export/beancount'
import { currentPeriod, runBeancountPreflight } from '@/lib/export/preflight'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentPeriod()

  try {
    const preflight = runBeancountPreflight({ period })
    if (preflight.blockers.length > 0) {
      return NextResponse.json({
        error: 'Beancount preflight has blockers',
        period: preflight.period,
        summary: preflight.summary,
        blockers: preflight.blockers,
      }, { status: 409 })
    }

    const draft = renderBeancountDraft(preflight)
    return new NextResponse(draft, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${preflight.period}-fintrack.bean"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
