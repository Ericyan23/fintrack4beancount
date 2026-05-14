import { NextRequest, NextResponse } from 'next/server'
import { stageTransactionsCsv } from '@/lib/ingest/csv-import'
import type { CsvImportMapping } from '@/lib/ingest/csv'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    csv?: string
    mapping?: CsvImportMapping
    defaultAccountId?: string
    connectionName?: string
  }

  if (!body.csv?.trim()) {
    return NextResponse.json({ error: 'CSV required' }, { status: 400 })
  }
  if (!body.mapping?.date || !body.mapping.amount || !body.mapping.description) {
    return NextResponse.json({ error: 'date, amount, and description mappings are required' }, { status: 400 })
  }

  const result = stageTransactionsCsv(body.csv, body.mapping, body.defaultAccountId, body.connectionName)
  return NextResponse.json({
    ...result,
    reviewUrl: `/import/runs/${encodeURIComponent(result.importRunId)}`,
  })
}
