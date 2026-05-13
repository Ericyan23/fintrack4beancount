import { NextRequest, NextResponse } from 'next/server'
import { mergeCategories, loadCategoriesWithStats } from '@/lib/categories'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { source, target } = (await req.json()) as { source: string; target: string }
  if (!source?.trim() || !target?.trim()) {
    return NextResponse.json({ error: 'source and target required' }, { status: 400 })
  }
  if (source === target) {
    return NextResponse.json({ error: '源和目标不能相同' }, { status: 400 })
  }

  const result = mergeCategories(source.trim(), target.trim())
  if (result.error) return NextResponse.json({ error: result.error }, { status: 409 })

  const rows = loadCategoriesWithStats()
  return NextResponse.json({ merged: result.count, categories: rows.map(r => r.name), stats: rows })
}
