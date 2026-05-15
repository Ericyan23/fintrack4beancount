'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import BalanceAssertionPanel from '@/components/BalanceAssertionPanel'

type PreflightSeverity = 'blocker' | 'review'

interface PreflightIssue {
  severity: PreflightSeverity
  code: string
  message: string
  transactionId?: string
  transferMatchId?: number
  account?: string | null
  category?: string | null
  sourceId?: string
}

interface PreflightTransaction {
  id: string
  sourceId: string
  date: string
  description: string
  amount: string
  accountId: string
  accountName: string
  beancountAccount: string | null
  category: string | null
  currency: string
}

interface PreflightTransfer {
  id: number
  sourceId: string
  date: string
  kind: string
  outflow: PreflightTransaction
  inflow: PreflightTransaction
}

interface PreflightSkipped {
  transactionId: string
  reason: string
  transferMatchId?: number
}

interface BeancountPreflightResult {
  ok: boolean
  period: string
  dateRange: { start: string; end: string }
  beancountRoot: string
  ledger: {
    filesScanned: number
    openAccounts: number
    sourceIds: number
  }
  proposedStaging: string
  summary: {
    transactionsScanned: number
    exportableTransactions: number
    mergedTransfers: number
    skipped: number
    blockers: number
    reviewItems: number
    duplicateCandidates: number
    previouslyExported?: number
  }
  blockers: PreflightIssue[]
  reviewItems: PreflightIssue[]
  duplicateCandidates: PreflightIssue[]
  exportableTransactions: PreflightTransaction[]
  mergedTransfers: PreflightTransfer[]
  skipped: PreflightSkipped[]
}

interface ApiError {
  error?: string
}

interface HandoffManifest {
  schemaVersion: 1
  source: 'fintrack'
  period: string
  generatedAt: string
  ok: boolean
  beancountRoot: string
  ledger: {
    revision: string
    filesScanned: number
    openAccounts: number
    sourceIds: number
    balances: number
  }
  handoff: {
    directory: string
    manifestFile: string
    combinedDraftFile: string
    transactionDraftFile: string
    balanceAssertionDraftFile: string
  }
  counts: {
    transactions: number
    transfers: number
    balanceAssertions: number
    skipped: number
    transactionBlockers: number
    balanceAssertionBlockers: number
    reviewItems: number
    duplicateCandidates: number
  }
  preflight: {
    transactionsOk: boolean
    balanceAssertionsOk: boolean
  }
  validation: HandoffValidationSummary | null
  sourceIds: string[]
}

interface HandoffValidationSummary {
  ok: boolean
  status: string
  mode: string
  command: string
  args: string[]
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  error: string | null
  durationMs: number
}

interface HandoffWrittenFile {
  kind: string
  relativePath: string
  absolutePath: string
  bytes: number
}

interface HandoffWriteResult {
  ok: true
  period: string
  handoffRoot: string
  directory: string
  manifest: HandoffManifest
  files: HandoffWrittenFile[]
  resetFiles?: string[]
  validation: HandoffValidationSummary
}

interface HandoffWorkerStatus {
  status: string
  ok?: boolean
  message?: string
  updatedAt?: string
  stagingDir?: string
  checkLog?: string
  commit?: string
  errors?: string[]
  promotedFiles?: string[]
}

interface HandoffDecision {
  decision: 'approve' | 'reject'
  note: string | null
  requestedAt: string
  requestedBy: string
}

