import { NextRequest, NextResponse } from 'next/server'
import { ignoreStagedTransaction } from '@/lib/ingest/staged'

interface RouteParams {
  params: Promise<{ id: string; stagedId: string }>
}

type StagedMutationError = Error & {
  code?: string
  status?: number
  statusCode?: number
}

function mutationErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof Error)) return null

  const mutationError = error as StagedMutationError
  const status = mutationError.status ?? mutationError.statusCode
  const code = mutationError.code?.toLowerCase()
  const name = mutationError.name.toLowerCase()
  const message = mutationError.message.toLowerCase()

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

export async function POST(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id, stagedId } = await params

  try {
    const result = await ignoreStagedTransaction({
      importRunId: id,
      stagedTransactionId: stagedId,
    })
    return NextResponse.json(result)
  } catch (error) {
    const response = mutationErrorResponse(error)
    if (response) return response
    throw error
  }
}
