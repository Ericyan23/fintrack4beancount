import { NextRequest, NextResponse } from 'next/server'
import { deleteStagedTransaction, updateStagedTransaction, type StagedAuditMetadata } from '@/lib/ingest/staged'

interface RouteParams {
  params: Promise<{ id: string; stagedId: string }>
}

interface StagedPatch {
  accountId?: string | null
  posted?: number | null
  amount?: string | null
  description?: string | null
  category?: string | null
  notes?: string | null
  tags?: string[] | null
  pending?: boolean
}

type StagedMutationError = Error & {
  code?: string
  status?: number
  statusCode?: number
}

const STRING_FIELDS = ['accountId', 'amount', 'description', 'category', 'notes'] as const

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as Record<string, unknown>
}

function parsePatch(body: Record<string, unknown>): { patch: StagedPatch } | { error: string } {
  const patch: StagedPatch = {}

  for (const field of STRING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue

    const value = body[field]
    if (value !== null && typeof value !== 'string') {
      return { error: `${field} must be a string or null` }
    }
    patch[field] = field === 'accountId' && typeof value === 'string' ? value.trim() || null : value
  }

  if (Object.prototype.hasOwnProperty.call(body, 'posted')) {
    const value = body.posted
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      return { error: 'posted must be a number or null' }
    }
    patch.posted = value
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    const value = body.tags
    if (value !== null && (!Array.isArray(value) || value.some(tag => typeof tag !== 'string'))) {
      return { error: 'tags must be an array of strings or null' }
    }
    patch.tags = value
  }

  if (Object.prototype.hasOwnProperty.call(body, 'pending')) {
    const value = body.pending
    if (typeof value !== 'boolean') {
      return { error: 'pending must be a boolean' }
    }
    patch.pending = value
  }

  return { patch }
}

function auditFromBody(body: Record<string, unknown>): StagedAuditMetadata {
  return {
    actor: typeof body.actor === 'string' ? body.actor : undefined,
    reason: typeof body.editReason === 'string' ? body.editReason : undefined,
  }
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
    name.includes('invalid') ||
    message.includes('account not found')
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
    message.includes('merged')
  ) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }

  return null
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
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

  const parsed = parsePatch(body)
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const result = await updateStagedTransaction({
      importRunId: id,
      stagedTransactionId: stagedId,
      patch: parsed.patch,
      audit: auditFromBody(body),
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = mutationErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id, stagedId } = await params
  let body: Record<string, unknown> | null
  try {
    body = await readBody(_req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  try {
    const result = await deleteStagedTransaction({
      importRunId: id,
      stagedTransactionId: stagedId,
      audit: auditFromBody(body),
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = mutationErrorResponse(error)
    if (response) return response
    throw error
  }
}
