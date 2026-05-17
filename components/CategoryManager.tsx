'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { categoryGroupName } from '@/lib/category-format'

interface CategoryStat {
  name: string
  is_default: number
  usage_count: number
  transactions: number
  suggestions: number
  rules: number
  is_required: number
  is_virtual: number
  beancount_status: 'open' | 'missing' | 'not_yet_open' | 'closed' | 'not_applicable' | 'unavailable'
  beancount_open_date: string | null
  beancount_close_date: string | null
  beancount_error: string | null
}

interface Props {
  initialStats: CategoryStat[]
}

function categoryGroup(name: string): string {
  if (name === 'Uncategorized') return '系统'
  return categoryGroupName(name)
}

function impactTotal(cat: CategoryStat): number {
  return cat.transactions + cat.suggestions + cat.rules
}

function impactLabel(cat: CategoryStat): string {
  return `${cat.transactions} 条交易 · ${cat.suggestions} 条建议 · ${cat.rules} 条规则`
}

function beancountStatusLabel(cat: CategoryStat): string {
  switch (cat.beancount_status) {
    case 'open':
      return '已开放'
    case 'missing':
      return '缺失'
    case 'not_yet_open':
      return `${cat.beancount_open_date ?? ''} 后开放`.trim()
    case 'closed':
      return `已关闭 ${cat.beancount_close_date ?? ''}`.trim()
    case 'unavailable':
      return 'Ledger 不可用'
    case 'not_applicable':
      return '本地'
  }
}

function beancountStatusClass(status: CategoryStat['beancount_status']): string {
  switch (status) {
    case 'open':
      return 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300'
    case 'missing':
      return 'border-red-900/70 bg-red-950/40 text-red-300'
    case 'not_yet_open':
    case 'closed':
      return 'border-amber-900/70 bg-amber-950/40 text-amber-300'
    case 'unavailable':
      return 'border-slate-700 bg-slate-900 text-slate-400'
    case 'not_applicable':
      return 'border-slate-700 bg-slate-900 text-slate-500'
  }
}

function transactionHref(name: string): string {
  const params = new URLSearchParams()
  if (name === 'Uncategorized') {
    params.set('unclassified', 'true')
  } else {
    params.set('category', name)
  }
  return `/transactions?${params.toString()}`
}

