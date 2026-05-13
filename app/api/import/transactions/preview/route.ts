import { NextRequest, NextResponse } from 'next/server'
import { previewTransactionsCsv, type ImportMapping } from '@/lib/import/transactions'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    csv?: string
    mapping?: ImportMapping
    defaultAccountId?: string
  }

  if (!body.csv?.trim()) {
    return NextResponse.json({ error: 'CSV required' }, { status: 400 })
  }

  return NextResponse.json(previewTransactionsCsv(body.csv, body.mapping, body.defaultAccountId))
}
