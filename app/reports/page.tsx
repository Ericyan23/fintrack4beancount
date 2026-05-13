'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  DATE_RANGE_OPTIONS,
  formatDateRangeLabel,
  getDateRangeForPreset,
  type DateRangePreset,
} from '@/lib/dateRanges'

interface AccountInfo {
  id: string
  name: string
}

interface SummaryReport {
  income: number
  spending: number
  net: number
  transactionCount: number
}

interface PeriodReportRow extends SummaryReport {
  period: string
  startDate: string
  endDate: string
}

interface BreakdownRow {
  label: string
  amount: number
  transactionCount: number
  accountId?: string
  category?: string
  categoryGroup?: string
  search?: string
}

interface ReportsPayload {
  summary: SummaryReport
  cashFlow: PeriodReportRow[]
  spending: {
    byCategoryGroup: BreakdownRow[]
    byCategory: BreakdownRow[]
    byAccount: BreakdownRow[]
    byMerchant: BreakdownRow[]
  }
  income: {
    byCategoryGroup: BreakdownRow[]
    byCategory: BreakdownRow[]
    byAccount: BreakdownRow[]
    byMerchant: BreakdownRow[]
  }
}

type Tab = 'cashflow' | 'spending' | 'income'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatSigned(value: number): string {
  const formatted = formatCurrency(Math.abs(value))
  return value < 0 ? `-${formatted}` : formatted
}

function transactionHref(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return `/transactions?${search.toString()}`
}

