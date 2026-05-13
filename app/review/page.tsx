'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import CategorySelect from '@/components/CategorySelect'

interface ReviewTransaction {
  id: string
  posted: number
  amount: string
  description: string
  accountId: string
  accountName: string
  category: string | null
  suggestedCat: string | null
}

interface ReviewGroup {
  key: string
  direction: 'spending' | 'income' | 'zero'
  reason: 'uncategorized' | 'review_category' | 'mixed'
  sampleDescription: string
  normalizedDescription: string
  suggestedPattern: string
  transactionIds: string[]
  transactions: ReviewTransaction[]
  count: number
  net: number
  totalAbs: number
  minAbs: number
  maxAbs: number
  latestPosted: number
  accounts: string[]
  currentCategories: Array<{ category: string; count: number }>
  suggestedCategories: Array<{ category: string; count: number }>
}

interface ReviewPayload {
  groups: ReviewGroup[]
  summary: {
    groups: number
    transactions: number
    uncategorized: number
    reviewCategory: number
  }
}

interface ApplyForm {
  category: string
  createRule: boolean
  pattern: string
  priority: number
}

type Scope = 'all' | 'spending' | 'income' | 'uncategorized' | 'review'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function formatSignedAmount(amount: string): { text: string; positive: boolean } {
  const value = Number.parseFloat(amount)
  const positive = value > 0
  return {
    text: `${positive ? '+' : '-'}${formatCurrency(Math.abs(value))}`,
    positive,
  }
}

function reasonLabel(reason: ReviewGroup['reason']): string {
  if (reason === 'uncategorized') return 'Uncategorized'
  if (reason === 'review_category') return 'Marked for review'
  return 'Mixed'
}

function directionLabel(direction: ReviewGroup['direction']): string {
  if (direction === 'spending') return 'Outflow'
  if (direction === 'income') return 'Inflow'
  return 'Zero amount'
}

function defaultForm(group: ReviewGroup): ApplyForm {
  return {
    category: group.suggestedCategories[0]?.category ?? '',
    createRule: true,
    pattern: group.suggestedPattern,
    priority: 80,
  }
}

