import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'

interface BalanceAssertionRow {
  id: string
  fintrackAccountId: string | null
  fintrackAccountName: string | null
  beancountAccount: string
  assertionDate: string
  amount: string
  currency: string
  sourceId: string
  status: string
  note: string | null
  createdAt: number
  updatedAt: number
}

interface AccountRow {
  id: string
  name: string
  currency: string
  beancountAccount: string | null
}

interface CreateBalanceAssertionBody {
  fintrackAccountId?: string | null
  beancountAccount?: string | null
  assertionDate?: string | null
  amount?: string | number | null
  currency?: string | null
  note?: string | null
}

type BalanceAssertionStatus = 'draft' | 'staged' | 'merged' | 'rejected'

interface UpdateBalanceAssertionBody {
  id?: string | null
  status?: string | null
}

const BALANCE_ASSERTION_STATUSES: BalanceAssertionStatus[] = ['draft', 'staged', 'merged', 'rejected']

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeDate(value: string | null | undefined): string {
  const trimmed = normalizeText(value)
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('assertionDate must use YYYY-MM-DD')
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error('assertionDate is invalid')
  }
  return trimmed
}

function normalizeAmount(value: string | number | null | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('amount is required')

  const amount = Number(text)
  if (!Number.isFinite(amount)) throw new Error('amount is invalid')
  const normalized = Math.abs(amount) < 0.005 ? 0 : amount
  return normalized.toFixed(2)
}

function normalizeCurrency(value: string | null | undefined, fallback = 'USD'): string {
  const currency = (normalizeText(value) ?? fallback).toUpperCase()
  if (!/^[A-Z][A-Z0-9_-]{2,11}$/.test(currency)) {
    throw new Error('currency is invalid')
  }
  return currency
}

function periodRange(period: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('period must use YYYY-MM')
  const startDate = new Date(`${period}-01T00:00:00Z`)
  if (Number.isNaN(startDate.getTime())) throw new Error('period is invalid')
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0))
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  }
}

function sourceIdForAssertion(id: string): string {
  return `fintrack:balance-assertion:${id}`
}

function isBalanceAssertionStatus(value: string | null | undefined): value is BalanceAssertionStatus {
  return BALANCE_ASSERTION_STATUSES.includes(value as BalanceAssertionStatus)
}

function loadAccount(id: string | null): AccountRow | null {
  if (!id) return null
  const row = sqlite.prepare(`
    SELECT
      id,
      name,
      currency,
      beancount_account AS beancountAccount
    FROM accounts
    WHERE id = ?
  `).get(id) as AccountRow | undefined
  return row ?? null
}

function selectBalanceAssertionSql(): string {
  return `
    SELECT
      b.id,
      b.fintrack_account_id AS fintrackAccountId,
      a.name AS fintrackAccountName,
      b.beancount_account AS beancountAccount,
      b.assertion_date AS assertionDate,
      b.amount,
      b.currency,
      b.source_id AS sourceId,
      b.status,
      b.note,
      b.created_at AS createdAt,
      b.updated_at AS updatedAt
    FROM balance_assertions b
    LEFT JOIN accounts a ON a.id = b.fintrack_account_id
  `
}

function loadBalanceAssertion(id: string): BalanceAssertionRow | null {
  const row = sqlite.prepare(`
    ${selectBalanceAssertionSql()}
    WHERE b.id = ?
  `).get(id) as BalanceAssertionRow | undefined
  return row ?? null
}

function loadBalanceAssertions(period: string | null): BalanceAssertionRow[] {
  if (period) {
    const range = periodRange(period)
    return sqlite.prepare(`
      ${selectBalanceAssertionSql()}
      WHERE b.assertion_date BETWEEN ? AND ?
      ORDER BY b.assertion_date DESC, b.created_at DESC
    `).all(range.start, range.end) as BalanceAssertionRow[]
  }

  return sqlite.prepare(`
    ${selectBalanceAssertionSql()}
    ORDER BY b.assertion_date DESC, b.created_at DESC
  `).all() as BalanceAssertionRow[]
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const period = req.nextUrl.searchParams.get('period')
    return NextResponse.json({ balanceAssertions: loadBalanceAssertions(period) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as CreateBalanceAssertionBody
    const fintrackAccountId = normalizeText(body.fintrackAccountId)
    const account = loadAccount(fintrackAccountId)
    if (fintrackAccountId && !account) {
      return NextResponse.json({ error: 'fintrackAccountId not found' }, { status: 404 })
    }

    const id = randomUUID()
    const beancountAccount = normalizeText(body.beancountAccount) ?? account?.beancountAccount ?? null
    if (!beancountAccount) {
      return NextResponse.json({ error: 'beancountAccount is required' }, { status: 400 })
    }

    const assertionDate = normalizeDate(body.assertionDate)
    const amount = normalizeAmount(body.amount)
    const currency = normalizeCurrency(body.currency, account?.currency ?? 'USD')
    const note = normalizeText(body.note)
    const now = Math.floor(Date.now() / 1000)

    sqlite.prepare(`
      INSERT INTO balance_assertions (
        id,
        fintrack_account_id,
        beancount_account,
        assertion_date,
        amount,
        currency,
        source_id,
        status,
        note,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `).run(
      id,
      fintrackAccountId,
      beancountAccount,
      assertionDate,
      amount,
      currency,
      sourceIdForAssertion(id),
      note,
      now,
      now,
    )

    const balanceAssertion = loadBalanceAssertion(id)
    return NextResponse.json({ balanceAssertion }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as UpdateBalanceAssertionBody
    const id = normalizeText(body.id)
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (!isBalanceAssertionStatus(body.status)) {
      return NextResponse.json({ error: 'status must be draft, staged, merged, or rejected' }, { status: 400 })
    }

    const existing = loadBalanceAssertion(id)
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    sqlite.prepare(`
      UPDATE balance_assertions
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(body.status, Math.floor(Date.now() / 1000), id)

    return NextResponse.json({ balanceAssertion: loadBalanceAssertion(id) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = loadBalanceAssertion(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only draft assertions can be deleted' }, { status: 409 })
  }

  sqlite.prepare('DELETE FROM balance_assertions WHERE id = ?').run(id)
  return NextResponse.json({ success: true })
}