function BreakdownTable({
  title,
  rows,
  type,
  startDate,
  endDate,
  accountId,
}: {
  title: string
  rows: BreakdownRow[]
  type: 'spending' | 'income'
  startDate: string
  endDate: string
  accountId: string
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-700">
        <h2 className="text-sm font-medium text-slate-300">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">No data yet</div>
      ) : (
        <div className="divide-y divide-slate-700">
          {rows.map(row => {
            const isUncategorized = row.category === 'Uncategorized' || row.categoryGroup === 'Uncategorized'
            const href = transactionHref({
              startDate,
              endDate,
              type,
              accountId: row.accountId ?? accountId,
              category: isUncategorized ? undefined : row.category,
              categoryGroup: isUncategorized ? undefined : row.categoryGroup,
              unclassified: isUncategorized ? 'true' : undefined,
              search: row.search,
            })
            return (
              <Link
                key={`${title}-${row.label}-${row.accountId ?? row.category ?? row.search ?? ''}`}
                href={href}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-700/50"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-100 truncate">{row.label}</p>
                  <p className="text-xs text-slate-500">{row.transactionCount} transactions</p>
                </div>
                <p className="text-sm font-semibold text-slate-100 shrink-0">{formatCurrency(row.amount)}</p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('cashflow')
  const initialRange = getDateRangeForPreset('last_6_months')!
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('last_6_months')
  const [startDate, setStartDate] = useState(initialRange.startDate)
  const [endDate, setEndDate] = useState(initialRange.endDate)
  const [accountId, setAccountId] = useState('')
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [data, setData] = useState<ReportsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/accounts')
      .then(res => res.json())
      .then((payload: { accounts?: AccountInfo[] }) => setAccounts(payload.accounts ?? []))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('range', rangePreset)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (accountId) params.set('accountId', accountId)
    setLoading(true)
    fetch(`/api/reports?${params.toString()}`)
      .then(res => res.json())
      .then((payload: ReportsPayload) => setData(payload))
      .finally(() => setLoading(false))
  }, [rangePreset, startDate, endDate, accountId])

  const chartData = useMemo(() => data?.cashFlow ?? [], [data])
  const activeBreakdowns = tab === 'income' ? data?.income : data?.spending
  const dateRangeLabel = formatDateRangeLabel(startDate, endDate)

  function changeRangePreset(nextPreset: DateRangePreset) {
    setRangePreset(nextPreset)
    const nextRange = getDateRangeForPreset(nextPreset)
    if (nextRange) {
      setStartDate(nextRange.startDate)
      setEndDate(nextRange.endDate)
    } else if (nextPreset === 'all_time') {
      setStartDate('')
      setEndDate('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Transaction Diagnostics</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ad hoc posted-transaction views retained outside the primary ledger prep flow.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[220px_180px] lg:grid-cols-[240px_180px_150px_150px] gap-2">
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
          >
            <option value="">All accounts</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
          <select
            value={rangePreset}
            onChange={e => changeRangePreset(e.target.value as DateRangePreset)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
          >
            {DATE_RANGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {rangePreset === 'custom' && (
            <>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
              />
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
              />
            </>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-500">
        Range: {dateRangeLabel} · Basis: posted transactions, excluding cancelled
      </div>

      <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1 w-full md:w-fit">
        {([
          ['cashflow', 'Cash Flow'],
          ['spending', 'Spending'],
          ['income', 'Income'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`px-4 py-2 rounded-md text-sm font-medium flex-1 md:flex-none ${
              tab === value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <div className="text-center py-12 text-slate-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link
              href={transactionHref({ startDate, endDate, type: 'income', accountId })}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-500"
            >
              <p className="text-xs text-slate-400">Income</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(data.summary.income)}</p>
            </Link>
            <Link
              href={transactionHref({ startDate, endDate, type: 'spending', accountId })}
              className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-500"
            >
              <p className="text-xs text-slate-400">Spending</p>
              <p className="text-xl font-bold text-red-400 mt-1">{formatCurrency(data.summary.spending)}</p>
            </Link>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-400">Net cash flow</p>
              <p className={`text-xl font-bold mt-1 ${data.summary.net >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                {formatSigned(data.summary.net)}
              </p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-xs text-slate-400">Transactions</p>
              <p className="text-xl font-bold text-slate-100 mt-1">{data.summary.transactionCount}</p>
            </div>
          </div>

          {tab === 'cashflow' && (
            <div className="space-y-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <h2 className="text-sm font-medium text-slate-300 mb-3">Monthly cash flow</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="period" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `$${Math.round(Number(v) / 1000)}k`} width={48} />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#f8fafc' }}
                    />
                    <Bar dataKey="income" name="Income" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="spending" name="Spending" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="net" name="Net cash flow" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_80px] gap-3 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
                  <span>Month</span>
                  <span>Income</span>
                  <span>Spending</span>
                  <span>Net</span>
                  <span>Transactions</span>
                </div>
                {chartData.map(row => (
                  <div key={row.period} className="grid grid-cols-[1fr_1fr_1fr_1fr_80px] gap-3 px-4 py-2 text-sm border-b border-slate-700 last:border-b-0">
                    <span className="text-slate-300">{row.period}</span>
                    <Link className="text-emerald-400 hover:underline" href={transactionHref({ startDate: row.startDate, endDate: row.endDate, type: 'income', accountId })}>
                      {formatCurrency(row.income)}
                    </Link>
                    <Link className="text-red-400 hover:underline" href={transactionHref({ startDate: row.startDate, endDate: row.endDate, type: 'spending', accountId })}>
                      {formatCurrency(row.spending)}
                    </Link>
                    <span className={row.net >= 0 ? 'text-blue-400' : 'text-red-400'}>{formatSigned(row.net)}</span>
                    <span className="text-slate-400">{row.transactionCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(tab === 'spending' || tab === 'income') && activeBreakdowns && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BreakdownTable
                title="By category group"
                rows={activeBreakdowns.byCategoryGroup}
                type={tab}
                startDate={startDate}
                endDate={endDate}
                accountId={accountId}
              />
              <BreakdownTable
                title="By full category"
                rows={activeBreakdowns.byCategory}
                type={tab}
                startDate={startDate}
                endDate={endDate}
                accountId={accountId}
              />
              <BreakdownTable
                title="By account"
                rows={activeBreakdowns.byAccount}
                type={tab}
                startDate={startDate}
                endDate={endDate}
                accountId={accountId}
              />
              <BreakdownTable
                title="Top merchants/descriptions"
                rows={activeBreakdowns.byMerchant}
                type={tab}
                startDate={startDate}
                endDate={endDate}
                accountId={accountId}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
