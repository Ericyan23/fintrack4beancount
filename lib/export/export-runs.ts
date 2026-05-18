import { sqlite } from '@/lib/db'

const ACTIVE_EXPORT_STATUSES = new Set(['created', 'handoff_written', 'merged'])

interface ExportRunSourceRow {
  status: string
  exportedSourceIds: string | null
}

function parseSourceIds(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

export function loadPreviouslyExportedSourceIds(options: {
  exportTarget?: string
} = {}): Set<string> {
  const rows = options.exportTarget
    ? sqlite.prepare(`
        SELECT status,
               exported_source_ids AS exportedSourceIds
        FROM export_runs
        WHERE export_target = ?
      `).all(options.exportTarget) as ExportRunSourceRow[]
    : sqlite.prepare(`
        SELECT status,
               exported_source_ids AS exportedSourceIds
        FROM export_runs
      `).all() as ExportRunSourceRow[]

  const sourceIds = new Set<string>()
  for (const row of rows) {
    if (!ACTIVE_EXPORT_STATUSES.has(row.status)) continue
    for (const sourceId of parseSourceIds(row.exportedSourceIds)) {
      sourceIds.add(sourceId)
    }
  }
  return sourceIds
}
