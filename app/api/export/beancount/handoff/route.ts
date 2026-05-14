import { NextRequest, NextResponse } from 'next/server'
import {
  HandoffFileExistsError,
  HandoffPreflightError,
  writeBeancountHandoff,
} from '@/lib/export/handoff-writer'
import { currentPeriod } from '@/lib/export/preflight'

interface HandoffRequestBody {
  period?: string | null
  overwrite?: boolean | null
  actor?: string | null
  reason?: string | null
}

async function readBody(req: NextRequest): Promise<HandoffRequestBody> {
  if (!req.body) return {}
  return await req.json().catch(() => ({})) as HandoffRequestBody
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readBody(req)
  const period = body.period?.trim() || currentPeriod()
  const overwrite = body.overwrite === true

  try {
    const result = writeBeancountHandoff({
      period,
      overwrite,
      audit: {
        actor: body.actor,
        reason: body.reason,
      },
    })
    return NextResponse.json(result, {
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof HandoffPreflightError) {
      return NextResponse.json({
        error: err.message,
        manifest: err.manifest,
      }, { status: 409 })
    }

    if (err instanceof HandoffFileExistsError) {
      return NextResponse.json({
        error: err.message,
        file: err.file,
      }, { status: 409 })
    }

    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
