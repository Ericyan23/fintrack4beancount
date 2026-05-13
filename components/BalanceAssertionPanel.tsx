'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface AccountOption {
  id: string
  name: string
  currency: string
  beancountAccount: string | null
}

interface AccountsResponse {
  accounts: AccountOption[]
}

interface LedgerAccount {
  account: string
  root: string
  status: 'open' | 'closed' | 'not_yet_open'
}

interface LedgerAccountsResponse {
  accounts: LedgerAccount[]
  error?: string
}

type BalanceAssertionStatus = 'draft' | 'staged' | 'merged' | 'rejected'

interface BalanceAssertion {
  id: string
  fintrackAccountId: string | null
  fintrackAccountName: string | null
  beancountAccount: string
  assertionDate: string
  amount: string
  currency: string
  sourceId: string
  status: BalanceAssertionStatus
  note: string | null
}

interface BalanceAssertionsResponse {
  balanceAssertions: BalanceAssertion[]
  error?: string
}

interface BalanceAssertionIssue {
  severity: 'blocker' | 'review'
  code: string
  message: string
  balanceAssertionId?: string
  account?: string | null
  sourceId?: string
}

interface BalanceAssertionPreflightResult {
  ok: boolean
  period: string
  dateRange: { start: string; end: string }
  proposedStaging: string
  ledger: {
    filesScanned: number
    openAccounts: number
    sourceIds: number
    balances: number
  }
  summary: {
    assertionsScanned: number
    exportableAssertions: number
    blockers: number
    reviewItems: number
    duplicateCandidates: number
  }
  blockers: BalanceAssertionIssue[]
  reviewItems: BalanceAssertionIssue[]
  duplicateCandidates: BalanceAssertionIssue[]
  exportableAssertions: BalanceAssertion[]
}

interface FormState {
  fintrackAccountId: string
  beancountAccount: string
  assertionDate: string
  amount: string
  currency: string
  note: string
}

interface Props {
  period: string
}

