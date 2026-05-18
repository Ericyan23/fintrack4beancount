import { NextRequest, NextResponse } from 'next/server'
import { summarizeBeancountValidation, validateBeancountDraft } from '@/lib/export/beancount-validation'
import {
  currentBalanceAssertionPeriod,
  renderBalanceAssertionDraft,
  runBalanceAssertionPreflight,
} from '@/lib/export/balance-assertions'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const period = req.nextUrl.searchParams.get('period') ?? currentBalanceAssertionPeriod()
  const excludeExported = req.nextUrl.searchParams.get('excludeExported') === '1'

  try {
    const preflight = runBalanceAssertionPreflight({ period, excludeExported })
    if (preflight.blockers.length > 0) {
      return NextResponse.json({
        error: 'Balance assertion preflight has blockers',
        period: preflight.period,
        summary: preflight.summary,
        blockers: preflight.blockers,
      }, { status: 409 })
    }

    const draft = renderBalanceAssertionDraft(preflight)
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
        'Content-Disposition': `attachment; filename="${preflight.period}-fintrack-balances.bean"`,
        'Cache-Control': 'no-store',
        'X-FinTrack-Beancount-Validation': validationSummary.status,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
