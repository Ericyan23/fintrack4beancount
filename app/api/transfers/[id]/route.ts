import { NextRequest, NextResponse } from 'next/server'
import { setTransferMatchStatus, type TransferMatchStatus } from '@/lib/transfers/matcher'

interface RouteParams {
  params: Promise<{ id: string }>
}

function isStatus(value: unknown): value is TransferMatchStatus {
  return value === 'suggested' || value === 'confirmed' || value === 'ignored'
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const numericId = Number.parseInt(id, 10)
  if (!Number.isFinite(numericId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const body = (await req.json()) as { status?: unknown }
  if (!isStatus(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  setTransferMatchStatus(numericId, body.status)
  return NextResponse.json({ ok: true })
}
