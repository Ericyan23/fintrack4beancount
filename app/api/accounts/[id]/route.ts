import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { ACCOUNT_TYPES, type AccountType, detectAccountType } from '@/lib/accounts'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface AccountPatch {
  orgName?: string | null
  accountTypeOverride?: string | null
  beancountAccount?: string | null
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function isAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPES.includes(value as AccountType)
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params
  const body = (await req.json()) as AccountPatch

  const [existing] = db.select().from(accounts).where(eq(accounts.id, id)).all()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const nextOrgName = 'orgName' in body
    ? normalizeText(body.orgName)
    : existing.orgName
  const nextTypeOverride = 'accountTypeOverride' in body
    ? normalizeText(body.accountTypeOverride)
    : existing.accountTypeOverride
  const nextBeancountAccount = 'beancountAccount' in body
    ? normalizeText(body.beancountAccount)
    : existing.beancountAccount

  if (nextTypeOverride && !isAccountType(nextTypeOverride)) {
    return NextResponse.json({ error: 'Invalid account type' }, { status: 400 })
  }

  const detectedType = detectAccountType(existing.name, nextOrgName ?? '')
  const accountType = nextTypeOverride || detectedType

  db.update(accounts)
    .set({
      orgName: nextOrgName,
      accountTypeOverride: nextTypeOverride,
      beancountAccount: nextBeancountAccount,
      accountType,
    })
    .where(eq(accounts.id, id))
    .run()

  const [updated] = db.select().from(accounts).where(eq(accounts.id, id)).all()
  return NextResponse.json(updated)
}
