import { NextRequest, NextResponse } from 'next/server'
import {
  AccountNotFoundError,
  ImportRunNotFoundError,
  SourceAccountNotFoundInRunError,
  updateSourceAccountMapping,
} from '@/lib/ingest/account-mapping'

interface RouteParams {
  params: Promise<{ id: string; sourceAccountId: string }>
}

interface PatchBody {
  accountId?: unknown
}

async function readBody(req: NextRequest): Promise<PatchBody | null> {
  const text = await req.text()
  if (!text.trim()) return null

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as PatchBody
}

function parseAccountId(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id, sourceAccountId } = await params

  let body: PatchBody | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null || !Object.prototype.hasOwnProperty.call(body, 'accountId')) {
    return NextResponse.json({ error: 'Request body must include accountId' }, { status: 400 })
  }

  const accountId = parseAccountId(body.accountId)
  if (accountId === undefined) {
    return NextResponse.json({ error: 'accountId must be a non-empty string or null' }, { status: 400 })
  }

  try {
    const sourceAccount = updateSourceAccountMapping({
      importRunId: id,
      sourceAccountId,
      accountId,
    })

    return NextResponse.json({ sourceAccount })
  } catch (error) {
    if (error instanceof ImportRunNotFoundError || error instanceof SourceAccountNotFoundInRunError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof AccountNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
