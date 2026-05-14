import { getSetting } from '@/lib/db'
import { stageSimpleFinPayload, type StageSimpleFinPayloadResult } from '@/lib/ingest/simplefin-import'
import { fetchSimpleFINPayload, SimpleFINAdapterError } from '@/lib/sync/simplefin-adapter'

const SIMPLEFIN_STAGE_LOOKBACK_DAYS = 90
const SIMPLEFIN_STAGE_VERSION = 2
const SIMPLEFIN_STAGE_CONNECTION_ID = 'simplefin:primary'

export class SimpleFinStageError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SimpleFinStageError'
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function configuredAccessUrl(): string | null {
  return getSetting('simplefin_access_url') ?? process.env.SIMPLEFIN_ACCESS_URL ?? null
}

export async function stageConfiguredSimpleFin(): Promise<StageSimpleFinPayloadResult> {
  const accessUrl = configuredAccessUrl()
  if (!accessUrl) {
    throw new SimpleFinStageError('No SimpleFIN access URL configured', 400)
  }

  try {
    new URL(accessUrl)
  } catch {
    throw new SimpleFinStageError('Invalid SimpleFIN access URL', 400)
  }

  const startDate = nowSeconds() - SIMPLEFIN_STAGE_LOOKBACK_DAYS * 86400

  try {
    const payload = await fetchSimpleFINPayload(accessUrl, {
      startDate,
      pending: true,
      version: SIMPLEFIN_STAGE_VERSION,
    })

    return stageSimpleFinPayload(payload, {
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
  } catch (error) {
    if (error instanceof SimpleFinStageError) throw error
    if (error instanceof SimpleFINAdapterError) {
      throw new SimpleFinStageError('SimpleFIN stage import failed', 502)
    }
    throw new SimpleFinStageError('SimpleFIN stage import failed', 500)
  }
}
