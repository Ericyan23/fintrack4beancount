'use client'

import { useState, useCallback, useMemo } from 'react'
import type { Transaction } from '@/lib/db/schema'
import CategoryBadge from './CategoryBadge'
import CategorySelect from './CategorySelect'

function formatAmount(amount: string): { text: string; positive: boolean } {
  const num = parseFloat(amount)
  const positive = num > 0
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(num))
  return { text: positive ? `+${formatted}` : `-${formatted}`, positive }
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function hasPendingSuggestion(txn: Transaction): txn is Transaction & { suggestedCat: string } {
  return !txn.category && typeof txn.suggestedCat === 'string' && txn.suggestedCat.length > 0
}

interface Props {
  transactions: Transaction[]
  accounts?: Array<{ id: string; name: string }>
  onUpdate?: () => void
}

export default function TransactionList({ transactions: txns, accounts = [], onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkCategory, setBulkCategory] = useState('')
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({})
  const [bulkAccepting, setBulkAccepting] = useState(false)
  const accountNames = useMemo(() => new Map(accounts.map(a => [a.id, a.name])), [accounts])
  const visibleSuggestedTxns = useMemo(() => txns.filter(hasPendingSuggestion), [txns])
  const selectedSuggestedTxns = useMemo(
    () => txns.filter(txn => selected.has(txn.id)).filter(hasPendingSuggestion),
    [selected, txns],
  )

  const updateCategory = useCallback(async (id: string, category: string) => {
    setLoading(prev => ({ ...prev, [id]: true }))
    try {
      await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      })
      onUpdate?.()
    } finally {
      setLoading(prev => ({ ...prev, [id]: false }))
      setEditingId(null)
    }
  }, [onUpdate])

  const confirmSuggested = useCallback(async (txn: Transaction) => {
    if (!txn.suggestedCat) return
    await updateCategory(txn.id, txn.suggestedCat)
  }, [updateCategory])

  const ignoreSuggested = useCallback(async (txn: Transaction) => {
    setLoading(prev => ({ ...prev, [txn.id]: true }))
    try {
      await fetch(`/api/transactions/${encodeURIComponent(txn.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestedCat: null }),
      })
      onUpdate?.()
    } finally {
      setLoading(prev => ({ ...prev, [txn.id]: false }))
    }
  }, [onUpdate])

  const askAI = useCallback(async (id: string) => {
    setAiLoading(prev => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(`/api/transactions/${encodeURIComponent(id)}/classify`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        alert(data.error ?? 'AI request failed')
        return
      }
      onUpdate?.()
    } finally {
      setAiLoading(prev => ({ ...prev, [id]: false }))
    }
  }, [onUpdate])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectVisibleSuggestions = () => {
    setSelected(prev => {
      const next = new Set(prev)
      visibleSuggestedTxns.forEach(txn => next.add(txn.id))
      return next
    })
  }

  const applyBulk = async () => {
    if (!bulkCategory || selected.size === 0) return
    const ids = Array.from(selected)
    setLoading(prev => {
      const next = { ...prev }
      ids.forEach(id => { next[id] = true })
      return next
    })
    try {
      const responses = await Promise.all(
        ids.map(id =>
          fetch(`/api/transactions/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: bulkCategory }),
          }),
        ),
      )
      const failed = responses.filter(res => !res.ok).length
      if (failed > 0) alert(`${failed} transaction updates failed`)
      setSelected(new Set())
      setBulkCategory('')
      onUpdate?.()
    } finally {
      setLoading(prev => {
        const next = { ...prev }
        ids.forEach(id => { next[id] = false })
        return next
      })
    }
  }

  const acceptSelectedSuggestions = async () => {
    if (selectedSuggestedTxns.length === 0) return
    const confirmed = window.confirm(`Accept ${selectedSuggestedTxns.length} AI suggestions?`)
    if (!confirmed) return

    const ids = selectedSuggestedTxns.map(txn => txn.id)
    setBulkAccepting(true)
    setLoading(prev => {
      const next = { ...prev }
      ids.forEach(id => { next[id] = true })
      return next
    })
    try {
      const responses = await Promise.all(
        selectedSuggestedTxns.map(txn =>
          fetch(`/api/transactions/${encodeURIComponent(txn.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: txn.suggestedCat }),
          }),
        ),
      )
      const failed = responses.filter(res => !res.ok).length
      if (failed > 0) alert(`${failed} AI suggestions failed to apply`)
      setSelected(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
      onUpdate?.()
    } finally {
      setBulkAccepting(false)
      setLoading(prev => {
        const next = { ...prev }
        ids.forEach(id => { next[id] = false })
        return next
      })
    }
  }

  if (txns.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        No transactions yet
      </div>
    )
  }

  return (
    <div className="relative">
      {visibleSuggestedTxns.length > 0 && (
        <div className="mb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-blue-900/60 bg-blue-950/30 px-3 py-2">
          <span className="text-xs text-blue-200">
            This page has {visibleSuggestedTxns.length} AI suggestions to review
          </span>
          <button
            onClick={selectVisibleSuggestions}
            className="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded"
          >
            Select page suggestions
          </button>
        </div>
      )}

      <div className="space-y-1">
        {txns.map(txn => {
          const { text: amtText, positive } = formatAmount(txn.amount)
          const isUnclassified = !txn.category
          const isEditing = editingId === txn.id
          const isSelected = selected.has(txn.id)
          const accountName = accountNames.get(txn.accountId)

          return (
            <div
              key={txn.id}
              className={`rounded-lg p-3 transition-colors ${
                isUnclassified
                  ? 'bg-amber-950/40 border border-amber-800/50'
                  : 'bg-slate-800 border border-slate-700'
              } ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(txn.id)}
                  className="mt-1 rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">
                        {txn.description}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(txn.posted)}
                        {accountName && (
                          <span className="ml-2 text-slate-500">· {accountName}</span>
                        )}
                        {txn.status === 'pending' && (
                          <span className="ml-2 text-amber-400">Pending</span>
                        )}
                        {txn.status === 'cancelled' && (
                          <span className="ml-2 text-slate-500">Cancelled</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-sm font-semibold ${
                          positive ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {amtText}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {isEditing ? (
                      <CategorySelect
                        autoFocus
                        value={txn.category ?? ''}
                        onChange={v => { if (v) updateCategory(txn.id, v) }}
                        onBlur={() => setEditingId(null)}
                        className="text-xs"
                      />
                    ) : (
                      <CategoryBadge
                        category={txn.category}
                        suggested={txn.suggestedCat}
                        onClick={() => setEditingId(txn.id)}
                      />
                    )}

                    {!txn.category && txn.suggestedCat && (
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400">AI suggestion:</span>
                        <span className="text-blue-300">{txn.suggestedCat}</span>
                        <button
                          onClick={() => confirmSuggested(txn)}
                          disabled={loading[txn.id]}
                          className="px-1.5 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded text-xs ml-1"
                        >
                          ✓ Accept
                        </button>
                        <button
                          onClick={() => ignoreSuggested(txn)}
                          disabled={loading[txn.id]}
                          className="px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs"
                        >
                          ✗ Ignore
                        </button>
                      </div>
                    )}

                    {!txn.category && !txn.suggestedCat && (
                      <button
                        onClick={() => askAI(txn.id)}
                        disabled={aiLoading[txn.id]}
                        className="px-1.5 py-0.5 bg-violet-900/60 hover:bg-violet-800/80 text-violet-300 rounded text-xs disabled:opacity-50"
                      >
                        {aiLoading[txn.id] ? '...' : '✦ AI'}
                      </button>
                    )}

                    {loading[txn.id] && (
                      <span className="text-xs text-slate-400 animate-pulse">Saving...</span>
                    )}
                  </div>

                  {txn.notes && (
                    <p className="text-xs text-slate-500 mt-1">{txn.notes}</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-4 right-4 bg-slate-700 border border-slate-600 rounded-xl p-3 shadow-2xl flex flex-col sm:flex-row sm:items-center gap-3 z-40">
          <span className="text-sm text-slate-300 shrink-0">
            {selected.size} selected
            {selectedSuggestedTxns.length > 0 && (
              <span className="text-blue-300"> · {selectedSuggestedTxns.length} with AI suggestions</span>
            )}
          </span>
          {selectedSuggestedTxns.length > 0 && (
            <button
              onClick={acceptSelectedSuggestions}
              disabled={bulkAccepting}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded shrink-0"
            >
              {bulkAccepting ? 'Accepting...' : 'Accept AI suggestions'}
            </button>
          )}
          <CategorySelect
            value={bulkCategory}
            onChange={setBulkCategory}
            placeholder="-- Set category in bulk --"
            className="flex-1 min-w-0 py-1.5"
          />
          <button
            onClick={applyBulk}
            disabled={!bulkCategory}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded shrink-0"
          >
            Apply
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