interface HandoffReviewState {
  period: string
  handoffRoot: string
  directory: string
  exists: {
    manifest: boolean
    combinedDraft: boolean
    status: boolean
    decision: boolean
  }
  status: HandoffWorkerStatus | null
  decision: HandoffDecision | null
  readyForApproval: boolean
  canReject: boolean
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function handoffStatusClass(status: string | null | undefined): string {
  switch (status) {
    case 'ready_for_approval':
    case 'checked':
      return 'border-emerald-900/70 bg-emerald-950/30 text-emerald-300'
    case 'merged':
    case 'approved':
      return 'border-blue-900/70 bg-blue-950/30 text-blue-300'
    case 'failed':
    case 'rejected':
      return 'border-red-900/70 bg-red-950/30 text-red-300'
    case 'checking':
    case 'received':
      return 'border-amber-900/70 bg-amber-950/30 text-amber-300'
    default:
      return 'border-slate-700 bg-slate-900 text-slate-400'
  }
}

function formatAmount(amount: string, currency: string): { text: string; positive: boolean } {
  const value = Number.parseFloat(amount)
  const positive = value > 0
  if (!Number.isFinite(value)) return { text: `${amount} ${currency}`, positive: false }

  try {
    const text = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(Math.abs(value))
    return { text: `${positive ? '+' : '-'}${text}`, positive }
  } catch {
    return { text: `${positive ? '+' : '-'}${Math.abs(value).toFixed(2)} ${currency}`, positive }
  }
}

function transactionHref(transactionId: string): string {
  return `/transactions/${encodeURIComponent(transactionId)}`
}

function TransactionId({ id }: { id: string }) {
  return (
    <Link href={transactionHref(id)} className="font-mono text-blue-300 hover:text-blue-200 hover:underline">
      {id}
    </Link>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-4 text-sm text-slate-500">
      {children}
    </div>
  )
}

function SummaryCard({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'red' | 'amber' | 'blue' | 'emerald' | 'violet' }) {
  const toneClass = {
    slate: 'text-slate-100',
    red: 'text-red-300',
    amber: 'text-amber-300',
    blue: 'text-blue-300',
    emerald: 'text-emerald-300',
    violet: 'text-violet-300',
  }[tone]

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

function DetailLine({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="min-w-0">
      <span className="text-slate-500">{label}: </span>
      <span className="break-words text-slate-300">{value}</span>
    </div>
  )
}

function IssueList({ title, items, tone }: { title: string; items: PreflightIssue[]; tone: 'red' | 'amber' | 'violet' }) {
  const toneClass = {
    red: 'border-red-900/70 bg-red-950/20',
    amber: 'border-amber-900/70 bg-amber-950/20',
    violet: 'border-violet-900/70 bg-violet-950/20',
  }[tone]

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState>No items</EmptyState>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <article key={`${item.code}-${item.transactionId ?? item.transferMatchId ?? index}`} className={`rounded-xl border p-3 ${toneClass}`}>
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 font-mono text-xs text-slate-300">
                      {item.code}
                    </span>
                    <span className="text-xs uppercase text-slate-500">{item.severity}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{item.message}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-1 text-xs md:grid-cols-2">
                <DetailLine label="transactionId" value={item.transactionId ? <TransactionId id={item.transactionId} /> : undefined} />
                <DetailLine label="transferMatchId" value={item.transferMatchId} />
                <DetailLine label="account" value={item.account} />
                <DetailLine label="ledger account" value={item.category} />
                <DetailLine label="sourceId" value={item.sourceId ? <span className="font-mono">{item.sourceId}</span> : undefined} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function TransactionRow({ txn }: { txn: PreflightTransaction }) {
  const amount = formatAmount(txn.amount, txn.currency)

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-800 p-3">
      <div className="grid gap-3 lg:grid-cols-[108px_minmax(0,1fr)_auto] lg:items-start">
        <div className="text-xs text-slate-500">{txn.date}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TransactionId id={txn.id} />
            <span className="text-xs text-slate-500">{txn.accountName}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-100">{txn.description}</p>
          <div className="mt-2 grid gap-1 text-xs md:grid-cols-2">
            <DetailLine label="account" value={txn.beancountAccount ?? 'Unmapped'} />
            <DetailLine label="ledger account" value={txn.category ?? 'Unassigned'} />
            <DetailLine label="sourceId" value={<span className="font-mono">{txn.sourceId}</span>} />
          </div>
        </div>
        <div className={`text-sm font-semibold tabular-nums ${amount.positive ? 'text-emerald-300' : 'text-red-300'}`}>
          {amount.text}
        </div>
      </div>
    </article>
  )
}

function TransferSide({ label, txn }: { label: string; txn: PreflightTransaction }) {
  const amount = formatAmount(txn.amount, txn.currency)

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className={`text-xs font-semibold tabular-nums ${amount.positive ? 'text-emerald-300' : 'text-red-300'}`}>
          {amount.text}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs">
        <DetailLine label="transactionId" value={<TransactionId id={txn.id} />} />
        <DetailLine label="date" value={txn.date} />
        <DetailLine label="account" value={txn.beancountAccount ?? 'Unmapped'} />
        <DetailLine label="sourceId" value={<span className="font-mono">{txn.sourceId}</span>} />
      </div>
    </div>
  )
}

function TransferList({ transfers }: { transfers: PreflightTransfer[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Merged Transfers</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
          {transfers.length}
        </span>
      </div>
      {transfers.length === 0 ? (
        <EmptyState>No merged transfers</EmptyState>
      ) : (
        <div className="space-y-2">
          {transfers.map(transfer => (
            <article key={transfer.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-blue-950 px-2 py-0.5 text-xs text-blue-300">
                      match {transfer.id}
                    </span>
                    <span className="text-xs text-slate-500">{transfer.kind}</span>
                    <span className="text-xs text-slate-500">{transfer.date}</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-slate-400">{transfer.sourceId}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <TransferSide label="Outflow" txn={transfer.outflow} />
                <TransferSide label="Inflow" txn={transfer.inflow} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function SkippedList({ skipped }: { skipped: PreflightSkipped[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Skipped</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
          {skipped.length}
        </span>
      </div>
      {skipped.length === 0 ? (
        <EmptyState>No skipped transactions</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="divide-y divide-slate-700">
            {skipped.map((item, index) => (
              <div key={`${item.transactionId}-${item.transferMatchId ?? index}`} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                <div className="min-w-0">
                  <span className="text-slate-500">transactionId: </span>
                  <TransactionId id={item.transactionId} />
                </div>
                <div className="min-w-0 break-words text-slate-300">{item.reason}</div>
                <div className="text-slate-500">
                  {item.transferMatchId ? `match ${item.transferMatchId}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export default function BeancountPage() {
  const [period, setPeriod] = useState(currentMonth)
  const [excludeExported, setExcludeExported] = useState(false)
  const [result, setResult] = useState<BeancountPreflightResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [manifest, setManifest] = useState<HandoffManifest | null>(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [manifestCopied, setManifestCopied] = useState(false)
  const [handoffLoading, setHandoffLoading] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [handoffResult, setHandoffResult] = useState<HandoffWriteResult | null>(null)
  const [reviewState, setReviewState] = useState<HandoffReviewState | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [decisionLoading, setDecisionLoading] = useState<'approve' | 'reject' | null>(null)
  const [decisionNote, setDecisionNote] = useState('')

  const exportQuery = excludeExported ? '&excludeExported=1' : ''
  const draftHref = `/api/export/beancount/draft?period=${encodeURIComponent(period)}${exportQuery}`
  const manifestHref = `/api/export/beancount/handoff-manifest?period=${encodeURIComponent(period)}${exportQuery}`
  const handoffStatusHref = `/api/export/beancount/handoff/status?period=${encodeURIComponent(period)}`

  const loadPreflight = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setDraftText(null)
    setDraftError(null)
    setCopied(false)
    setManifest(null)
    setManifestError(null)
    setManifestCopied(false)
    setHandoffError(null)
    setHandoffResult(null)
    setReviewState(null)
    setReviewError(null)
    try {
      const res = await fetch(`/api/export/beancount/preflight?period=${encodeURIComponent(period)}${exportQuery}`)
      const data = (await res.json()) as BeancountPreflightResult | ApiError
      if (!res.ok) {
        setResult(null)
        setError('error' in data ? data.error ?? 'Preflight failed' : 'Preflight failed')
        return
      }
      setResult(data as BeancountPreflightResult)
    } catch {
      setResult(null)
      setError('Preflight request failed')
    } finally {
      setLoading(false)
    }
  }, [period, exportQuery])

  async function loadDraftPreview() {
    setDraftLoading(true)
    setDraftError(null)
    setCopied(false)
    try {
      const res = await fetch(draftHref)
      const text = await res.text()
      if (!res.ok) {
        try {
          const data = JSON.parse(text) as ApiError
          setDraftError(data.error ?? 'Draft generation failed')
        } catch {
          setDraftError(text || 'Draft generation failed')
        }
        setDraftText(null)
        return
      }
      setDraftText(text)
    } catch {
      setDraftError('Draft request failed')
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

  async function loadManifestPreview() {
    setManifestLoading(true)
    setManifestError(null)
    setManifestCopied(false)
    try {
      const res = await fetch(manifestHref)
      const data = (await res.json().catch(() => ({}))) as HandoffManifest | ApiError
      if (!res.ok || !('schemaVersion' in data)) {
        setManifest(null)
        setManifestError('error' in data ? data.error ?? 'Manifest generation failed' : 'Manifest generation failed')
        return
      }
      setManifest(data as HandoffManifest)
    } catch {
      setManifest(null)
      setManifestError('Manifest request failed')
    } finally {
      setManifestLoading(false)
    }
  }

  async function copyManifest() {
    if (!manifest) return
    await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2))
    setManifestCopied(true)
    setTimeout(() => setManifestCopied(false), 2500)
  }

  async function writeHandoff() {
    setHandoffLoading(true)
    setHandoffError(null)
    setHandoffResult(null)
    try {
      const res = await fetch('/api/export/beancount/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, overwrite: true, excludeExported }),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<HandoffWriteResult> & {
        error?: string
        manifest?: HandoffManifest
      }
      if (!res.ok || data.ok !== true) {
        if (data.manifest) setManifest(data.manifest)
        setHandoffError(data.error ?? 'Handoff write failed')
        return
      }
      setManifest(data.manifest ?? null)
      setHandoffResult(data as HandoffWriteResult)
      await loadHandoffReviewState()
    } catch {
      setHandoffError('Handoff request failed')
    } finally {
      setHandoffLoading(false)
    }
  }

  async function loadHandoffReviewState() {
    setReviewLoading(true)
    setReviewError(null)
    try {
      const res = await fetch(handoffStatusHref)
      const data = (await res.json().catch(() => ({}))) as HandoffReviewState | ApiError
      if (!res.ok || !('exists' in data)) {
        setReviewState(null)
        setReviewError('error' in data ? data.error ?? 'Failed to read handoff status' : 'Failed to read handoff status')
        return
      }
      setReviewState(data as HandoffReviewState)
    } catch {
      setReviewState(null)
      setReviewError('Handoff status request failed')
    } finally {
      setReviewLoading(false)
    }
  }

  async function submitHandoffDecision(decision: 'approve' | 'reject') {
    setDecisionLoading(decision)
    setReviewError(null)
    try {
      const res = await fetch('/api/export/beancount/handoff/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          decision,
          note: decisionNote || null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as HandoffReviewState | ApiError
      if (!res.ok || !('exists' in data)) {
        setReviewError('error' in data ? data.error ?? 'Review decision failed' : 'Review decision failed')
        return
      }
      setReviewState(data as HandoffReviewState)
      setDecisionNote('')
    } catch {
      setReviewError('Review request failed')
    } finally {
      setDecisionLoading(null)
    }
  }

  useEffect(() => {
    loadPreflight()
  }, [loadPreflight])

  const summary = result?.summary
  const visibleTransactions = useMemo(() => result?.exportableTransactions ?? [], [result])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Export Center</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? `Checking ${period}` : result ? `${result.dateRange.start} to ${result.dateRange.end}` : 'Select a month to preflight Beancount export readiness'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={event => {
              setPeriod(event.target.value)
              setResult(null)
              setDraftText(null)
              setDraftError(null)
              setManifest(null)
              setManifestError(null)
              setManifestCopied(false)
              setHandoffError(null)
              setHandoffResult(null)
              setReviewState(null)
              setReviewError(null)
              setDecisionNote('')
            }}
            className="rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-100"
          />
          <div className="inline-flex rounded-md border border-slate-700 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => {
                setExcludeExported(false)
                setResult(null)
                setDraftText(null)
                setDraftError(null)
                setManifest(null)
                setManifestError(null)
                setManifestCopied(false)
                setHandoffError(null)
                setHandoffResult(null)
                setReviewState(null)
                setReviewError(null)
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                excludeExported ? 'text-slate-400 hover:text-slate-200' : 'bg-slate-700 text-slate-100'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => {
                setExcludeExported(true)
                setResult(null)
                setDraftText(null)
                setDraftError(null)
                setManifest(null)
                setManifestError(null)
                setManifestCopied(false)
                setHandoffError(null)
                setHandoffResult(null)
                setReviewState(null)
                setReviewError(null)
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                excludeExported ? 'bg-blue-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Not exported
            </button>
          </div>
          <button
            onClick={loadPreflight}
            disabled={loading}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${
          result.ok
            ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
            : 'border-red-800 bg-red-950/30 text-red-300'
        }`}>
          <div>{result.ok ? 'Preflight passed. You can generate a draft.' : 'Preflight has blockers, so a draft cannot be generated.'}</div>
          <div className="mt-1 break-all font-mono text-xs text-slate-400">
            staging: {result.proposedStaging}
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-200">Handoff Manifest</h2>
              {manifest && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  manifest.ok ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'
                }`}>
                  {manifest.ok ? 'ready' : 'blocked'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              FinTrack to Beancount container contract preview; does not write to the repo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadManifestPreview}
              disabled={manifestLoading}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {manifestLoading ? 'Generating...' : 'Preview manifest'}
            </button>
            <a
              href={manifestHref}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
            >
              Download JSON
            </a>
            <button
              onClick={copyManifest}
              disabled={!manifest}
              className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {manifestCopied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={writeHandoff}
              disabled={handoffLoading || !result?.ok || manifest?.ok === false}
              className="rounded-md border border-emerald-800 bg-emerald-950/60 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {handoffLoading ? 'Writing...' : 'Write handoff'}
            </button>
            <button
              onClick={loadHandoffReviewState}
              disabled={reviewLoading}
              className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reviewLoading ? 'Reading...' : 'Refresh status'}
            </button>
          </div>
        </div>

        {manifestError && (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {manifestError}
          </div>
        )}

        {handoffError && (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {handoffError}
          </div>
        )}

        {handoffResult && (
          <div className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-200">
            <div className="font-medium">Handoff written</div>
            <div className="mt-1 break-all font-mono text-emerald-100">{handoffResult.directory}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-slate-300">
              <span>External validation</span>
              <span className={`rounded-full border px-2 py-0.5 ${
                handoffResult.validation.status === 'passed'
                  ? 'border-emerald-900/70 bg-emerald-950/30 text-emerald-300'
                  : handoffResult.validation.status === 'failed'
                    ? 'border-red-900/70 bg-red-950/30 text-red-300'
                    : 'border-amber-900/70 bg-amber-950/30 text-amber-300'
              }`}>
                {handoffResult.validation.status}
              </span>
              <span className="font-mono text-slate-500">{handoffResult.validation.command}</span>
            </div>
            <div className="mt-2 grid gap-1 text-slate-400 md:grid-cols-2">
              {handoffResult.files.map(file => (
                <div key={file.kind} className="break-all">
                  <span className="text-slate-500">{file.kind}: </span>
                  <span className="font-mono">{file.relativePath}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {reviewError && (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
            {reviewError}
          </div>
        )}

        {reviewState && (
          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-3 text-xs">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-200">Beancount worker</span>
                  <span className={`rounded-full border px-2 py-0.5 ${handoffStatusClass(reviewState.status?.status)}`}>
                    {reviewState.status?.status ?? 'no_status'}
                  </span>
                  {reviewState.status?.ok !== undefined && (
                    <span className={reviewState.status.ok ? 'text-emerald-300' : 'text-red-300'}>
                      {reviewState.status.ok ? 'ok' : 'not ok'}
                    </span>
                  )}
                </div>
                <div className="mt-1 break-all font-mono text-slate-500">{reviewState.directory}</div>
                {reviewState.status?.message && (
                  <p className="mt-2 text-slate-300">{reviewState.status.message}</p>
                )}
                {reviewState.status?.stagingDir && (
                  <p className="mt-1 break-all text-slate-500">
                    staging: <span className="font-mono">{reviewState.status.stagingDir}</span>
                  </p>
                )}
                {reviewState.status?.checkLog && (
                  <p className="mt-1 break-all text-slate-500">
                    check log: <span className="font-mono">{reviewState.status.checkLog}</span>
                  </p>
                )}
                {reviewState.status?.promotedFiles && reviewState.status.promotedFiles.length > 0 && (
                  <div className="mt-2 text-slate-500">
                    promoted:
                    <div className="mt-1 space-y-1">
                      {reviewState.status.promotedFiles.map(file => (
                        <div key={file} className="break-all font-mono text-slate-300">{file}</div>
                      ))}
                    </div>
                  </div>
                )}
                {reviewState.status?.errors && reviewState.status.errors.length > 0 && (
                  <div className="mt-2 rounded border border-red-900/60 bg-red-950/20 px-2 py-2 text-red-200">
                    <div className="font-medium">worker errors</div>
                    <div className="mt-1 space-y-1">
                      {reviewState.status.errors.map((item, index) => (
                        <div key={`${index}-${item}`} className="break-all font-mono text-[11px] text-red-100">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {reviewState.status?.status === 'merged' && (
                  <p className="mt-2 text-amber-300">
                    Successfully written to Beancount and passed checks.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => submitHandoffDecision('approve')}
                  disabled={reviewState.exists.decision || !reviewState.readyForApproval || decisionLoading !== null}
                  className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {decisionLoading === 'approve' ? 'Submitting...' : 'Approve handoff'}
                </button>
                <button
                  onClick={() => submitHandoffDecision('reject')}
                  disabled={reviewState.exists.decision || !reviewState.canReject || decisionLoading !== null}
                  className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {decisionLoading === 'reject' ? 'Submitting...' : 'Reject'}
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={decisionNote}
                onChange={event => setDecisionNote(event.target.value)}
                placeholder="Review note, optional"
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <div className="grid grid-cols-4 gap-1 text-slate-500">
                <span className={reviewState.exists.manifest ? 'text-emerald-300' : 'text-slate-600'}>manifest</span>
                <span className={reviewState.exists.combinedDraft ? 'text-emerald-300' : 'text-slate-600'}>draft</span>
                <span className={reviewState.exists.status ? 'text-emerald-300' : 'text-slate-600'}>status</span>
                <span className={reviewState.exists.decision ? 'text-blue-300' : 'text-slate-600'}>decision</span>
              </div>
            </div>
            {reviewState.decision && (
              <div className="mt-2 rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-slate-400">
                decision: <span className="font-mono text-slate-200">{reviewState.decision.decision}</span>
                <span className="ml-2">{reviewState.decision.requestedAt}</span>
                {reviewState.decision.decision === 'approve'
                  && !['merged', 'failed', 'rejected'].includes(reviewState.status?.status ?? '') && (
                  <span className="ml-2 text-amber-300">Waiting for Beancount worker</span>
                )}
                {reviewState.decision.decision === 'approve' && reviewState.status?.status === 'failed' && (
                  <span className="ml-2 text-red-300">worker failed</span>
                )}
              </div>
            )}
          </div>
        )}

        {manifest && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                ledger <span className="font-mono text-slate-200">{manifest.ledger.revision}</span>
              </div>
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                transactions <span className="text-emerald-300">{manifest.counts.transactions}</span>
              </div>
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                transfers <span className="text-blue-300">{manifest.counts.transfers}</span>
              </div>
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                balances <span className="text-amber-300">{manifest.counts.balanceAssertions}</span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
              <div className="rounded bg-slate-900/60 px-3 py-2">
                <span className="text-slate-500">manifest: </span>
                <span className="break-all font-mono text-slate-300">{manifest.handoff.manifestFile}</span>
              </div>
              <div className="rounded bg-slate-900/60 px-3 py-2">
                <span className="text-slate-500">draft: </span>
                <span className="break-all font-mono text-slate-300">{manifest.handoff.combinedDraftFile}</span>
              </div>
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
              <div className="border-b border-slate-700 px-3 py-2 text-xs text-slate-400">
                manifest.json
              </div>
              <pre className="max-h-80 overflow-auto p-3 text-xs leading-5 text-slate-200">
                <code>{JSON.stringify(manifest, null, 2)}</code>
              </pre>
            </div>
          </>
        )}
      </section>

      <BalanceAssertionPanel period={period} excludeExported={excludeExported} />

      {loading && !result ? (
        <div className="py-12 text-center text-slate-500">Loading...</div>
      ) : result ? (
        <>
          <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">Draft</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Generate content or download files only. This does not write to the Beancount repo.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={loadDraftPreview}
                  disabled={!result.ok || draftLoading}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {draftLoading ? 'Generating...' : 'Preview draft'}
                </button>
                <a
                  href={result.ok ? draftHref : undefined}
                  aria-disabled={!result.ok}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    result.ok
                      ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                      : 'cursor-not-allowed bg-slate-700 text-slate-500'
                  }`}
                  onClick={event => {
                    if (!result.ok) event.preventDefault()
                  }}
                >
                  Download .bean
                </a>
                <button
                  onClick={copyDraft}
                  disabled={!draftText}
                  className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            {!result.ok && (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                Resolve {result.summary.blockers} blockers before generating a draft.
              </div>
            )}
            {result.ok && result.summary.reviewItems > 0 && (
              <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                {result.summary.reviewItems} ledger prep items remain. Resolve them before downloading.
              </div>
            )}
            {draftError && (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                {draftError}
              </div>
            )}
            {draftText && (
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
                <div className="border-b border-slate-700 px-3 py-2 text-xs text-slate-400">
                  {period}-fintrack.bean
                </div>
                <pre className="max-h-[520px] overflow-auto p-3 text-xs leading-5 text-slate-200">
                  <code>{draftText}</code>
                </pre>
              </div>
            )}
          </section>

          {summary && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-8">
              <SummaryCard label="Scanned" value={summary.transactionsScanned} />
              <SummaryCard label="Exportable" value={summary.exportableTransactions} tone="emerald" />
              <SummaryCard label="Merged" value={summary.mergedTransfers} tone="blue" />
              <SummaryCard label="Skipped" value={summary.skipped} />
              <SummaryCard label="Blockers" value={summary.blockers} tone="red" />
              <SummaryCard label="Prep" value={summary.reviewItems} tone="amber" />
              <SummaryCard label="Duplicates" value={summary.duplicateCandidates} tone="violet" />
              <SummaryCard label="Exported" value={summary.previouslyExported ?? 0} tone="blue" />
            </div>
          )}

          <div className="grid gap-3 text-xs text-slate-400 md:grid-cols-3">
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              Ledger files: <span className="text-slate-200">{result.ledger.filesScanned}</span>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              Open accounts: <span className="text-slate-200">{result.ledger.openAccounts}</span>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              Source IDs: <span className="text-slate-200">{result.ledger.sourceIds}</span>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <IssueList title="Blockers" items={result.blockers} tone="red" />
            <IssueList title="Ledger Prep Items" items={result.reviewItems} tone="amber" />
          </div>

          <IssueList title="Duplicate Candidates" items={result.duplicateCandidates} tone="violet" />

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200">Exportable Transactions</h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
                {visibleTransactions.length}
              </span>
            </div>
            {visibleTransactions.length === 0 ? (
              <EmptyState>No exportable regular transactions</EmptyState>
            ) : (
              <div className="space-y-2">
                {visibleTransactions.map(txn => <TransactionRow key={txn.id} txn={txn} />)}
              </div>
            )}
          </section>

          <TransferList transfers={result.mergedTransfers} />
          <SkippedList skipped={result.skipped} />
        </>
      ) : null}
    </div>
  )
}
