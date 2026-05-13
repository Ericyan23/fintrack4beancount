import { NextRequest, NextResponse } from 'next/server'
import { getCategoryImpact, isRequiredCategory } from '@/lib/categories'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const name = req.nextUrl.searchParams.get('name')?.trim()
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const impact = getCategoryImpact(name)
  const isRequired = isRequiredCategory(name)
  const hasUsage = impact.transactions > 0 || impact.suggestions > 0 || impact.rules > 0

  return NextResponse.json({
    name,
    impact,
    isRequired,
    canDelete: !isRequired && !hasUsage,
    canRename: !isRequired,
    canMerge: !isRequired,
  })
}
