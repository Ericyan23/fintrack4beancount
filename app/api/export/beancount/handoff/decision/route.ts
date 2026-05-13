import { NextRequest, NextResponse } from 'next/server'
import {
  type HandoffDecisionValue,
  reviewErrorStatus,
  writeHandoffDecision,
} from '@/lib/export/handoff-review'
import { currentPeriod } from '@/lib/export/preflight'

interface HandoffDecisionBody {
  period?: string | null
  decision?: string | null
  note?: string | null
}

function isDecision(value: string | null | undefined): value is HandoffDecisionValue {
  return value === 'approve' || value === 'reject'
}

async function readBody(req: NextRequest): Promise<HandoffDecisionBody> {
  if (!req.body) return {}
  return await req.json().catch(() => ({})) as HandoffDecisionBody
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readBody(req)
  const period = body.period?.trim() || currentPeriod()

  if (!isDecision(body.decision)) {
    return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 })
  }

  try {
    const state = writeHandoffDecision({
      period,
      decision: body.decision,
      note: body.note ?? null,
    })
    return NextResponse.json(state, {
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: reviewErrorStatus(err) })
  }
}
