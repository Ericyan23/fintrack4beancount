import cron from 'node-cron'
import { getSetting } from '@/lib/db'
import { syncSimpleFin } from './simplefin'

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

    console.log('[cron] Starting daily SimpleFIN sync')
    try {
      const result = await syncSimpleFin()
      if (result.error) {
        console.error(`[cron] Sync error: ${result.error}`)
      } else {
        console.log(`[cron] Done: ${result.newCount} new transactions`)
      }
    } catch (err) {
      console.error('[cron] Unexpected error:', err)
    }
  })

  console.log('[cron] Scheduled hourly SimpleFIN sync check')
}
