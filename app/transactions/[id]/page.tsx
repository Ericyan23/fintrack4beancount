'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Transaction } from '@/lib/db/schema'
import CategorySelect from '@/components/CategorySelect'

interface AccountInfo {
  id: string
  name: string
}

interface TransactionSplitFormRow {
  localId: string
  id?: string
  amount: string
  currency?: string
  ledgerAccount: string
  memo: string
  notes: string
}

type SplitField = 'amount' | 'ledgerAccount' | 'memo' | 'notes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

function newLocalId(): string {
  return `split-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function blankSplitRow(): TransactionSplitFormRow {
  return {
    localId: newLocalId(),
    amount: '',
    ledgerAccount: '',
    memo: '',
    notes: '',
  }
}

function splitRowsFromResponse(data: unknown): TransactionSplitFormRow[] {
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.splits)
      ? data.splits
      : []

  return rows.map((row): TransactionSplitFormRow => {
    const record = isRecord(row) ? row : {}
    const id = formString(record.id)
    const currency = formString(record.currency)

    return {
      localId: id || newLocalId(),
      id: id || undefined,
      amount: formString(record.amount),
      currency: currency || undefined,
      ledgerAccount: formString(record.ledgerAccount ?? record.ledger_account),
      memo: formString(record.memo),
      notes: formString(record.notes),
    }
  })
}

function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function apiErrorMessage(data: unknown, fallback: string): string {
  if (!isRecord(data)) return fallback

  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error
  }

  if (Array.isArray(data.validationErrors)) {
    const messages = data.validationErrors.filter((error): error is string => typeof error === 'string')
    if (messages.length > 0) return messages.join(', ')
  }

  if (Array.isArray(data.errors)) {
    const messages = data.errors
      .map(error => {
        if (typeof error === 'string') return error
        if (isRecord(error) && typeof error.error === 'string') return error.error
        return null
      })
      .filter((error): error is string => Boolean(error))
    if (messages.length > 0) return messages.join(', ')
  }

  return fallback
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [txn, setTxn] = useState<Transaction | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')
  const [splits, setSplits] = useState<TransactionSplitFormRow[]>([])
  const [splitLoading, setSplitLoading] = useState(true)
  const [splitSaving, setSplitSaving] = useState(false)
  const [splitClearing, setSplitClearing] = useState(false)
  const [splitError, setSplitError] = useState<string | null>(null)
  const [hasPersistedSplits, setHasPersistedSplits] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    params.then(async ({ id }) => {
      setLoading(true)
      setSplitLoading(true)
      setSplitError(null)

      try {
        const encodedId = encodeURIComponent(id)
        const txnRes = await fetch(`/api/transactions/${encodedId}`)
        const data = await readJson(txnRes)
        if (!txnRes.ok || !isRecord(data)) {
          if (!cancelled) {
            setTxn(null)
            setSplits([])
            setHasPersistedSplits(false)
          }
          return
        }

        const transaction = data as Transaction
        if (cancelled) return

        setTxn(transaction)
        setCategory(transaction.category ?? '')
        setNotes(transaction.notes ?? '')

        const [accountsResult, splitsResult] = await Promise.allSettled([
          fetch('/api/accounts'),
          fetch(`/api/transactions/${encodedId}/splits`),
        ])

        if (cancelled) return

        if (accountsResult.status === 'fulfilled' && accountsResult.value.ok) {
          const accountsRes = accountsResult.value
          const accountsData = (await readJson(accountsRes)) as { accounts?: AccountInfo[] } | null
          setAccount(accountsData?.accounts?.find(a => a.id === transaction.accountId) ?? null)
        } else {
          setAccount(null)
        }

        if (splitsResult.status !== 'fulfilled') {
          setSplits([])
          setHasPersistedSplits(false)
          setSplitError('Unable to load split postings.')
          return
        }

        const splitsRes = splitsResult.value
        const splitsData = await readJson(splitsRes)
        if (splitsRes.ok) {
          const nextSplits = splitRowsFromResponse(splitsData)
          setSplits(nextSplits)
          setHasPersistedSplits(nextSplits.length > 0)
        } else {
          setSplits([])
          setHasPersistedSplits(false)
          setSplitError(apiErrorMessage(splitsData, 'Unable to load split postings.'))
        }
      } catch {
        if (!cancelled) {
          setTxn(null)
          setSplits([])
          setHasPersistedSplits(false)
        }
      } finally {
        if (!cancelled) {
          setSplitLoading(false)
          setLoading(false)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [params])

  const save = useCallback(async () => {
    if (!txn) return
    setSaving(true)
    await fetch(`/api/transactions/${encodeURIComponent(txn.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: category || null,
        notes: notes || null,
      }),
    })
    setSaving(false)
    router.back()
  }, [txn, category, notes, router])

  const updateSplit = useCallback((index: number, field: SplitField, value: string) => {
    setSplits(current => current.map((split, splitIndex) => (
      splitIndex === index ? { ...split, [field]: value } : split
    )))
    setSplitError(null)
  }, [])

  const addSplitRow = useCallback(() => {
    setSplits(current => [...current, blankSplitRow()])
    setSplitError(null)
  }, [])

  const removeSplitRow = useCallback((index: number) => {
    setSplits(current => current.filter((_, splitIndex) => splitIndex !== index))
    setSplitError(null)
  }, [])

  const seedSplitRows = useCallback(() => {
    if (!txn) return

    setSplits([
      {
        localId: newLocalId(),
        amount: txn.amount,
        ledgerAccount: category || txn.category || txn.suggestedCat || '',
        memo: '',
        notes: '',
      },
      blankSplitRow(),
    ])
    setSplitError(null)
  }, [txn, category])

  const saveSplits = useCallback(async () => {
    if (!txn) return

    setSplitSaving(true)
    setSplitError(null)

    try {
      const res = await fetch(`/api/transactions/${encodeURIComponent(txn.id)}/splits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: splits.map(split => ({
            amount: split.amount.trim(),
            ...(split.currency ? { currency: split.currency.trim() } : {}),
            ledgerAccount: split.ledgerAccount.trim(),
            memo: nullableText(split.memo),
            notes: nullableText(split.notes),
          })),
        }),
      })
      const data = await readJson(res)

      if (!res.ok) {
        setSplitError(apiErrorMessage(data, 'Unable to save split postings.'))
        return
      }

      const nextSplits = splitRowsFromResponse(data)
      if (nextSplits.length > 0) {
        setSplits(nextSplits)
      }
      setHasPersistedSplits(true)
    } catch {
      setSplitError('Unable to save split postings.')
    } finally {
      setSplitSaving(false)
    }
  }, [txn, splits])

  const clearSplits = useCallback(async () => {
    if (!txn || !hasPersistedSplits) return

    setSplitClearing(true)
    setSplitError(null)

    try {
      const res = await fetch(`/api/transactions/${encodeURIComponent(txn.id)}/splits`, {
        method: 'DELETE',
      })
      const data = await readJson(res)

      if (!res.ok) {
        setSplitError(apiErrorMessage(data, 'Unable to clear split postings.'))
        return
      }

      setSplits([])
      setHasPersistedSplits(false)
    } catch {
      setSplitError('Unable to clear split postings.')
    } finally {
      setSplitClearing(false)
    }
  }, [txn, hasPersistedSplits])

  if (loading) {
    return <div className="text-center py-12 text-slate-500">Loading...</div>
  }
  if (!txn) {
    return <div className="text-center py-12 text-slate-500">Transaction not found</div>
  }

  const amount = parseFloat(txn.amount)
  const isPositive = amount > 0

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm text-slate-400 hover:text-slate-300"
      >
        ← Back
      </button>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h1 className="text-lg font-semibold text-slate-100 break-words">{txn.description}</h1>
        <p
          className={`text-3xl font-bold mt-2 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {isPositive ? '+' : ''}
          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)}
        </p>
        <div className="mt-3 space-y-1 text-sm text-slate-400">
          <p>Date: {new Date(txn.posted * 1000).toLocaleDateString('en-US')}</p>
          {txn.transactedAt && (
            <p>Transaction time: {new Date(txn.transactedAt * 1000).toLocaleDateString('en-US')}</p>
          )}
          <p>Account: {account?.name ?? txn.accountId}</p>
          {txn.status === 'pending' && <p className="text-amber-400">⚠ Pending</p>}
          {txn.status === 'cancelled' && <p className="text-slate-500">✕ Cancelled</p>}
          <p>Source: {txn.source}</p>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <h2 className="text-sm font-medium text-slate-300">Edit details</h2>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Category</label>
          {txn.suggestedCat && !txn.category && (
            <p className="text-xs text-blue-400 mb-1">AI suggestion: {txn.suggestedCat}</p>
          )}
          <CategorySelect
            value={category}
            onChange={setCategory}
            placeholder="-- Uncategorized --"
            className="w-full py-2"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Add notes..."
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-md"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-300">Split postings</h2>
            <p className="mt-1 text-xs text-slate-500">
              Ledger postings attached to this parent transaction; no new source transactions are created.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasPersistedSplits && (
              <button
                type="button"
                onClick={clearSplits}
                disabled={splitSaving || splitClearing}
                className="rounded-md border border-red-900/70 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                {splitClearing ? 'Clearing...' : 'Clear splits'}
              </button>
            )}
            {splits.length === 0 && (
              <button
                type="button"
                onClick={seedSplitRows}
                disabled={splitLoading}
                className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                Seed split
              </button>
            )}
            <button
              type="button"
              onClick={addSplitRow}
              disabled={splitLoading}
              className="rounded-md bg-slate-700 px-2 py-1 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            >
              Add posting
            </button>
          </div>
        </div>

        {splitError && (
          <div className="rounded-md border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-200">
            {splitError}
          </div>
        )}

        {splitLoading ? (
          <div className="rounded-md border border-slate-700 bg-slate-900/30 px-3 py-3 text-xs text-slate-500">
            Loading split postings...
          </div>
        ) : splits.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-700 px-3 py-4 text-xs text-slate-500">
            No split postings saved for this transaction.
          </div>
        ) : (
          <div className="space-y-3">
            {splits.map((split, index) => (
              <div
                key={split.localId}
                className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/40 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-400">Posting {index + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeSplitRow(index)}
                    className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Amount</label>
                    <input
                      value={split.amount}
                      onChange={e => updateSplit(index, 'amount', e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full rounded border border-slate-600 bg-slate-700 px-2 py-2 text-sm text-slate-100 placeholder-slate-500"
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block text-xs text-slate-500">Ledger account</label>
                    <CategorySelect
                      value={split.ledgerAccount}
                      onChange={value => updateSplit(index, 'ledgerAccount', value)}
                      placeholder="Ledger account"
                      searchable
                      className="py-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Memo</label>
                    <input
                      value={split.memo}
                      onChange={e => updateSplit(index, 'memo', e.target.value)}
                      placeholder="Optional memo"
                      className="w-full rounded border border-slate-600 bg-slate-700 px-2 py-2 text-sm text-slate-100 placeholder-slate-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Notes</label>
                    <input
                      value={split.notes}
                      onChange={e => updateSplit(index, 'notes', e.target.value)}
                      placeholder="Optional notes"
                      className="w-full rounded border border-slate-600 bg-slate-700 px-2 py-2 text-sm text-slate-100 placeholder-slate-500"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={saveSplits}
              disabled={splitSaving || splitClearing || splits.length === 0}
              className="w-full rounded-md bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {splitSaving ? 'Saving postings...' : 'Save split postings'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
