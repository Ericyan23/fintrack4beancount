export const dynamic = 'force-dynamic'

import { db, sqlite } from '@/lib/db'
import { accounts, transactions, netWorthSnapshots, type Account } from '@/lib/db/schema'
import { desc, ne } from 'drizzle-orm'
import NetWorthChart from '@/components/NetWorthChart'
import { BarSpendingChart, PieSpendingChart } from '@/components/SpendingChart'
import {
  accountDisplayName,
  accountInstitution,
  accountLast4,
  accountTypeLabel,
  effectiveAccountType,
  isLiabilityAccount,
} from '@/lib/accounts'
import { categoryGroupName } from '@/lib/category-format'
import { REVIEW_CATEGORY_NAMES } from '@/lib/classify/defaults'
import Link from 'next/link'

function getMonthStart(): number {
  const now = new Date()
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
}

function formatAmount(amount: string): { text: string; positive: boolean } {
  const num = parseFloat(amount)
  const positive = num > 0
  return {
    text: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(num)),
    positive,
  }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

function accountBalance(account: Account): number {
  const balance = parseFloat(account.balance)
  return Number.isFinite(balance) ? balance : 0
}

function isZeroBalance(account: Account): boolean {
  return Math.abs(accountBalance(account)) < 0.005
}

function formatAccountBalance(account: Account): string {
  const balance = accountBalance(account)
  const isLiability = isLiabilityAccount(account)
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: account.currency || 'USD',
  }).format(Math.abs(balance))
  return isLiability && !isZeroBalance(account) ? `-${amount}` : amount
}

function accountSortName(account: Account): string {
  return `${accountInstitution(account)} ${accountDisplayName(account)} ${accountLast4(account) ?? ''}`
}

