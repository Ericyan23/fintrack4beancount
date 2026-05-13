export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { accounts, transactions, netWorthSnapshots, type Account } from '@/lib/db/schema'
import { desc, isNull, and, gte, eq, ne, or, inArray } from 'drizzle-orm'
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
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
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

function sortAssets(a: Account, b: Account): number {
  return accountBalance(b) - accountBalance(a) || accountSortName(a).localeCompare(accountSortName(b), 'zh-CN')
}

function sortLiabilities(a: Account, b: Account): number {
  return Math.abs(accountBalance(b)) - Math.abs(accountBalance(a))
    || accountSortName(a).localeCompare(accountSortName(b), 'zh-CN')
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
          <span>更新于 {formatTimeAgo(account.balanceDate)}</span>
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

export default function Dashboard() {
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
    .sort((a, b) => accountSortName(a).localeCompare(accountSortName(b), 'zh-CN'))
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

  const reviewCount = db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.status, 'posted'),
      or(
        isNull(transactions.category),
        inArray(transactions.category, REVIEW_CATEGORY_NAMES),
      ),
    ))
    .all()
    .length

  const monthStart = getMonthStart()
  const monthlyTxns = db
    .select()
    .from(transactions)
    .where(and(gte(transactions.posted, monthStart), eq(transactions.status, 'posted')))
    .all()

  const categoryTotals = new Map<string, number>()
  for (const txn of monthlyTxns) {
    const amt = parseFloat(txn.amount)
    if (amt >= 0) continue
    if (txn.category?.startsWith('Transfer:')) continue
    const cat = txn.category ? categoryGroupName(txn.category) : '未分类'
    categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + Math.abs(amt))
  }
  const chartData = Array.from(categoryTotals.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
  const monthlySpendingTotal = chartData.reduce((sum, row) => sum + row.amount, 0)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <div className="space-y-6">
      {/* Net worth summary */}
      <div className="space-y-2">
        <div className="bg-slate-800 rounded-xl p-4 border border-blue-800">
          <p className="text-slate-400 text-xs">净资产</p>
          <p className={`text-3xl font-bold mt-1 truncate ${netWorth >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {formatCurrency(netWorth)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-slate-400 text-xs">总资产</p>
            <p className="text-lg font-bold mt-1 text-emerald-400 truncate">{formatCurrency(totalAssets)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
            <p className="text-slate-400 text-xs">总负债</p>
            <p className="text-lg font-bold mt-1 text-red-400 truncate">{formatCurrency(totalLiabilities)}</p>
          </div>
        </div>
      </div>

      {/* Net worth chart */}
      {snapshots.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <h2 className="text-sm font-medium text-slate-400 mb-3">净资产走势（最近6个月）</h2>
          <NetWorthChart snapshots={snapshots} />
        </div>
      )}

      {/* Spending charts */}
      {chartData.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-medium text-slate-400">本月支出</h2>
            <p className="text-sm font-semibold text-red-300 tabular-nums">
              合计 {formatCurrency(monthlySpendingTotal)}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-500 mb-2">按分类（柱状图）</p>
              <BarSpendingChart data={chartData} />
            </div>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-500 mb-2">支出占比（饼图）</p>
              <PieSpendingChart data={chartData} />
            </div>
          </div>
        </div>
      )}

      {/* Account balance cards */}
      {allAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-slate-400">账户余额</h2>
            <Link href="/accounts" className="text-xs text-blue-400 hover:text-blue-300">
              管理账户 →
            </Link>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {cashAccounts.length > 0 && (
              <AccountSection
                title="现金账户"
                total={formatCurrency(cashTotal)}
                accounts={cashAccounts}
                tone="emerald"
              />
            )}
            {activeCreditAccounts.length > 0 && (
              <AccountSection
                title="信用卡负债"
                total={formatCurrency(activeCreditTotal)}
                accounts={activeCreditAccounts}
                tone="red"
              />
            )}
            {investmentAccounts.length > 0 && (
              <AccountSection
                title="投资账户"
                total={formatCurrency(investmentTotal)}
                accounts={investmentAccounts}
                tone="blue"
              />
            )}
            {loanAccounts.length > 0 && (
              <AccountSection
                title="贷款"
                total={formatCurrency(loanTotal)}
                accounts={loanAccounts}
                tone="red"
              />
            )}
          </div>
          {zeroCreditAccounts.length > 0 && (
            <details className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800/60">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-400 hover:bg-slate-700/40">
                零余额信用卡 {zeroCreditAccounts.length} 张
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

      {/* Recent transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-slate-400">最近交易</h2>
          <div className="flex items-center gap-3">
            {reviewCount > 0 && (
              <Link
                href="/review"
                className="flex items-center gap-1 text-xs bg-red-900/50 text-red-300 border border-red-800 px-2 py-1 rounded-full hover:bg-red-900"
              >
                ⚠ {reviewCount} 条待审核
              </Link>
            )}
            <Link href="/transactions" className="text-xs text-blue-400 hover:text-blue-300">
              查看全部 →
            </Link>
          </div>
        </div>

        {recentTxns.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-8 text-center text-slate-500 border border-slate-700">
            暂无交易记录，点击右上角「同步」按钮获取数据
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
                      <span className="text-xs text-red-400">⚠ 未分类</span>
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
