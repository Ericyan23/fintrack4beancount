import { NextRequest, NextResponse } from 'next/server'
import {
  clearTransactionSplits,
  listTransactionSplits,
  ParentTransactionNotFoundError,
  replaceTransactionSplits,
  TransactionSplitConflictError,
  type TransactionSplitInput,
  type TransactionSplitAuditMetadata,
} from '@/lib/ingest/splits'

interface RouteParams {
  params: Promise<{ id: string }>
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (!text.trim()) return null

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as Record<string, unknown>
}

function parseSplits(body: Record<string, unknown>): { splits: TransactionSplitInput[] } | { error: string } {
  if (!Object.prototype.hasOwnProperty.call(body, 'splits')) {
    return { error: 'Request body must include splits' }
  }
  if (!Array.isArray(body.splits)) {
    return { error: 'splits must be an array' }
  }

  const splits: TransactionSplitInput[] = []
  for (const [index, value] of body.splits.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `Split ${index + 1} must be a JSON object` }
    }

    const split = value as Record<string, unknown>
    if (typeof split.amount !== 'string') {
      return { error: `Split ${index + 1} amount must be a string` }
    }
    if (typeof split.ledgerAccount !== 'string') {
      return { error: `Split ${index + 1} ledgerAccount must be a string` }
    }

    const parsed: TransactionSplitInput = {
      amount: split.amount,
      ledgerAccount: split.ledgerAccount,
    }

    if (Object.prototype.hasOwnProperty.call(split, 'currency')) {
      if (typeof split.currency !== 'string') {
        return { error: `Split ${index + 1} currency must be a string` }
      }
      parsed.currency = split.currency
    }

    for (const field of ['memo', 'notes'] as const) {
      if (!Object.prototype.hasOwnProperty.call(split, field)) continue

      const fieldValue = split[field]
      if (fieldValue !== null && typeof fieldValue !== 'string') {
        return { error: `Split ${index + 1} ${field} must be a string or null` }
      }
      parsed[field] = fieldValue
    }

    splits.push(parsed)
  }

  return { splits }
}

function splitAuditFromBody(body: Record<string, unknown> | null): TransactionSplitAuditMetadata | undefined {
  if (!body) return undefined

  return {
    actor: typeof body.actor === 'string' ? body.actor : undefined,
    reason: typeof body.editReason === 'string' ? body.editReason : undefined,
  }
}

function splitErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof ParentTransactionNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof TransactionSplitConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return null
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  try {
    return NextResponse.json({ splits: listTransactionSplits(id) })
  } catch (error) {
    const response = splitErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params

  let body: Record<string, unknown> | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const parsed = parseSplits(body)
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    return NextResponse.json({
      splits: replaceTransactionSplits({
        parentTransactionId: id,
        splits: parsed.splits,
        audit: splitAuditFromBody(body),
      }),
    })
  } catch (error) {
    const response = splitErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  let body: Record<string, unknown> | null = null

  try {
    body = await readBody(_req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    return NextResponse.json({ splits: clearTransactionSplits(id, splitAuditFromBody(body)) })
  } catch (error) {
    const response = splitErrorResponse(error)
    if (response) return response
    throw error
  }
}