export default function ReviewPage() {
  const [payload, setPayload] = useState<ReviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('all')
  const [forms, setForms] = useState<Record<string, ApplyForm>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadReview = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/review')
    const data = (await res.json()) as ReviewPayload
    setPayload(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadReview() }, [loadReview])

  const groups = useMemo(() => {
    const all = payload?.groups ?? []
    if (scope === 'all') return all
    if (scope === 'uncategorized') return all.filter(group => group.reason !== 'review_category')
    if (scope === 'review') return all.filter(group => group.reason !== 'uncategorized')
    return all.filter(group => group.direction === scope)
  }, [payload, scope])

  function formFor(group: ReviewGroup): ApplyForm {
    return forms[group.key] ?? defaultForm(group)
  }

  function updateForm(group: ReviewGroup, patch: Partial<ApplyForm>) {
    setForms(prev => ({
      ...prev,
      [group.key]: {
        ...formFor(group),
        ...patch,
      },
    }))
  }

  async function applyGroup(group: ReviewGroup) {
    const form = formFor(group)
    if (!form.category) return

    setSaving(prev => ({ ...prev, [group.key]: true }))
    setMessage(null)
    setError(null)
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionIds: group.transactionIds,
          category: form.category,
          createRule: form.createRule,
          pattern: form.pattern,
          priority: form.priority,
        }),
      })
      const data = (await res.json()) as { changed?: number; ruleCreated?: boolean; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Update failed')
        return
      }
      setMessage(
        `Categorized ${data.changed ?? 0} transactions${data.ruleCreated ? ' and saved a rule' : ''}`,
      )
      setForms(prev => {
        const next = { ...prev }
        delete next[group.key]
        return next
      })
      await loadReview()
    } finally {
      setSaving(prev => ({ ...prev, [group.key]: false }))
    }
  }

  const summary = payload?.summary

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Ledger Prep</h1>
          <p className="mt-1 text-sm text-slate-500">
            Resolve category gaps and review markers before Beancount export.
          </p>
        </div>
        <button
          onClick={loadReview}
          disabled={loading}
          className="self-start rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs text-slate-400">Transactions needing prep</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-300">{summary.transactions}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs text-slate-400">Prep groups</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-300">{summary.groups}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs text-slate-400">Missing category</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-red-300">{summary.uncategorized}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <p className="text-xs text-slate-400">Review markers</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-violet-300">{summary.reviewCategory}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          ['all', 'All'],
          ['spending', 'Outflows'],
          ['income', 'Inflows'],
          ['uncategorized', 'Uncategorized'],
          ['review', 'Marked for review'],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setScope(value as Scope)}
            className={`rounded-full px-3 py-1 text-sm ${
              scope === value
                ? 'bg-blue-600 text-white'
                : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-slate-500">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-10 text-center text-slate-400">
          No ledger prep items for the current filter
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const form = formFor(group)
            const isSaving = saving[group.key]

            return (
              <section key={group.key} className="relative overflow-visible rounded-xl border border-slate-700 bg-slate-800">
                <div className="border-b border-slate-700 px-4 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          group.direction === 'income'
                            ? 'bg-emerald-950 text-emerald-300'
                            : group.direction === 'spending'
                            ? 'bg-red-950 text-red-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {directionLabel(group.direction)}
                        </span>
                        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                          {reasonLabel(group.reason)}
                        </span>
                        <span className="text-xs text-slate-500">Latest {formatDate(group.latestPosted)}</span>
                      </div>
                      <h2 className="mt-2 truncate text-base font-semibold text-slate-100">
                        {group.sampleDescription}
                      </h2>
                      <p className="mt-1 truncate text-xs text-slate-500">{group.normalizedDescription}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right text-xs lg:min-w-72">
                      <div>
                        <p className="text-slate-500">Count</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-slate-200">{group.count}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Total</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-slate-200">
                          {formatCurrency(group.totalAbs)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Range</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-slate-200">
                          {formatCurrency(group.minAbs)}-{formatCurrency(group.maxAbs)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {group.accounts.slice(0, 5).map(account => (
                      <span key={account} className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-slate-400">
                        {account}
                      </span>
                    ))}
                    {group.accounts.length > 5 && (
                      <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-slate-500">
                        +{group.accounts.length - 5}
                      </span>
                    )}
                    {group.currentCategories.map(item => (
                      <span key={item.category} className="rounded-full bg-violet-950 px-2 py-0.5 text-xs text-violet-300">
                        {item.category} × {item.count}
                      </span>
                    ))}
                    {group.suggestedCategories.map(item => (
                      <button
                        key={item.category}
                        onClick={() => updateForm(group, { category: item.category })}
                        className="rounded-full bg-blue-950 px-2 py-0.5 text-xs text-blue-300 hover:bg-blue-900"
                      >
                        Suggested {item.category} x {item.count}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 px-4 py-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(260px,1fr)]">
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Target category</label>
                        <CategorySelect
                          value={form.category}
                          onChange={category => updateForm(group, { category })}
                          searchable
                          className="w-full py-2"
                        />
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="text-xs text-slate-400">Rule pattern</label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-400">
                            <input
                              type="checkbox"
                              checked={form.createRule}
                              onChange={event => updateForm(group, { createRule: event.target.checked })}
                              className="rounded"
                            />
                            Save rule
                          </label>
                        </div>
                        <input
                          type="text"
                          value={form.pattern}
                          disabled={!form.createRule}
                          onChange={event => updateForm(group, { pattern: event.target.value })}
                          className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 font-mono text-sm text-slate-100 disabled:opacity-50"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => applyGroup(group)}
                      disabled={!form.category || isSaving}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {isSaving ? 'Applying...' : `Apply to ${group.count}`}
                    </button>
                  </div>

                  <details className="rounded-lg border border-slate-700 bg-slate-900/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 hover:text-slate-200">
                      View sample transactions, up to 20
                    </summary>
                    <div className="divide-y divide-slate-800 border-t border-slate-700">
                      {group.transactions.map(txn => {
                        const amount = formatSignedAmount(txn.amount)
                        return (
                          <div key={txn.id} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[84px_1fr_auto]">
                            <span className="text-slate-500">{formatDate(txn.posted)}</span>
                            <span className="min-w-0 truncate text-slate-300">
                              {txn.description}
                              <span className="ml-2 text-slate-500">{txn.accountName}</span>
                            </span>
                            <span className={`font-medium tabular-nums ${
                              amount.positive ? 'text-emerald-300' : 'text-red-300'
                            }`}>
                              {amount.text}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </details>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