function countReviewTransactions(): number {
  const placeholders = REVIEW_CATEGORY_NAMES.map(() => '?').join(', ')
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM transactions
    WHERE status = 'posted'
      AND (category IS NULL OR category IN (${placeholders}))
  `).get(...REVIEW_CATEGORY_NAMES) as { total: number }
  return row.total
}

function sortAssets(a: Account, b: Account): number {
  return accountBalance(b) - accountBalance(a) || accountSortName(a).localeCompare(accountSortName(b), 'en-US')
}

function sortLiabilities(a: Account, b: Account): number {
  return Math.abs(accountBalance(b)) - Math.abs(accountBalance(a))
    || accountSortName(a).localeCompare(accountSortName(b), 'en-US')
}

function AccountBalanceRow({ account }: { account: Account }) {
  const type = effectiveAccountType(account)
  const isLiability = isLiabilityAccount(account)
  const isZero = isZeroBalance(account)
  const last4 = accountLast4(account)

  return (
    <Link
      href={`/transactions?accountId=${encodeURIComponent(account.id)}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 hover:bg-slate-700/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-slate-200">{accountDisplayName(account)}</span>
          {last4 && (
            <span className="shrink-0 rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-400">
              {last4}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span>{accountInstitution(account)}</span>
          <span>{accountTypeLabel(type)}</span>
          <span>Updated {formatTimeAgo(account.balanceDate)}</span>
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-semibold tabular-nums ${
          isZero ? 'text-slate-300' : isLiability ? 'text-red-300' : 'text-emerald-300'
        }`}>
          {formatAccountBalance(account)}
        </p>
        {account.currency !== 'USD' && (
          <p className="mt-1 text-[11px] text-slate-500">{account.currency}</p>
        )}
      </div>
    </Link>
  )
}

function AccountSection({
  title,
  total,
  accounts,
  tone,
}: {
  title: string
  total: string
  accounts: Account[]
  tone: 'emerald' | 'red' | 'blue'
}) {
  const toneClass = {
    emerald: 'text-emerald-300',
    red: 'text-red-300',
    blue: 'text-blue-300',
  }[tone]

  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/80">
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        <p className={`text-sm font-semibold tabular-nums ${toneClass}`}>{total}</p>
      </div>
      <div className="divide-y divide-slate-700">
        {accounts.map(account => (
          <AccountBalanceRow key={account.id} account={account} />
        ))}
      </div>
    </section>
  )
}

export default function CommandCenter() {
  const allAccounts = db.select().from(accounts).all()
  const snapshots = db
    .select()
    .from(netWorthSnapshots)
    .orderBy(desc(netWorthSnapshots.snapshotAt))
    .limit(180)
    .all()
    .reverse()

  const latestSnapshot = snapshots[snapshots.length - 1]

  const totalAssets = allAccounts
    .filter(a => !isLiabilityAccount(a))
    .reduce((s, a) => s + parseFloat(a.balance), 0)
  const totalLiabilities = allAccounts
    .filter(a => isLiabilityAccount(a))
    .reduce((s, a) => s + Math.abs(parseFloat(a.balance)), 0)
  const netWorth = totalAssets - totalLiabilities
  const cashAccounts = allAccounts
    .filter(a => effectiveAccountType(a) === 'depository')
    .sort(sortAssets)
  const investmentAccounts = allAccounts
    .filter(a => effectiveAccountType(a) === 'investment')
    .sort(sortAssets)
  const creditAccounts = allAccounts
    .filter(a => effectiveAccountType(a) === 'credit')
  const activeCreditAccounts = creditAccounts
    .filter(a => !isZeroBalance(a))
    .sort(sortLiabilities)
  const zeroCreditAccounts = creditAccounts
    .filter(isZeroBalance)
    .sort((a, b) => accountSortName(a).localeCompare(accountSortName(b), 'en-US'))
  const loanAccounts = allAccounts
    .filter(a => effectiveAccountType(a) === 'loan')
    .sort(sortLiabilities)
  const cashTotal = cashAccounts.reduce((s, a) => s + accountBalance(a), 0)
  const investmentTotal = investmentAccounts.reduce((s, a) => s + accountBalance(a), 0)
  const activeCreditTotal = activeCreditAccounts.reduce((s, a) => s + Math.abs(accountBalance(a)), 0)
  const loanTotal = loanAccounts.reduce((s, a) => s + Math.abs(accountBalance(a)), 0)

  const recentTxns = db
    .select()
    .from(transactions)
    .where(ne(transactions.status, 'cancelled'))
    .orderBy(desc(transactions.posted))
    .limit(10)
    .all()

  const reviewCount = countReviewTransactions()

  const monthStart = getMonthStart()
  const categoryTotals = new Map<string, number>()
  const monthlyCategoryRows = sqlite.prepare(`
    SELECT category, SUM(ABS(CAST(amount AS REAL))) AS amount
    FROM transactions
    WHERE posted >= ?
      AND status = 'posted'
      AND CAST(amount AS REAL) < 0
      AND (category IS NULL OR category NOT LIKE 'Transfer:%')
    GROUP BY category
  `).all(monthStart) as Array<{ category: string | null; amount: number | null }>

  for (const row of monthlyCategoryRows) {
    const cat = row.category ? categoryGroupName(row.category) : 'Uncategorized'
    categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + (row.amount ?? 0))
  }
  const chartData = Array.from(categoryTotals.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
  const monthlySpendingTotal = chartData.reduce((sum, row) => sum + row.amount, 0)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Command Center</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monitor imported data quality and ledger-prep blockers before Beancount export.
        </p>
      </div>

      {/* Balance summary */}
      <div className="space-y-2">
        <div className="bg-slate-800 rounded-xl p-4 border border-blue-800">
          <p className="text-slate-400 text-xs">Net position snapshot</p>
          <p className={`text-3xl font-bold mt-1 truncate ${netWorth >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {formatCurrency(netWorth)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-slate-400 text-xs">Imported assets</p>
            <p className="text-lg font-bold mt-1 text-emerald-400 truncate">{formatCurrency(totalAssets)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-slate-400 text-xs">Imported liabilities</p>
            <p className="text-lg font-bold mt-1 text-red-400 truncate">{formatCurrency(totalLiabilities)}</p>
          </div>
        </div>
      </div>

      {/* Balance chart */}
      {snapshots.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="text-sm font-medium text-slate-400 mb-3">Imported balance trend (last 6 months)</h2>
          <NetWorthChart snapshots={snapshots} />
        </div>
      )}

      {/* Category cleanup charts */}
      {chartData.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium text-slate-400">This month&apos;s outflow classifications</h2>
            <p className="text-sm font-semibold text-red-300 tabular-nums">
              Outflow total {formatCurrency(monthlySpendingTotal)}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-500 mb-2">Category cleanup volume</p>
              <BarSpendingChart data={chartData} />
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-500 mb-2">Category distribution</p>
              <PieSpendingChart data={chartData} />
            </div>
          </div>
        </div>
      )}

      {/* Account balance cards */}
      {allAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-slate-400">Account mapping inputs</h2>
            <Link href="/accounts" className="text-xs text-blue-400 hover:text-blue-300">
              Open account mapping →
            </Link>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {cashAccounts.length > 0 && (
              <AccountSection
                title="Cash account inputs"
                total={formatCurrency(cashTotal)}
                accounts={cashAccounts}
                tone="emerald"
              />
            )}
            {activeCreditAccounts.length > 0 && (
              <AccountSection
                title="Credit liability inputs"
                total={formatCurrency(activeCreditTotal)}
                accounts={activeCreditAccounts}
                tone="red"
              />
            )}
            {investmentAccounts.length > 0 && (
              <AccountSection
                title="Investment account inputs"
                total={formatCurrency(investmentTotal)}
                accounts={investmentAccounts}
                tone="blue"
              />
            )}
            {loanAccounts.length > 0 && (
              <AccountSection
                title="Loan inputs"
                total={formatCurrency(loanTotal)}
                accounts={loanAccounts}
                tone="red"
              />
            )}
          </div>
          {zeroCreditAccounts.length > 0 && (
            <details className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/60">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-400 hover:bg-slate-700/40">
                Zero-balance credit inputs ({zeroCreditAccounts.length})
              </summary>
              <div className="divide-y divide-slate-700 border-t border-slate-700">
                {zeroCreditAccounts.map(account => (
                  <AccountBalanceRow key={account.id} account={account} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Recent transaction intake */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-slate-400">Recent transaction intake</h2>
          <div className="flex items-center gap-3">
            {reviewCount > 0 && (
              <Link
                href="/review"
                className="flex items-center gap-1 text-xs bg-red-900/50 text-red-300 border border-red-800 px-2 py-1 rounded-full hover:bg-red-900"
              >
                ⚠ {reviewCount} prep items
              </Link>
            )}
            <Link href="/transactions" className="text-xs text-blue-400 hover:text-blue-300">
              Open transactions →
            </Link>
          </div>
        </div>

        {recentTxns.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-8 text-center text-slate-500 border border-slate-700">
            No imported transactions yet. Use Sync to fetch data for ledger preparation.
          </div>
        ) : (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {recentTxns.map((txn, i) => {
              const { text, positive } = formatAmount(txn.amount)
              return (
                <Link
                  key={txn.id}
                  href={`/transactions/${encodeURIComponent(txn.id)}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-700/50 transition-colors ${
                    i > 0 ? 'border-t border-slate-700' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-100 truncate">{txn.description}</p>
                    <p className="text-xs text-slate-500">{formatDate(txn.posted)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {txn.category ? (
                      <span className="text-xs text-slate-400">{txn.category}</span>
                    ) : (
                      <span className="text-xs text-red-400">⚠ Needs category</span>
                    )}
                    <span className={`text-sm font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {positive ? '+' : '-'}{text}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
