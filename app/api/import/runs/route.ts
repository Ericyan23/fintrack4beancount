import { NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'

interface RunRow {
  id: string
  status: string
  lifecycleState: string
  itemCount: number
  startedAt: number | null
  error: string | null
  connectionName: string | null
  sourceKind: string | null
  eligibleCount: number
  errorCount: number
  mergedCount: number
}

export async function GET(): Promise<NextResponse> {
  const runs = sqlite.prepare(`
    SELECT
      ir.id,
      ir.status,
      CASE
        WHEN ir.status = 'failed' THEN 'failed'
        WHEN ir.status = 'completed' THEN 'reviewed'
        ELSE 'raw_imported'
      END AS lifecycleState,
      ir.item_count                                                              AS itemCount,
      ir.started_at                                                              AS startedAt,
      ir.error,
      sc.name                                                                    AS connectionName,
      s.kind                                                                     AS sourceKind,
      COALESCE(SUM(CASE WHEN st.status IN ('staged', 'ready') THEN 1 ELSE 0 END), 0) AS eligibleCount,
      COALESCE(SUM(CASE WHEN st.status = 'error'             THEN 1 ELSE 0 END), 0) AS errorCount,
      COALESCE(SUM(CASE WHEN st.status = 'merged'            THEN 1 ELSE 0 END), 0) AS mergedCount
    FROM import_runs ir
    LEFT JOIN source_connections sc ON sc.id = ir.source_connection_id
    LEFT JOIN sources s             ON s.id  = sc.source_id
    LEFT JOIN staged_transactions st ON st.import_run_id = ir.id
    GROUP BY ir.id
    ORDER BY ir.created_at DESC
    LIMIT 20
  `).all() as RunRow[]

  return NextResponse.json({ runs })
}
