import cron from 'node-cron'
import { getSetting } from '@/lib/db'
import { SimpleFinStageError, stageConfiguredSimpleFin } from './simplefin-stage'

let scheduled = false

function parseSyncHour(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null
  return parsed
}

function getConfiguredSyncHour(): number {
  return parseSyncHour(getSetting('sync_hour')) ?? parseSyncHour(process.env.SYNC_HOUR) ?? 3
}

export function startScheduler(): void {
  if (scheduled) return
  scheduled = true

  cron.schedule('0 * * * *', async () => {
    const hour = getConfiguredSyncHour()
    if (new Date().getHours() !== hour) return

    console.log('[cron] Starting daily SimpleFIN staging')
    try {
      const result = await stageConfiguredSimpleFin()
      console.log(`[cron] Done: staged ${result.staged} transactions in import run ${result.importRunId}`)
    } catch (err) {
      if (err instanceof SimpleFinStageError) {
        console.error(`[cron] SimpleFIN staging error: ${err.message}`)
        return
      }
      console.error('[cron] Unexpected error:', err)
    }
  })

  console.log('[cron] Scheduled hourly SimpleFIN staging check')
}
