import { NextRequest, NextResponse } from 'next/server'
import {
  InvestmentActivityInvalidInputError,
  InvestmentActivityNotFoundError,
  updateInvestmentActivityStatus,
  type InvestmentActivityAuditMetadata,
} from '@/lib/ingest/investments'
import type { InvestmentActivityStatus } from '@/lib/ingest/types'

interface RouteParams {
  params: Promise<{ id: string; activityId: string }>
}

const INVESTMENT_ACTIVITY_STATUSES = new Set(['blocked', 'needs_review', 'reviewed', 'ignored'])

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as Record<string, unknown>
}

function parseStatus(body: Record<string, unknown>): InvestmentActivityStatus | null {
  const status = body.status
  if (typeof status !== 'string') return null
  if (!INVESTMENT_ACTIVITY_STATUSES.has(status)) return null
  return status as InvestmentActivityStatus
}

function auditFromBody(body: Record<string, unknown>): InvestmentActivityAuditMetadata {
  return {
    actor: typeof body.actor === 'string' ? body.actor : undefined,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  }
}

function mutationErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof InvestmentActivityInvalidInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof InvestmentActivityNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  return null
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id, activityId } = await params

  let body: Record<string, unknown> | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const status = parseStatus(body)
  if (!status) {
    return NextResponse.json({ error: 'status must be blocked, needs_review, reviewed, or ignored' }, { status: 400 })
  }

  try {
    const result = updateInvestmentActivityStatus({
      importRunId: id,
      investmentActivityId: activityId,
      status,
      audit: auditFromBody(body),
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = mutationErrorResponse(error)
    if (response) return response
    throw error
  }
}
