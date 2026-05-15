import { NextRequest, NextResponse } from 'next/server'
import { stageTransactionsCsv } from '@/lib/ingest/csv-import'
import { getCsvImportProfile } from '@/lib/ingest/profiles'
import type { CsvImportMapping } from '@/lib/ingest/csv'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    csv?: string
    mapping?: CsvImportMapping
    defaultAccountId?: string
    connectionName?: string
    importProfileId?: string
    defaultLedgerAccount?: string
    parserProfileId?: string | null
  }

  if (!body.csv?.trim()) {
    return NextResponse.json({ error: 'CSV required' }, { status: 400 })
  }
  if (!body.mapping?.date || !body.mapping.amount || !body.mapping.description) {
    return NextResponse.json({ error: 'date, amount, and description mappings are required' }, { status: 400 })
  }
  if (body.importProfileId && !getCsvImportProfile(body.importProfileId)) {
    return NextResponse.json({ error: 'CSV import profile not found' }, { status: 404 })
  }

  const result = stageTransactionsCsv(
    body.csv,
    body.mapping,
    body.defaultAccountId,
    body.connectionName,
    body.importProfileId,
    body.defaultLedgerAccount,
    body.parserProfileId,
  )
  return NextResponse.json({
    ...result,
    reviewUrl: `/import/runs/${encodeURIComponent(result.importRunId)}`,
  })
}
