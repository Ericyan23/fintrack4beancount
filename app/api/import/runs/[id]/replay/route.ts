import { NextRequest, NextResponse } from 'next/server'
import {
  ImportRunReplayConflictError,
  ImportRunReplayNotFoundError,
  replayImportRun,
} from '@/lib/ingest/replay'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface ReplayRequestBody {
  actor?: string | null
  reason?: string | null
}

async function readBody(req: NextRequest): Promise<ReplayRequestBody | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as ReplayRequestBody
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params

  let body: ReplayRequestBody | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  try {
    const replay = replayImportRun({
      importRunId: id,
      actor: body.actor,
      reason: body.reason,
    })

    return NextResponse.json({
      replay,
      importRunId: replay.importRunId,
      reviewUrl: `/import/runs/${encodeURIComponent(replay.importRunId)}`,
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ImportRunReplayNotFoundError) {
      return NextResponse.json({ error: 'Import run not found' }, { status: 404 })
    }
    if (error instanceof ImportRunReplayConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}
