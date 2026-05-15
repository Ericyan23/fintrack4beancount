import { NextRequest, NextResponse } from 'next/server'
import { renderBeancountDraft } from '@/lib/export/beancount'
import { summarizeBeancountValidation, validateBeancountDraft } from '@/lib/export/beancount-validation'
import { currentPeriod, runBeancountPreflight } from '@/lib/export/preflight'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentPeriod()
  const excludeExported = req.nextUrl.searchParams.get('excludeExported') === '1'

  try {
    const preflight = runBeancountPreflight({ period, excludeExported })
    if (preflight.blockers.length > 0) {
      return NextResponse.json({
        error: 'Beancount preflight has blockers',
        period: preflight.period,
        summary: preflight.summary,
        blockers: preflight.blockers,
      }, { status: 409 })
    }

    const draft = renderBeancountDraft(preflight)
    const validation = validateBeancountDraft({
      draft,
      beancountRoot: preflight.beancountRoot,
    })
    if (!validation.ok) {
      return NextResponse.json({
        error: 'External Beancount validation failed',
        validation,
      }, { status: 409 })
    }
    const validationSummary = summarizeBeancountValidation(validation)
    return new NextResponse(draft, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${preflight.period}-fintrack.bean"`,
        'Cache-Control': 'no-store',
        'X-FinTrack-Beancount-Validation': validationSummary.status,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
