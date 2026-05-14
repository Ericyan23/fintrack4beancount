import { NextRequest, NextResponse } from 'next/server'
import { previewTransactionsCsv, type CsvPreviewMapping } from '@/lib/ingest/csv-preview'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    csv?: string
    mapping?: CsvPreviewMapping
    defaultAccountId?: string
  }

  if (!body.csv?.trim()) {
    return NextResponse.json({ error: 'CSV required' }, { status: 400 })
  }

  return NextResponse.json(previewTransactionsCsv(body.csv, body.mapping, body.defaultAccountId))
}
