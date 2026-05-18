import { NextRequest, NextResponse } from 'next/server'
import {
  ImportRunNotFoundError,
  InvalidBeancountCommodityError,
  SecurityNotFoundInRunError,
  updateSecurityMapping,
} from '@/lib/ingest/security-mapping'

interface RouteParams {
  params: Promise<{ id: string; securityId: string }>
}

interface PatchBody {
  beancountCommodity?: unknown
  actor?: unknown
  reason?: unknown
}

async function readBody(req: NextRequest): Promise<PatchBody | null> {
  const text = await req.text()
  if (!text.trim()) return null

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as PatchBody
}

function parseCommodity(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id, securityId } = await params

  let body: PatchBody | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null || !Object.prototype.hasOwnProperty.call(body, 'beancountCommodity')) {
    return NextResponse.json({ error: 'Request body must include beancountCommodity' }, { status: 400 })
  }

  const beancountCommodity = parseCommodity(body.beancountCommodity)
  if (beancountCommodity === undefined) {
    return NextResponse.json({ error: 'beancountCommodity must be a string or null' }, { status: 400 })
  }

  try {
    const security = updateSecurityMapping({
      importRunId: id,
      securityId,
      beancountCommodity,
      actor: typeof body.actor === 'string' ? body.actor : undefined,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    })

    return NextResponse.json({ security })
  } catch (error) {
    if (error instanceof ImportRunNotFoundError || error instanceof SecurityNotFoundInRunError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof InvalidBeancountCommodityError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
