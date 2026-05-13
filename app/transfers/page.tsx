'use client'

import { useCallback, useEffect, useState } from 'react'

type MatchStatus = 'suggested' | 'confirmed' | 'ignored' | 'all'

interface TransferTxn {
  id: string
  accountName: string
  posted: number
  amount: string
  description: string
  category: string
  beancountAccount: string | null
}

interface TransferMatch {
  id: number
  status: 'suggested' | 'confirmed' | 'ignored'
  kind: string
  confidence: number
  dateDeltaDays: number
  reason: string
  outflow: TransferTxn
  inflow: TransferTxn
}

interface TransferSummary {
  suggested: number
  confirmed: number
  ignored: number
  unmatched: number
  candidates: number
}

interface TransferResponse {
  matches: TransferMatch[]
  unmatched: TransferTxn[]
  summary: TransferSummary
}

interface ExternalAccount {
  account: string
  root: string
}

interface ExternalAccountsResponse {
  accounts?: ExternalAccount[]
}

const EXTERNAL_ACCOUNT_ROOTS = ['Assets', 'Liabilities'] as const

function formatAmount(amount: string): string {
  const value = Number.parseFloat(amount)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  })
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'credit_card_payment':
      return '信用卡还款'
    case 'internal':
      return '内部转账'
    case 'wallet':
      return '钱包'
    case 'investment':
      return '投资'
    default:
      return '转账'
  }
}

function statusLabel(status: TransferMatch['status']): string {
  switch (status) {
    case 'suggested':
      return '待确认'
    case 'confirmed':
      return '已确认'
    case 'ignored':
      return '已忽略'
  }
}

function TxnBlock({ txn, tone }: { txn: TransferTxn; tone: 'out' | 'in' }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{txn.description}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatDate(txn.posted)} · {txn.accountName}
          </p>
          {txn.beancountAccount && (
            <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{txn.beancountAccount}</p>
          )}
        </div>
        <span className={`shrink-0 text-sm font-semibold ${tone === 'out' ? 'text-red-400' : 'text-emerald-400'}`}>
          {formatAmount(txn.amount)}
        </span>
      </div>
    </div>
  )
}

