import { NextRequest, NextResponse } from 'next/server'
import {
  resolveExpiredPendingStagedTransaction,
  type ResolveExpiredPendingAction,
} from '@/lib/ingest/staged'

interface RouteParams {
  params: Promise<{ id: string; stagedId: string }>
}

type StagedMutationError = Error & {
  code?: string
  status?: number
  statusCode?: number
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as Record<string, unknown>
}

function parseAction(body: Record<string, unknown>): ResolveExpiredPendingAction | null {
  return body.action === 'cancel_pending' || body.action === 'keep_pending'
    ? body.action
    : null
}

function mutationErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof Error)) return null

  const mutationError = error as StagedMutationError
  const status = mutationError.status ?? mutationError.statusCode
  const code = mutationError.code?.toLowerCase()
  const name = mutationError.name.toLowerCase()
  const message = mutationError.message.toLowerCase()

  if (
    status === 400 ||
    code?.includes('invalid') ||
    name.includes('invalid')
  ) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (
    status === 404 ||
    code?.includes('not_found') ||
    name.includes('notfound') ||
    name.includes('not_found') ||
    message.includes('not found')
  ) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  if (
    status === 409 ||
    code?.includes('conflict') ||
    code?.includes('merged') ||
    name.includes('conflict') ||
    name.includes('merged') ||
    message.includes('no longer pending') ||
    message.includes('not an expired pending')
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }

  return null
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id, stagedId } = await params

  let body: Record<string, unknown> | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const action = parseAction(body)
  if (!action) {
    return NextResponse.json(
      { error: 'action must be cancel_pending or keep_pending' },
      { status: 400 },
    )
  }

  try {
    const result = resolveExpiredPendingStagedTransaction({
      importRunId: id,
      stagedTransactionId: stagedId,
      action,
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = mutationErrorResponse(error)
    if (response) return response
    throw error
  }
}
