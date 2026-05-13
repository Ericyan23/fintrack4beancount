import { NextRequest, NextResponse } from 'next/server'
import { loadCategoriesWithStats, addCategory, deleteCategory } from '@/lib/categories'

export async function GET(): Promise<NextResponse> {
  const rows = loadCategoriesWithStats()
  const categories = rows.map(r => r.name)
  return NextResponse.json({ categories, stats: rows })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { name } = (await req.json()) as { name: string }
  const trimmed = name?.trim()
  if (!trimmed) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const result = addCategory(trimmed)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 409 })

  const rows = loadCategoriesWithStats()
  return NextResponse.json({ categories: rows.map(r => r.name), stats: rows }, { status: 201 })
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const name = req.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const result = deleteCategory(name)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 409 })

  const rows = loadCategoriesWithStats()
  return NextResponse.json({ categories: rows.map(r => r.name), stats: rows })
}