export default function TransfersPage() {
  const [status, setStatus] = useState<MatchStatus>('suggested')
  const [data, setData] = useState<TransferResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [externalAccounts, setExternalAccounts] = useState<ExternalAccount[]>([])
  const [externalAccountByTxn, setExternalAccountByTxn] = useState<Record<string, string>>({})
  const [savingExternalTxnId, setSavingExternalTxnId] = useState<string | null>(null)
  const [externalAccountError, setExternalAccountError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/transfers?status=${status}`)
    const next = (await res.json()) as TransferResponse
    setData(next)
    setLoading(false)
  }, [status])

  useEffect(() => { load() }, [load])

  const loadExternalAccounts = useCallback(async () => {
    const accountSets = await Promise.all(EXTERNAL_ACCOUNT_ROOTS.map(async root => {
      try {
        const res = await fetch(`/api/beancount/accounts?status=open&root=${root}`)
        if (!res.ok) return [] as ExternalAccount[]
        const data = (await res.json()) as ExternalAccountsResponse
        return data.accounts ?? []
      } catch {
        return [] as ExternalAccount[]
      }
    }))

    const seen = new Set<string>()
    const accounts = accountSets
      .flat()
      .filter(account => account.root === 'Assets' || account.root === 'Liabilities')
      .filter(account => {
        if (seen.has(account.account)) return false
        seen.add(account.account)
        return true
      })
      .sort((a, b) => a.account.localeCompare(b.account))

    setExternalAccounts(accounts)
  }, [])

  useEffect(() => { loadExternalAccounts() }, [loadExternalAccounts])

  async function scan() {
    setScanning(true)
    await fetch('/api/transfers/scan', { method: 'POST' })
    setScanning(false)
    await load()
  }

  async function updateStatus(id: number, nextStatus: TransferMatch['status']) {
    setSavingId(id)
    await fetch(`/api/transfers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    setSavingId(null)
    await load()
  }

  async function markExternalAccount(txnId: string) {
    const account = externalAccountByTxn[txnId]
    if (!account) return

    setSavingExternalTxnId(txnId)
    setExternalAccountError(null)
    try {
      const res = await fetch(`/api/transactions/${encodeURIComponent(txnId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: account }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? '保存外部账户失败')
      }
      setExternalAccountByTxn(prev => {
        const next = { ...prev }
        delete next[txnId]
        return next
      })
      await load()
    } catch (err) {
      setExternalAccountError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingExternalTxnId(null)
    }
  }

  const summary = data?.summary
  const matches = data?.matches ?? []
  const unmatched = data?.unmatched ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">转账匹配</h1>
        <button
          onClick={scan}
          disabled={scanning}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {scanning ? '扫描中...' : '扫描匹配'}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-blue-900/60 bg-blue-950/30 p-3">
            <p className="text-xs text-blue-300">待确认</p>
            <p className="mt-1 text-2xl font-semibold text-blue-200">{summary.suggested}</p>
          </div>
          <div className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3">
            <p className="text-xs text-emerald-300">已确认</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-200">{summary.confirmed}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
            <p className="text-xs text-slate-400">未匹配</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{summary.unmatched}</p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
            <p className="text-xs text-slate-400">已忽略</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{summary.ignored}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['suggested', 'confirmed', 'ignored', 'all'] as const).map(item => (
          <button
            key={item}
            onClick={() => setStatus(item)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              status === item
                ? 'bg-blue-700 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {item === 'all' ? '全部' : statusLabel(item)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-slate-500">加载中...</div>
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center text-slate-500">
          没有匹配记录
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map(match => (
            <div key={match.id} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-200">
                    {kindLabel(match.kind)}
                  </span>
                  <span className="rounded-full bg-blue-900/60 px-2 py-0.5 text-xs text-blue-200">
                    {match.confidence}%
                  </span>
                  <span className="text-xs text-slate-500">{match.reason}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{statusLabel(match.status)}</span>
                  {match.status === 'suggested' && (
                    <>
                      <button
                        onClick={() => updateStatus(match.id, 'confirmed')}
                        disabled={savingId === match.id}
                        className="rounded bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => updateStatus(match.id, 'ignored')}
                        disabled={savingId === match.id}
                        className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                      >
                        忽略
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                <TxnBlock txn={match.outflow} tone="out" />
                <div className="hidden text-center text-slate-500 lg:block">→</div>
                <TxnBlock txn={match.inflow} tone="in" />
              </div>
            </div>
          ))}
        </div>
      )}

      {unmatched.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-slate-400">未匹配转账</h2>
          {externalAccountError && (
            <p className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              {externalAccountError}
            </p>
          )}
          <div className="rounded-xl border border-slate-700 bg-slate-800">
            {unmatched.slice(0, 30).map((txn, index) => (
              <div
                key={txn.id}
                className={`flex flex-col gap-3 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between ${
                  index > 0 ? 'border-t border-slate-700' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-slate-200">{txn.description}</p>
                  <p className="text-xs text-slate-500">{formatDate(txn.posted)} · {txn.accountName} · {txn.category}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <span className={`font-semibold ${Number.parseFloat(txn.amount) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatAmount(txn.amount)}
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <select
                      value={externalAccountByTxn[txn.id] ?? ''}
                      disabled={externalAccounts.length === 0 || savingExternalTxnId === txn.id}
                      onChange={event => {
                        const account = event.target.value
                        setExternalAccountByTxn(prev => ({ ...prev, [txn.id]: account }))
                      }}
                      className="w-64 max-w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 disabled:opacity-50"
                    >
                      <option value="">
                        {externalAccounts.length === 0 ? '无可用外部账户' : '选择外部账户'}
                      </option>
                      {externalAccounts.map(account => (
                        <option key={account.account} value={account.account}>{account.account}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => markExternalAccount(txn.id)}
                      disabled={!externalAccountByTxn[txn.id] || savingExternalTxnId === txn.id}
                      className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                    >
                      {savingExternalTxnId === txn.id ? '保存中...' : '标记'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
