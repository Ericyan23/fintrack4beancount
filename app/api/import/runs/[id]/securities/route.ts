import { NextRequest, NextResponse } from 'next/server'
import {
  ImportRunNotFoundError,
  listImportRunSecurities,
} from '@/lib/ingest/security-mapping'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params

  try {
    return NextResponse.json({
      securities: listImportRunSecurities({ importRunId: id }),
    })
  } catch (error) {
    if (error instanceof ImportRunNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    throw error
  }
}
