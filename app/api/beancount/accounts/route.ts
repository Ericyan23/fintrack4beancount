import { NextRequest, NextResponse } from 'next/server'
import {
  defaultBeancountRoot,
  ledgerRevision,
  listLedgerAccounts,
  loadLedgerSnapshot,
  type BeancountAccountView,
} from '@/lib/export/beancount-ledger'

const ACCOUNT_ROOTS = ['Assets', 'Liabilities', 'Income', 'Expenses', 'Equity'] as const
type AccountRoot = typeof ACCOUNT_ROOTS[number]

interface AccountGroup {
  root: AccountRoot
  accounts: BeancountAccountView[]
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseDate(value: string | null): string {
  if (!value) return currentDate()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('date must use YYYY-MM-DD')
  }
  return value
}

function isAccountRoot(value: string): value is AccountRoot {
  return (ACCOUNT_ROOTS as readonly string[]).includes(value)
}

function groupAccounts(accounts: BeancountAccountView[]): AccountGroup[] {
  return ACCOUNT_ROOTS.map(root => ({
    root,
    accounts: accounts.filter(account => account.root === root),
  }))
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const date = parseDate(req.nextUrl.searchParams.get('date'))
    const status = req.nextUrl.searchParams.get('status')
    const root = req.nextUrl.searchParams.get('root')
    if (status && !['open', 'closed', 'not_yet_open', 'all'].includes(status)) {
      throw new Error('status must be open, closed, not_yet_open, or all')
    }
    if (root && !isAccountRoot(root)) {
      throw new Error(`root must be one of ${ACCOUNT_ROOTS.join(', ')}`)
    }

    const beancountRoot = defaultBeancountRoot()
    const snapshot = loadLedgerSnapshot(beancountRoot)
    const allAccounts = listLedgerAccounts(snapshot, date)
    const accounts = allAccounts.filter(account => {
      if (root && account.root !== root) return false
      if (status && status !== 'all' && account.status !== status) return false
      return isAccountRoot(account.root)
    })

    return NextResponse.json({
      date,
      beancountRoot,
      mainFile: snapshot.mainFile,
      filesScanned: snapshot.files.length,
      ledgerRevision: ledgerRevision(snapshot.root, snapshot.files),
      summary: {
        total: accounts.length,
        open: accounts.filter(account => account.status === 'open').length,
        closed: accounts.filter(account => account.status === 'closed').length,
        notYetOpen: accounts.filter(account => account.status === 'not_yet_open').length,
      },
      groups: groupAccounts(accounts).filter(group => !root || group.root === root),
      accounts,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