function periodEnd(period: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return new Date().toISOString().slice(0, 10)
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function defaultForm(period: string): FormState {
  return {
    fintrackAccountId: '',
    beancountAccount: '',
    assertionDate: periodEnd(period),
    amount: '',
    currency: 'USD',
    note: '',
  }
}

function formatAmount(amount: string, currency: string): string {
  const value = Number.parseFloat(amount)
  if (!Number.isFinite(value)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      signDisplay: 'exceptZero',
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function renderBalanceDirective(assertion: BalanceAssertion): string {
  return `${assertion.assertionDate} balance ${assertion.beancountAccount} ${assertion.amount} ${assertion.currency}`
}

function statusLabel(status: BalanceAssertionStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'staged':
      return 'Staged'
    case 'merged':
      return 'Merged'
    case 'rejected':
      return 'Rejected'
  }
}

function statusClass(status: BalanceAssertionStatus): string {
  switch (status) {
    case 'draft':
      return 'border-blue-900/70 bg-blue-950/40 text-blue-300'
    case 'staged':
      return 'border-amber-900/70 bg-amber-950/40 text-amber-300'
    case 'merged':
      return 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300'
    case 'rejected':
      return 'border-slate-700 bg-slate-900 text-slate-400'
  }
}

function IssueList({ title, issues }: { title: string; issues: BalanceAssertionIssue[] }) {
  if (issues.length === 0) return null

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-300">{title}</span>
        <span className="rounded-full bg-slate-900 px-2 py-0.5 tabular-nums text-slate-500">{issues.length}</span>
      </div>
      {issues.map((issue, index) => (
        <div key={`${issue.code}-${issue.balanceAssertionId ?? index}`} className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-slate-300">{issue.code}</span>
            <span className="uppercase text-amber-300">{issue.severity}</span>
          </div>
          <p className="mt-2 text-slate-200">{issue.message}</p>
          <div className="mt-2 grid gap-1 text-slate-500 md:grid-cols-2">
            {issue.balanceAssertionId && <p className="truncate">assertion: <span className="font-mono">{issue.balanceAssertionId}</span></p>}
            {issue.account && <p className="truncate">account: <span className="font-mono">{issue.account}</span></p>}
            {issue.sourceId && <p className="truncate">source_id: <span className="font-mono">{issue.sourceId}</span></p>}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BalanceAssertionPanel({ period }: Props) {
  const [form, setForm] = useState<FormState>(() => defaultForm(period))
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([])
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([])
  const [assertions, setAssertions] = useState<BalanceAssertion[]>([])
  const [preflight, setPreflight] = useState<BalanceAssertionPreflightResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const draftHref = `/api/export/beancount/balance-assertions/draft?period=${encodeURIComponent(period)}`

  const ledgerAccountOptions = useMemo(() => {
    return ledgerAccounts.filter(account =>
      account.status === 'open' && (account.root === 'Assets' || account.root === 'Liabilities')
    )
  }, [ledgerAccounts])

  const statusCounts = useMemo(() => {
    return assertions.reduce<Record<BalanceAssertionStatus, number>>((counts, assertion) => {
      counts[assertion.status] += 1
      return counts
    }, { draft: 0, staged: 0, merged: 0, rejected: 0 })
  }, [assertions])

  const loadPreflight = useCallback(async () => {
    setPreflightLoading(true)
    setPreflightError(null)
    setDraftText(null)
    setDraftError(null)
    setCopied(false)
    try {
      const res = await fetch(`/api/export/beancount/balance-assertions/preflight?period=${encodeURIComponent(period)}`)
      const data = (await res.json().catch(() => ({}))) as Partial<BalanceAssertionPreflightResult> & { error?: string }
      if (!res.ok || typeof data.ok !== 'boolean') {
        setPreflight(null)
        setPreflightError(data.error ?? 'Balance assertion preflight failed')
        return
      }
      setPreflight(data as BalanceAssertionPreflightResult)
    } catch {
      setPreflight(null)
      setPreflightError('Balance assertion preflight 请求失败')
    } finally {
      setPreflightLoading(false)
    }
  }, [period])

  const loadAssertions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/beancount/balance-assertions?period=${encodeURIComponent(period)}`)
      const data = (await res.json().catch(() => ({}))) as Partial<BalanceAssertionsResponse>
      if (!res.ok || !Array.isArray(data.balanceAssertions)) {
        setError(data.error ?? '无法读取 balance assertions')
        setAssertions([])
        return
      }
      setAssertions(data.balanceAssertions)
    } catch {
      setError('无法读取 balance assertions')
      setAssertions([])
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    let cancelled = false

    async function loadOptions() {
      const [accountsRes, ledgerRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/beancount/accounts?status=open'),
      ])

      if (cancelled) return

      if (accountsRes.ok) {
        const data = (await accountsRes.json().catch(() => ({}))) as Partial<AccountsResponse>
        if (Array.isArray(data.accounts)) setAccountOptions(data.accounts)
      }

      if (ledgerRes.ok) {
        const data = (await ledgerRes.json().catch(() => ({}))) as Partial<LedgerAccountsResponse>
        if (Array.isArray(data.accounts)) setLedgerAccounts(data.accounts)
      }
    }

    loadOptions().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setForm(prev => ({ ...prev, assertionDate: periodEnd(period) }))
    loadAssertions()
    loadPreflight()
  }, [period, loadAssertions, loadPreflight])

  function updateForm(patch: Partial<FormState>) {
    setForm(prev => ({ ...prev, ...patch }))
  }

  function selectFintrackAccount(id: string) {
    const account = accountOptions.find(candidate => candidate.id === id)
    setForm(prev => ({
      ...prev,
      fintrackAccountId: id,
      beancountAccount: account?.beancountAccount ?? prev.beancountAccount,
      currency: account?.currency ?? prev.currency,
    }))
  }

  async function createAssertion(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/beancount/balance-assertions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fintrackAccountId: form.fintrackAccountId || null,
          beancountAccount: form.beancountAccount || null,
          assertionDate: form.assertionDate,
          amount: form.amount,
          currency: form.currency,
          note: form.note || null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? '保存 balance assertion 失败')
        return
      }
      setForm(prev => ({ ...prev, amount: '', note: '' }))
      await Promise.all([loadAssertions(), loadPreflight()])
    } catch {
      setError('保存 balance assertion 失败')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAssertion(id: string) {
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/beancount/balance-assertions?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? '删除 balance assertion 失败')
        return
      }
      await Promise.all([loadAssertions(), loadPreflight()])
    } catch {
      setError('删除 balance assertion 失败')
    } finally {
      setDeletingId(null)
    }
  }

  async function updateAssertionStatus(id: string, status: BalanceAssertionStatus) {
    setUpdatingStatusId(id)
    setError(null)
    try {
      const res = await fetch('/api/beancount/balance-assertions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? '更新 balance assertion 状态失败')
        return
      }
      await Promise.all([loadAssertions(), loadPreflight()])
    } catch {
      setError('更新 balance assertion 状态失败')
    } finally {
      setUpdatingStatusId(null)
    }
  }

  async function loadDraftPreview() {
    setDraftLoading(true)
    setDraftError(null)
    setCopied(false)
    try {
      const res = await fetch(draftHref)
      const text = await res.text()
      if (!res.ok) {
        try {
          const data = JSON.parse(text) as { error?: string }
          setDraftError(data.error ?? 'Balance assertion draft 生成失败')
        } catch {
          setDraftError(text || 'Balance assertion draft 生成失败')
        }
        setDraftText(null)
        return
      }
      setDraftText(text)
    } catch {
      setDraftError('Balance assertion draft 请求失败')
      setDraftText(null)
    } finally {
      setDraftLoading(false)
    }
  }

  async function copyDraft() {
    if (!draftText) return
    await navigator.clipboard.writeText(draftText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Balance Assertions</h2>
          <p className="mt-1 text-xs text-slate-500">Draft only · {period}</p>
        </div>
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs tabular-nums text-slate-400">
          {loading ? '读取中' : assertions.length}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        {(['draft', 'staged', 'merged', 'rejected'] as BalanceAssertionStatus[]).map(status => (
          <span key={status} className={`rounded-full border px-2 py-0.5 ${statusClass(status)}`}>
            {statusLabel(status)} {statusCounts[status]}
          </span>
        ))}
      </div>

      <form onSubmit={createAssertion} className="mt-4 grid gap-3 lg:grid-cols-[minmax(160px,1fr)_130px_minmax(240px,1.4fr)_120px_90px_minmax(160px,1fr)_90px]">
        <select
          value={form.fintrackAccountId}
          onChange={event => selectFintrackAccount(event.target.value)}
          className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
        >
          <option value="">FinTrack account</option>
          {accountOptions.map(account => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={form.assertionDate}
          onChange={event => updateForm({ assertionDate: event.target.value })}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100"
        />
        <input
          list="balance-assertion-beancount-accounts"
          value={form.beancountAccount}
          onChange={event => updateForm({ beancountAccount: event.target.value })}
          placeholder="Assets:... / Liabilities:..."
          className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-2 font-mono text-xs text-slate-100 placeholder-slate-600"
        />
        <datalist id="balance-assertion-beancount-accounts">
          {ledgerAccountOptions.map(account => (
            <option key={account.account} value={account.account} />
          ))}
        </datalist>
        <input
          inputMode="decimal"
          value={form.amount}
          onChange={event => updateForm({ amount: event.target.value })}
          placeholder="0.00"
          className="rounded border border-slate-600 bg-slate-900 px-2 py-2 text-right text-sm tabular-nums text-slate-100 placeholder-slate-600"
        />
        <input
          value={form.currency}
          onChange={event => updateForm({ currency: event.target.value.toUpperCase() })}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm uppercase text-slate-100"
        />
        <input
          value={form.note}
          onChange={event => updateForm({ note: event.target.value })}
          placeholder="备注"
          className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-100 placeholder-slate-600"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? '保存中' : '添加'}
        </button>
      </form>

      {error && (
        <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/30 p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold text-slate-300">Draft</h3>
              {preflightLoading && <span className="text-xs text-slate-500">检查中</span>}
              {preflight && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  preflight.ok ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'
                }`}>
                  {preflight.ok ? 'ready' : `${preflight.summary.blockers} blockers`}
                </span>
              )}
            </div>
            {preflight && (
              <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                staging: {preflight.proposedStaging}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={loadPreflight}
              disabled={preflightLoading}
              className="min-h-10 rounded border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              {preflightLoading ? '刷新中' : '刷新'}
            </button>
            <button
              type="button"
              onClick={loadDraftPreview}
              disabled={!preflight?.ok || preflight.summary.exportableAssertions === 0 || draftLoading}
              className="min-h-10 rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draftLoading ? '生成中' : '预览'}
            </button>
            <a
              href={preflight?.ok && preflight.summary.exportableAssertions > 0 ? draftHref : undefined}
              aria-disabled={!preflight?.ok || preflight.summary.exportableAssertions === 0}
              onClick={event => {
                if (!preflight?.ok || preflight.summary.exportableAssertions === 0) event.preventDefault()
              }}
              className={`inline-flex min-h-10 items-center rounded px-2.5 py-1.5 text-xs font-medium ${
                preflight?.ok && preflight.summary.exportableAssertions > 0
                  ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                  : 'cursor-not-allowed bg-slate-700 text-slate-500'
              }`}
            >
              下载
            </a>
            <button
              type="button"
              onClick={copyDraft}
              disabled={!draftText}
              className="min-h-10 rounded border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? '已复制' : '复制'}
            </button>
          </div>
        </div>

        {preflight && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
            <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
              scanned <span className="text-slate-200">{preflight.summary.assertionsScanned}</span>
            </div>
            <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
              exportable <span className="text-emerald-300">{preflight.summary.exportableAssertions}</span>
            </div>
            <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
              blockers <span className="text-red-300">{preflight.summary.blockers}</span>
            </div>
            <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
              duplicates <span className="text-amber-300">{preflight.summary.duplicateCandidates}</span>
            </div>
            <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
              ledger balances <span className="text-slate-200">{preflight.ledger.balances}</span>
            </div>
          </div>
        )}

        {preflightError && (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {preflightError}
          </div>
        )}
        {draftError && (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {draftError}
          </div>
        )}
        {preflight && (
          <>
            <IssueList title="Blockers" issues={preflight.blockers} />
            <IssueList title="Duplicate Candidates" issues={preflight.duplicateCandidates} />
          </>
        )}
        {draftText && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
            <div className="border-b border-slate-700 px-3 py-2 text-xs text-slate-400">
              {period}-fintrack-balances.bean
            </div>
            <pre className="max-h-72 overflow-auto p-3 text-xs leading-5 text-slate-200">
              <code>{draftText}</code>
            </pre>
          </div>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-700">
        {assertions.length === 0 ? (
          <div className="bg-slate-900/40 px-3 py-4 text-sm text-slate-500">无 draft balance assertion</div>
        ) : (
          <div className="divide-y divide-slate-700">
            {assertions.map(assertion => (
              <div key={assertion.id} className="grid gap-3 bg-slate-900/30 px-3 py-3 text-xs lg:grid-cols-[120px_minmax(0,1.3fr)_110px_minmax(0,1.1fr)_180px] lg:items-start">
                <div>
                  <p className="text-slate-400">{assertion.assertionDate}</p>
                  <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusClass(assertion.status)}`}>
                    {statusLabel(assertion.status)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-slate-200">{assertion.beancountAccount}</p>
                  <p className="mt-1 truncate text-slate-500">
                    {assertion.fintrackAccountName ?? 'No FinTrack account'}
                  </p>
                  {assertion.note && <p className="mt-1 truncate text-slate-500">{assertion.note}</p>}
                </div>
                <div className="text-right font-semibold tabular-nums text-slate-100">
                  {formatAmount(assertion.amount, assertion.currency)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-slate-500">{assertion.sourceId}</p>
                  <p className="mt-1 truncate font-mono text-slate-400">{renderBalanceDirective(assertion)}</p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {assertion.status === 'draft' && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateAssertionStatus(assertion.id, 'staged')}
                        disabled={updatingStatusId === assertion.id}
                        className="min-h-10 rounded border border-amber-700 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        标记 staged
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAssertionStatus(assertion.id, 'rejected')}
                        disabled={updatingStatusId === assertion.id}
                        className="min-h-10 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </>
                  )}
                  {assertion.status === 'staged' && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateAssertionStatus(assertion.id, 'merged')}
                        disabled={updatingStatusId === assertion.id}
                        className="min-h-10 rounded border border-emerald-700 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        标记 merged
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAssertionStatus(assertion.id, 'draft')}
                        disabled={updatingStatusId === assertion.id}
                        className="min-h-10 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        退回 draft
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAssertionStatus(assertion.id, 'rejected')}
                        disabled={updatingStatusId === assertion.id}
                        className="min-h-10 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </>
                  )}
                  {assertion.status === 'merged' && (
                    <button
                      type="button"
                      onClick={() => updateAssertionStatus(assertion.id, 'staged')}
                      disabled={updatingStatusId === assertion.id}
                      className="min-h-10 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      退回 staged
                    </button>
                  )}
                  {assertion.status === 'rejected' && (
                    <button
                      type="button"
                      onClick={() => updateAssertionStatus(assertion.id, 'draft')}
                      disabled={updatingStatusId === assertion.id}
                      className="min-h-10 rounded border border-blue-700 px-2 py-1.5 text-xs text-blue-200 hover:bg-blue-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      恢复 draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteAssertion(assertion.id)}
                    disabled={deletingId === assertion.id || assertion.status !== 'draft'}
                    className="min-h-10 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === assertion.id ? '删除中' : '删除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
