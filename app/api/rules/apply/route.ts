import { NextResponse } from 'next/server'
import { reclassifyUnmatched } from '@/lib/classify/rules'
import { sqlite } from '@/lib/db'

function countUnclassified() {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM transactions
    WHERE category IS NULL AND status = 'posted'
  `).get() as { total: number }
  return row.total
}

export async function POST(): Promise<NextResponse> {
  const before = countUnclassified()
  await reclassifyUnmatched()
  const after = countUnclassified()
  return NextResponse.json({ applied: before - after, remaining: after })
}