export default function CategoryManager({ initialStats }: Props) {
  const [stats, setStats] = useState<CategoryStat[]>(initialStats)
  const [newName, setNewName] = useState('')
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [renamingFrom, setRenamingFrom] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [mergingFrom, setMergingFrom] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setStats(initialStats)
  }, [initialStats])

  const groups = useMemo(() => {
    return Array.from(new Set(stats.map(cat => categoryGroup(cat.name)))).sort((a, b) => a.localeCompare(b))
  }, [stats])

  const filteredStats = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stats.filter(cat => {
      const matchesSearch = !q || cat.name.toLowerCase().includes(q)
      const matchesGroup = !groupFilter || categoryGroup(cat.name) === groupFilter
      return matchesSearch && matchesGroup
    })
  }, [groupFilter, search, stats])

  const targetNames = stats.filter(cat => !cat.is_virtual).map(cat => cat.name)
  const totalTransactions = stats.reduce((sum, cat) => sum + cat.transactions, 0)
  const customCount = stats.filter(cat => !cat.is_default && !cat.is_virtual).length
  const beancountOpenCount = stats.filter(cat => cat.beancount_status === 'open').length
  const beancountNeedsWorkCount = stats.filter(cat =>
    cat.beancount_status === 'missing'
    || cat.beancount_status === 'closed'
    || cat.beancount_status === 'not_yet_open'
  ).length

  async function doAdd(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json()) as { error?: string; stats?: CategoryStat[] }
      if (data.error) {
        setError(data.error)
      } else {
        setStats(data.stats ?? [])
        setNewName('')
      }
    } finally {
      setLoading(false)
    }
  }

  async function doRename(from: string) {
    const to = renameTo.trim()
    if (!to) return

    const cat = stats.find(item => item.name === from)
    if (cat && impactTotal(cat) > 0) {
      const confirmed = window.confirm(`将 "${from}" 重命名为 "${to}" 并更新 ${impactLabel(cat)}？`)
      if (!confirmed) return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/categories/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const data = (await res.json()) as { error?: string; stats?: CategoryStat[] }
      if (data.error) {
        setError(data.error)
      } else {
        setStats(data.stats ?? [])
        setRenamingFrom(null)
        setRenameTo('')
      }
    } finally {
      setLoading(false)
    }
  }

  async function doMerge(source: string) {
    if (!mergeTarget) return

    const cat = stats.find(item => item.name === source)
    const summary = cat ? impactLabel(cat) : '相关记录'
    const confirmed = window.confirm(`将 "${source}" 合并到 "${mergeTarget}" 并迁移 ${summary}？`)
    if (!confirmed) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/categories/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, target: mergeTarget }),
      })
      const data = (await res.json()) as { error?: string; stats?: CategoryStat[] }
      if (data.error) {
        setError(data.error)
      } else {
        setStats(data.stats ?? [])
        setMergingFrom(null)
        setMergeTarget('')
      }
    } finally {
      setLoading(false)
    }
  }

  async function doDelete(cat: CategoryStat) {
    const confirmed = window.confirm(`删除 "${cat.name}"？`)
    if (!confirmed) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/categories?name=${encodeURIComponent(cat.name)}`, { method: 'DELETE' })
      const data = (await res.json()) as { error?: string; stats?: CategoryStat[] }
      if (data.error) {
        setError(data.error)
      } else {
        setStats(data.stats ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">{error}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400">Ledger 账户</p>
          <p className="text-xl font-semibold text-slate-100">{stats.length}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400">自定义</p>
          <p className="text-xl font-semibold text-blue-400">{customCount}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400">交易引用</p>
          <p className="text-xl font-semibold text-emerald-400">{totalTransactions}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400">分组</p>
          <p className="text-xl font-semibold text-amber-400">{groups.length}</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-400">Beancount</p>
          <p className="text-xl font-semibold text-emerald-400">{beancountOpenCount}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{beancountNeedsWorkCount} 个需处理</p>
        </div>
      </div>

      <form onSubmit={doAdd} className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <label className="text-xs text-slate-400 block mb-2">创建 Ledger 账户</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="例如：Food:Coffee"
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          />
          <button
            type="submit"
            disabled={loading || !newName.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md"
          >
            创建
          </button>
        </div>
      </form>

      <div className="flex flex-col md:flex-row gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索 Ledger 账户"
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
        />
        <select
          value={groupFilter}
          onChange={e => setGroupFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100"
        >
          <option value="">全部分组</option>
          {groups.map(group => (
            <option key={group} value={group}>{group}</option>
          ))}
        </select>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="hidden lg:grid grid-cols-[1.3fr_120px_160px_120px_140px_240px] gap-4 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
          <span>Ledger 账户</span>
          <span>分组</span>
          <span>影响</span>
          <span>类型</span>
          <span>Beancount</span>
          <span>操作</span>
        </div>

        {filteredStats.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">没有匹配的 Ledger 账户</div>
        ) : (
          filteredStats.map((cat, i) => {
            const protectedCategory = Boolean(cat.is_required || cat.is_virtual)
            const canDelete = !protectedCategory && impactTotal(cat) === 0
            const usageTitle = protectedCategory
              ? '系统 Ledger 账户不能使用此操作'
              : impactTotal(cat) > 0
              ? '已有记录引用，请先合并'
              : '删除'

            return (
              <div
                key={cat.name}
                className={`px-4 py-3 space-y-3 ${i > 0 ? 'border-t border-slate-700' : ''}`}
              >
                <div className="flex flex-col lg:grid lg:grid-cols-[1.3fr_120px_160px_120px_140px_240px] gap-2 lg:gap-4 items-start lg:items-center">
                  <div className="min-w-0">
                    <Link href={transactionHref(cat.name)} className="text-sm text-slate-100 font-mono hover:text-blue-300 break-all">
                      {cat.name}
                    </Link>
                    {cat.is_virtual ? <p className="text-xs text-slate-500 mt-1">虚拟 Ledger 账户</p> : null}
                  </div>
                  <span className="text-xs text-slate-400">{categoryGroup(cat.name)}</span>
                  <span className="text-xs text-slate-400">{impactLabel(cat)}</span>
                  <span className={`text-xs ${cat.is_default ? 'text-slate-500' : 'text-blue-400'}`}>
                    {cat.is_required ? '系统' : cat.is_default ? '默认' : '自定义'}
                  </span>
                  <span
                    title={cat.beancount_error ?? undefined}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${beancountStatusClass(cat.beancount_status)}`}
                  >
                    {beancountStatusLabel(cat)}
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setRenamingFrom(cat.name)
                        setRenameTo(cat.name)
                        setMergingFrom(null)
                        setError(null)
                      }}
                      disabled={loading || protectedCategory}
                      title={protectedCategory ? '系统 Ledger 账户不能重命名' : '重命名'}
                      className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                    >
                      重命名
                    </button>
                    <button
                      onClick={() => {
                        setMergingFrom(cat.name)
                        setMergeTarget('')
                        setRenamingFrom(null)
                        setError(null)
                      }}
                      disabled={loading || protectedCategory}
                      title={protectedCategory ? '系统 Ledger 账户不能合并' : '合并到另一个 Ledger 账户'}
                      className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                    >
                      合并
                    </button>
                    <button
                      onClick={() => doDelete(cat)}
                      disabled={loading || !canDelete}
                      title={usageTitle}
                      className="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900/70 text-red-400 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {renamingFrom === cat.name && (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <span className="text-xs text-slate-500 shrink-0">重命名为</span>
                    <input
                      autoFocus
                      value={renameTo}
                      onChange={e => setRenameTo(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') doRename(cat.name)
                        if (e.key === 'Escape') setRenamingFrom(null)
                      }}
                      placeholder="新的 Ledger 账户名"
                      className="flex-1 bg-slate-700 border border-blue-500 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-500"
                    />
                    <button
                      onClick={() => doRename(cat.name)}
                      disabled={loading || !renameTo.trim()}
                      className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
                    >
                      确认
                    </button>
                    <button onClick={() => setRenamingFrom(null)} className="text-xs px-3 py-1 bg-slate-600 text-white rounded">
                      取消
                    </button>
                  </div>
                )}

                {mergingFrom === cat.name && (
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <span className="text-xs text-slate-500 shrink-0">合并到</span>
                    <select
                      autoFocus
                      value={mergeTarget}
                      onChange={e => setMergeTarget(e.target.value)}
                      className="flex-1 bg-slate-700 border border-amber-500 rounded px-2 py-1 text-xs text-slate-100"
                    >
                      <option value="">选择目标 Ledger 账户</option>
                      {targetNames.filter(name => name !== cat.name && name !== 'Uncategorized').map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => doMerge(cat.name)}
                      disabled={loading || !mergeTarget}
                      className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded"
                    >
                      合并
                    </button>
                    <button onClick={() => setMergingFrom(null)} className="text-xs px-3 py-1 bg-slate-600 text-white rounded">
                      取消
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
