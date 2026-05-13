import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { classifyByAI } from '@/lib/classify/ai'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const [txn] = db.select().from(transactions).where(eq(transactions.id, id)).all()
  if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let suggested: string | null
  try {
    suggested = await classifyByAI(txn.description)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `AI 请求失败：${msg}` }, { status: 502 })
  }
  if (!suggested) {
    return NextResponse.json({ error: '未能匹配到合适的分类，请检查 API Key 配置' }, { status: 422 })
  }

  db.update(transactions).set({ suggestedCat: suggested }).where(eq(transactions.id, id)).run()
  return NextResponse.json({ suggestedCat: suggested })
}
