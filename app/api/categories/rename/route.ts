import { NextRequest, NextResponse } from 'next/server'
import { renameCategory, loadCategoriesWithStats } from '@/lib/categories'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { from, to } = (await req.json()) as { from: string; to: string }
  if (!from?.trim() || !to?.trim()) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 })
  }

  const result = renameCategory(from.trim(), to.trim())
  if (result.error) return NextResponse.json({ error: result.error }, { status: 409 })

  const rows = loadCategoriesWithStats()
  return NextResponse.json({ categories: rows.map(r => r.name), stats: rows })
}
