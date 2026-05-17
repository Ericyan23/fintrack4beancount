'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import type { Transaction } from '@/lib/db/schema'
import TransactionList from '@/components/TransactionList'
import CategorySelect from '@/components/CategorySelect'
import { useSearchParams } from 'next/navigation'

interface AccountInfo {
  id: string
  name: string
}

interface TransactionsResponse {
  transactions: Transaction[]
  total: number
  hasMore: boolean
  unclassifiedTotal: number
  reviewCategoryTotal: number
}

const LIMIT = 50

function TransactionsPageContent() {
  const searchParams = useSearchParams()

  const [txns, setTxns] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [unclassifiedTotal, setUnclassifiedTotal] = useState(0)
  const [reviewCategoryTotal, setReviewCategoryTotal] = useState(0)
  const [offset, setOffset] = useState(0)

  const [accountId, setAccountId] = useState(searchParams.get('accountId') ?? '')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [categoryGroup, setCategoryGroup] = useState(searchParams.get('categoryGroup') ?? '')
  const [unclassified, setUnclassified] = useState(searchParams.get('unclassified') === 'true')
  const [reviewOnly, setReviewOnly] = useState(searchParams.get('review') === 'true')
  const [startDate, setStartDate] = useState(searchParams.get('startDate') ?? '')
  const [endDate, setEndDate] = useState(searchParams.get('endDate') ?? '')
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [type, setType] = useState(searchParams.get('type') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')

  const fetchAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts')
    const data = (await res.json()) as { accounts: AccountInfo[] }
    setAccounts(data.accounts ?? [])
  }, [])

  const fetchTxns = useCallback(async (opts?: { offsetValue?: number; append?: boolean }) => {
    const currentOffset = opts?.offsetValue ?? 0
    const append = opts?.append ?? false
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    const params = new URLSearchParams()
    if (accountId) params.set('accountId', accountId)
    if (category) params.set('category', category)
    if (categoryGroup) params.set('categoryGroup', categoryGroup)
    if (unclassified) params.set('unclassified', 'true')
    if (reviewOnly) params.set('review', 'true')
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (search) params.set('search', search)
    if (type) params.set('type', type)
    if (status) params.set('status', status)
    params.set('limit', String(LIMIT))
    params.set('offset', String(currentOffset))

    const res = await fetch(`/api/transactions?${params.toString()}`)
    const data = (await res.json()) as TransactionsResponse
    const nextRows = data.transactions ?? []
    setTxns(prev => append ? [...prev, ...nextRows] : nextRows)
    setTotal(data.total ?? nextRows.length)
    setHasMore(data.hasMore ?? currentOffset + nextRows.length < (data.total ?? 0))
    setUnclassifiedTotal(data.unclassifiedTotal ?? 0)
    setReviewCategoryTotal(data.reviewCategoryTotal ?? 0)
    setOffset(currentOffset)
    if (append) {
      setLoadingMore(false)
    } else {
      setLoading(false)
    }
  }, [accountId, category, categoryGroup, unclassified, reviewOnly, startDate, endDate, search, type, status])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])
  useEffect(() => { fetchTxns({ offsetValue: 0 }) }, [fetchTxns])

  const exportHref = (() => {
    const params = new URLSearchParams()
    if (accountId) params.set('accountId', accountId)
    if (category) params.set('category', category)
    if (categoryGroup) params.set('categoryGroup', categoryGroup)
    if (unclassified) params.set('unclassified', 'true')
    if (reviewOnly) params.set('review', 'true')
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (search) params.set('search', search)
    if (type) params.set('type', type)
    if (status) params.set('status', status)
    return `/api/export/transactions${params.toString() ? `?${params.toString()}` : ''}`
  })()
  const reviewQueueTotal = unclassifiedTotal + reviewCategoryTotal

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold">交易</h1>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/transactions/new"
            className="text-xs bg-blue-900/50 text-blue-300 border border-blue-800 px-2 py-1 rounded-md hover:bg-blue-900"
          >
            新建交易
          </a>
          {reviewQueueTotal > 0 && (
            <a
              href="/review"
              className="text-xs bg-amber-900/50 text-amber-300 border border-amber-800 px-2 py-1 rounded-full hover:bg-amber-900"
            >
              ⚠ {reviewQueueTotal} 条待审核
            </a>
          )}
          {unclassifiedTotal > 0 && (
            <a
              href="/transactions?unclassified=true"
              className="text-xs bg-red-900/50 text-red-300 border border-red-800 px-2 py-1 rounded-full hover:bg-red-900"
            >
              {unclassifiedTotal} 条缺少 Ledger 账户
            </a>
          )}
          {reviewCategoryTotal > 0 && (
            <a
              href="/transactions?review=true"
              className="text-xs bg-violet-900/50 text-violet-300 border border-violet-800 px-2 py-1 rounded-full hover:bg-violet-900"
            >
              {reviewCategoryTotal} 个审核标记
            </a>
          )}
          <a
            href={exportHref}
            className="text-xs bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 px-2 py-1 rounded-md"
          >
            导出 CSV
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 space-y-3">
        {categoryGroup && !category && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-900/60 bg-blue-950/30 px-3 py-2">
            <span className="text-xs text-blue-200">当前分组：{categoryGroup}</span>
            <button
              onClick={() => setCategoryGroup('')}
              className="text-xs text-blue-200 hover:text-white"
            >
              清除
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <select
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
          >
            <option value="">全部账户</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <CategorySelect
            value={category}
            onChange={value => {
              setCategory(value)
              if (value) setCategoryGroup('')
            }}
            placeholder="全部 Ledger 账户"
            className="w-full py-2"
          />

          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
          >
            <option value="">全部现金流</option>
            <option value="spending">仅支出</option>
            <option value="income">仅收入</option>
          </select>

          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
          >
            <option value="">默认状态</option>
            <option value="posted">已入账</option>
            <option value="pending">待处理</option>
            <option value="cancelled">已取消</option>
            <option value="all">全部状态</option>
          </select>

          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            placeholder="开始日期"
          />

          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            placeholder="结束日期"
          />
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="text"
            placeholder="搜索描述..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          />
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={unclassified}
              onChange={e => {
                setUnclassified(e.target.checked)
                if (e.target.checked) setReviewOnly(false)
              }}
              className="rounded"
            />
            仅缺少 Ledger 账户
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={reviewOnly}
              onChange={e => {
                setReviewOnly(e.target.checked)
                if (e.target.checked) setUnclassified(false)
              }}
              className="rounded"
            />
            仅需审核
          </label>
        </div>
      </div>

      {/* Transaction list */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">加载中...</div>
      ) : (
        <>
          <TransactionList
            transactions={txns}
            accounts={accounts}
            onUpdate={() => fetchTxns({ offsetValue: 0 })}
          />

          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => {
                  const newOffset = offset + LIMIT
                  fetchTxns({ offsetValue: newOffset, append: true })
                }}
                disabled={loadingMore}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 disabled:hover:bg-slate-700 text-slate-300 text-sm rounded-md"
              >
                {loadingMore ? '加载中...' : `加载更多 (${txns.length}/${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-slate-500">加载中...</div>}>
      <TransactionsPageContent />
    </Suspense>
  )
}
