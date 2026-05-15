'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import CategorySelect from '@/components/CategorySelect'

interface AccountInfo {
  id: string
  name: string
  beancountAccount?: string | null
}

interface CreateResponse {
  transaction?: {
    id: string
  }
  error?: string
  validationErrors?: string[]
}

function todayInputValue(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function splitTags(value: string): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  for (const tag of value.split(/[;,|]/)) {
    const trimmed = tag.trim()
    if (!trimmed || seen.has(trimmed)) continue
    tags.push(trimmed)
    seen.add(trimmed)
  }
  return tags
}

async function readJson(response: Response): Promise<CreateResponse> {
  try {
    return (await response.json()) as CreateResponse
  } catch {
    return {}
  }
}

export default function NewTransactionPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [accountId, setAccountId] = useState('')
  const [postedDate, setPostedDate] = useState(todayInputValue)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [ledgerAccount, setLedgerAccount] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadAccounts() {
      setAccountsLoading(true)
      try {
        const response = await fetch('/api/accounts')
        const data = (await response.json()) as { accounts?: AccountInfo[] }
        if (cancelled) return

        const nextAccounts = data.accounts ?? []
        setAccounts(nextAccounts)
        setAccountId(current => current || nextAccounts[0]?.id || '')
      } catch {
        if (!cancelled) setError('Unable to load accounts.')
      } finally {
        if (!cancelled) setAccountsLoading(false)
      }
    }

    loadAccounts()

    return () => {
      cancelled = true
    }
  }, [])

  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === accountId) ?? null,
    [accounts, accountId],
  )

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const response = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          postedDate,
          amount,
          description,
          ledgerAccount: ledgerAccount || null,
          notes: notes || null,
          tags: splitTags(tags),
          createReason: 'manual transaction entry',
        }),
      })
      const data = await readJson(response)

      if (!response.ok || !data.transaction?.id) {
        setError(data.validationErrors?.join(', ') || data.error || 'Unable to create transaction.')
        return
      }

      router.push(`/transactions/${encodeURIComponent(data.transaction.id)}`)
    } catch {
      setError('Unable to create transaction.')
    } finally {
      setSaving(false)
    }
  }, [accountId, postedDate, amount, description, ledgerAccount, notes, tags, router])

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm text-slate-400 hover:text-slate-300"
        >
          Back
        </button>
        <a
          href="/transactions"
          className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
        >
          Prep queue
        </a>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">New manual transaction</h1>
          {selectedAccount?.beancountAccount && (
            <p className="mt-1 text-xs text-slate-500">{selectedAccount.beancountAccount}</p>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-red-900/70 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Account</label>
            <select
              value={accountId}
              onChange={event => setAccountId(event.target.value)}
              disabled={accountsLoading}
              required
              className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Select account</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Date</label>
            <input
              type="date"
              value={postedDate}
              onChange={event => setPostedDate(event.target.value)}
              required
              className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Amount</label>
            <input
              value={amount}
              onChange={event => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="-12.34"
              required
              className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Description</label>
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              required
              className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Ledger account</label>
          <CategorySelect
            value={ledgerAccount}
            onChange={setLedgerAccount}
            placeholder="-- Needs review --"
            searchable
            className="w-full py-2"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Notes</label>
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            rows={3}
            className="w-full resize-none rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Tags</label>
          <input
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="receipt, tax"
            className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || accountsLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create transaction'}
          </button>
        </div>
      </form>
    </div>
  )
}
