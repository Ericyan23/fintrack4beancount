import { NextResponse } from 'next/server'
import { getSetting } from '@/lib/db'
import { stageSimpleFinPayload } from '@/lib/ingest/simplefin-import'
import { fetchSimpleFINPayload, SimpleFINAdapterError } from '@/lib/sync/simplefin-adapter'

const SIMPLEFIN_STAGE_LOOKBACK_DAYS = 90
const SIMPLEFIN_STAGE_VERSION = 2
const SIMPLEFIN_STAGE_CONNECTION_ID = 'simplefin:primary'

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function configuredAccessUrl(): string | null {
  return getSetting('simplefin_access_url') ?? process.env.SIMPLEFIN_ACCESS_URL ?? null
}

function safeStageError(error: unknown): { message: string; status: number } {
  if (error instanceof SimpleFINAdapterError) {
    return { message: 'SimpleFIN stage import failed', status: 502 }
  }
  return { message: 'SimpleFIN stage import failed', status: 500 }
}

export async function POST(): Promise<NextResponse> {
  const accessUrl = configuredAccessUrl()
  if (!accessUrl) {
    return NextResponse.json(
      { success: false, error: 'No SimpleFIN access URL configured' },
      { status: 400 },
    )
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(accessUrl)
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid SimpleFIN access URL' },
      { status: 400 },
    )
  }

  const startDate = nowSeconds() - SIMPLEFIN_STAGE_LOOKBACK_DAYS * 86400

  try {
    const payload = await fetchSimpleFINPayload(accessUrl, {
      startDate,
      pending: true,
      version: SIMPLEFIN_STAGE_VERSION,
    })
    const result = stageSimpleFinPayload(payload, {
      sourceConnectionId: SIMPLEFIN_STAGE_CONNECTION_ID,
      sourceConnectionName: 'SimpleFIN Primary',
      sourceName: 'SimpleFIN',
      config: {
        mode: 'shadow-stage',
        lookbackDays: SIMPLEFIN_STAGE_LOOKBACK_DAYS,
        pending: true,
        version: SIMPLEFIN_STAGE_VERSION,
      },
    })

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    const { message, status } = safeStageError(error)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
