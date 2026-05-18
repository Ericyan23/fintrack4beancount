import { NextRequest, NextResponse } from 'next/server'
import {
  countActiveReviewCategory,
  countActiveUnclassified,
  listTransactions,
  parseTransactionFilters,
} from '@/lib/transactions/query'
import {
  createManualTransaction,
  ManualTransactionValidationError,
  type ManualTransactionInput,
} from '@/lib/transactions/manual-create'

function parsePageInt(value: string | null, fallback: number, min: number, max?: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  const bounded = Math.max(min, parsed)
  return max === undefined ? bounded : Math.min(bounded, max)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const filters = parseTransactionFilters(searchParams)
  const limit = parsePageInt(searchParams.get('limit'), 50, 1, 200)
  const offset = parsePageInt(searchParams.get('offset'), 0, 0)
  const { transactions, total, hasMore } = listTransactions(filters, limit, offset)

  return NextResponse.json({
    transactions,
    total,
    hasMore,
    unclassifiedTotal: countActiveUnclassified(),
    reviewCategoryTotal: countActiveReviewCategory(),
  })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as Record<string, unknown>
}

function optionalString(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, field)) return undefined
  const value = body[field]
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function parseManualTransactionInput(body: Record<string, unknown>): ManualTransactionInput | { error: string } {
  const tags = body.tags
  if (tags !== undefined && tags !== null && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string'))) {
    return { error: 'tags must be an array of strings' }
  }

  const posted = body.posted
  if (posted !== undefined && posted !== null && (typeof posted !== 'number' || !Number.isFinite(posted))) {
    return { error: 'posted must be a number' }
  }

  return {
    accountId: typeof body.accountId === 'string' ? body.accountId : '',
    posted: typeof posted === 'number' ? posted : undefined,
    postedDate: optionalString(body, 'postedDate') ?? undefined,
    amount: typeof body.amount === 'string' ? body.amount : '',
    description: typeof body.description === 'string' ? body.description : '',
    ledgerAccount: optionalString(body, 'ledgerAccount'),
    notes: optionalString(body, 'notes'),
    tags: Array.isArray(tags) ? tags : undefined,
    actor: optionalString(body, 'actor'),
    createReason: optionalString(body, 'createReason') ?? optionalString(body, 'editReason'),
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const parsed = parseManualTransactionInput(body)
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const result = createManualTransaction(parsed)
    return NextResponse.json(result, {
      status: 201,
      headers: {
        Location: `/transactions/${encodeURIComponent(result.transaction.id)}`,
      },
    })
  } catch (error) {
    if (error instanceof ManualTransactionValidationError) {
      return NextResponse.json({
        error: error.message,
        validationErrors: error.validationErrors,
      }, { status: error.status })
    }
    throw error
  }
}
