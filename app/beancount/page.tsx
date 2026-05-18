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
  investmentActivityId?: string
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
  transactionId?: string
  investmentActivityId?: string
  reason: string
  transferMatchId?: number
}

interface PreflightInvestmentActivity {
  id: string
  sourceId: string
  date: string
  description: string
  accountName: string | null
  beancountAccount: string | null
  activityType: string
  instrumentType: string
  positionEffect: string
  sourceSymbol: string | null
  beancountCommodity: string | null
  quantity: string | null
  amount: string | null
  currency: string | null
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
    investmentActivitiesScanned?: number
    exportableInvestmentActivities?: number
  }
  blockers: PreflightIssue[]
  reviewItems: PreflightIssue[]
  duplicateCandidates: PreflightIssue[]
  exportableTransactions: PreflightTransaction[]
  mergedTransfers: PreflightTransfer[]
  exportableInvestmentActivities?: PreflightInvestmentActivity[]
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

function handoffStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'ready_for_approval':
      return '待批准'
    case 'checked':
      return '检查通过'
    case 'merged':
      return '已合并'
    case 'approved':
      return '已批准'
    case 'failed':
      return '失败'
    case 'rejected':
      return '已拒绝'
    case 'checking':
      return '检查中'
    case 'received':
      return '已接收'
    case undefined:
    case null:
    case '':
    case 'no_status':
      return '无状态'
    default:
      return status
  }
}

function handoffDecisionLabel(decision: 'approve' | 'reject'): string {
  return decision === 'approve' ? '批准' : '拒绝'
}

function handoffValidationStatusLabel(status: string): string {
  switch (status) {
    case 'passed':
      return '通过'
    case 'failed':
      return '失败'
    case 'skipped':
      return '已跳过'
    case 'pending':
      return '待处理'
    default:
      return status
  }
}

function handoffFileKindLabel(kind: string): string {
  switch (kind) {
    case 'manifest':
      return '清单'
    case 'transactionDraft':
      return '交易草稿'
    case 'balanceAssertionDraft':
      return '余额断言草稿'
    case 'combinedDraft':
      return '合并草稿'
    default:
      return kind
  }
}

function transferKindLabel(kind: string): string {
  switch (kind) {
    case 'credit_card_payment':
      return '信用卡还款'
    case 'internal':
      return '内部转账'
    case 'wallet':
      return '钱包转账'
    case 'investment':
      return '投资转账'
    case 'other':
      return '其他转账'
    default:
      return kind
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
        <EmptyState>没有项目</EmptyState>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <article key={`${item.code}-${item.transactionId ?? item.investmentActivityId ?? item.transferMatchId ?? index}`} className={`rounded-xl border p-3 ${toneClass}`}>
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 font-mono text-xs text-slate-300">
                      {item.code}
                    </span>
                    <span className="text-xs uppercase text-slate-500">{item.severity === 'blocker' ? '阻塞' : '需审核'}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{item.message}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-1 text-xs md:grid-cols-2">
                <DetailLine label="交易 ID" value={item.transactionId ? <TransactionId id={item.transactionId} /> : undefined} />
                <DetailLine label="投资活动 ID" value={item.investmentActivityId ? <span className="font-mono">{item.investmentActivityId}</span> : undefined} />
                <DetailLine label="转账匹配 ID" value={item.transferMatchId} />
                <DetailLine label="账户" value={item.account} />
                <DetailLine label="Ledger 账户" value={item.category} />
                <DetailLine label="来源 ID" value={item.sourceId ? <span className="font-mono">{item.sourceId}</span> : undefined} />
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
            <DetailLine label="账户" value={txn.beancountAccount ?? '未映射'} />
            <DetailLine label="Ledger 账户" value={txn.category ?? '未分配'} />
            <DetailLine label="来源 ID" value={<span className="font-mono">{txn.sourceId}</span>} />
          </div>
        </div>
        <div className={`text-sm font-semibold tabular-nums ${amount.positive ? 'text-emerald-300' : 'text-red-300'}`}>
          {amount.text}
        </div>
      </div>
    </article>
  )
}

function InvestmentActivityRow({ activity }: { activity: PreflightInvestmentActivity }) {
  const amount = activity.amount && activity.currency ? formatAmount(activity.amount, activity.currency) : null
  const label = [activity.activityType, activity.instrumentType, activity.positionEffect === 'none' ? '' : activity.positionEffect]
    .filter(Boolean)
    .join(' / ')
  const securityLabel = activity.activityType === 'dividend' || activity.activityType === 'interest'
    ? (activity.beancountCommodity ?? activity.sourceSymbol ?? '不需要')
    : (activity.beancountCommodity ?? activity.sourceSymbol ?? '未映射')

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-800 p-3">
      <div className="grid gap-3 lg:grid-cols-[108px_minmax(0,1fr)_auto] lg:items-start">
        <div className="text-xs text-slate-500">{activity.date}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-blue-300">{activity.id}</span>
            <span className="text-xs text-slate-500">{label}</span>
          </div>
          <p className="mt-1 truncate text-sm font-medium text-slate-100">{activity.description}</p>
          <div className="mt-2 grid gap-1 text-xs md:grid-cols-2">
            <DetailLine label="账户" value={activity.beancountAccount ?? '未映射'} />
            <DetailLine label="证券" value={securityLabel} />
            <DetailLine label="数量" value={activity.quantity ?? '-'} />
            <DetailLine label="来源 ID" value={<span className="font-mono">{activity.sourceId}</span>} />
          </div>
        </div>
        <div className={`text-sm font-semibold tabular-nums ${amount ? (amount.positive ? 'text-emerald-300' : 'text-red-300') : 'text-slate-400'}`}>
          {amount?.text ?? '-'}
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
        <DetailLine label="交易 ID" value={<TransactionId id={txn.id} />} />
        <DetailLine label="日期" value={txn.date} />
        <DetailLine label="账户" value={txn.beancountAccount ?? '未映射'} />
        <DetailLine label="来源 ID" value={<span className="font-mono">{txn.sourceId}</span>} />
      </div>
    </div>
  )
}

function TransferList({ transfers }: { transfers: PreflightTransfer[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">已合并转账</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
          {transfers.length}
        </span>
      </div>
      {transfers.length === 0 ? (
        <EmptyState>没有已合并转账</EmptyState>
      ) : (
        <div className="space-y-2">
          {transfers.map(transfer => (
            <article key={transfer.id} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-blue-950 px-2 py-0.5 text-xs text-blue-300">
                      匹配 {transfer.id}
                    </span>
                    <span className="text-xs text-slate-500">{transferKindLabel(transfer.kind)}</span>
                    <span className="text-xs text-slate-500">{transfer.date}</span>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-slate-400">{transfer.sourceId}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <TransferSide label="流出" txn={transfer.outflow} />
                <TransferSide label="流入" txn={transfer.inflow} />
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
        <h2 className="text-sm font-semibold text-slate-200">已跳过</h2>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
          {skipped.length}
        </span>
      </div>
      {skipped.length === 0 ? (
        <EmptyState>没有跳过的交易</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="divide-y divide-slate-700">
            {skipped.map((item, index) => (
              <div key={`${item.transactionId ?? item.investmentActivityId ?? 'skip'}-${item.transferMatchId ?? index}`} className="grid gap-2 px-3 py-2 text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                <div className="min-w-0">
                  {item.transactionId ? (
                    <>
                      <span className="text-slate-500">交易 ID：</span>
                      <TransactionId id={item.transactionId} />
                    </>
                  ) : (
                    <>
                      <span className="text-slate-500">投资活动 ID：</span>
                      <span className="font-mono text-slate-300">{item.investmentActivityId ?? '-'}</span>
                    </>
                  )}
                </div>
                <div className="min-w-0 break-words text-slate-300">{item.reason}</div>
                <div className="text-slate-500">
                  {item.transferMatchId ? `匹配 ${item.transferMatchId}` : ''}
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
        setError('error' in data ? data.error ?? '预检失败' : '预检失败')
        return
      }
      setResult(data as BeancountPreflightResult)
    } catch {
      setResult(null)
      setError('预检请求失败')
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
          setDraftError(data.error ?? '草稿生成失败')
        } catch {
          setDraftError(text || '草稿生成失败')
        }
        setDraftText(null)
        return
      }
      setDraftText(text)
    } catch {
      setDraftError('草稿请求失败')
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
        setManifestError('error' in data ? data.error ?? '清单生成失败' : '清单生成失败')
        return
      }
      setManifest(data as HandoffManifest)
    } catch {
      setManifest(null)
      setManifestError('清单请求失败')
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
        setHandoffError(data.error ?? '交接写入失败')
        return
      }
      setManifest(data.manifest ?? null)
      setHandoffResult(data as HandoffWriteResult)
      await loadHandoffReviewState()
    } catch {
      setHandoffError('交接请求失败')
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
        setReviewError('error' in data ? data.error ?? '无法读取交接状态' : '无法读取交接状态')
        return
      }
      setReviewState(data as HandoffReviewState)
    } catch {
      setReviewState(null)
      setReviewError('交接状态请求失败')
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
        setReviewError('error' in data ? data.error ?? '审核决定提交失败' : '审核决定提交失败')
        return
      }
      setReviewState(data as HandoffReviewState)
      setDecisionNote('')
    } catch {
      setReviewError('审核请求失败')
    } finally {
      setDecisionLoading(null)
    }
  }

  useEffect(() => {
    loadPreflight()
  }, [loadPreflight])

  const summary = result?.summary
  const visibleTransactions = useMemo(() => result?.exportableTransactions ?? [], [result])
  const visibleInvestmentActivities = useMemo(() => result?.exportableInvestmentActivities ?? [], [result])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-bold">导出中心</h1>
          <p className="mt-1 text-sm text-slate-500">
            {loading ? `正在检查 ${period}` : result ? `${result.dateRange.start} 至 ${result.dateRange.end}` : '选择月份并预检 Beancount 导出准备状态'}
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
              按月
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
              未导出
            </button>
          </div>
          <button
            onClick={loadPreflight}
            disabled={loading}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? '刷新中...' : '刷新'}
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
          <div>{result.ok ? '预检通过，可以生成草稿。' : '预检存在阻塞项，暂时无法生成草稿。'}</div>
          <div className="mt-1 break-all font-mono text-xs text-slate-400">
            暂存目录：{result.proposedStaging}
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-200">交接清单</h2>
              {manifest && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  manifest.ok ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'
                }`}>
                  {manifest.ok ? '就绪' : '阻塞'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              FinTrack 到 Beancount 容器的交接合同预览；不会写入仓库。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadManifestPreview}
              disabled={manifestLoading}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {manifestLoading ? '生成中...' : '预览清单'}
            </button>
            <a
              href={manifestHref}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
            >
              下载 JSON
            </a>
            <button
              onClick={copyManifest}
              disabled={!manifest}
              className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {manifestCopied ? '已复制' : '复制'}
            </button>
            <button
              onClick={writeHandoff}
              disabled={handoffLoading || !result?.ok || manifest?.ok === false}
              className="rounded-md border border-emerald-800 bg-emerald-950/60 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {handoffLoading ? '写入中...' : '写入交接'}
            </button>
            <button
              onClick={loadHandoffReviewState}
              disabled={reviewLoading}
              className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reviewLoading ? '读取中...' : '刷新状态'}
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
            <div className="font-medium">交接已写入</div>
            <div className="mt-1 break-all font-mono text-emerald-100">{handoffResult.directory}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-slate-300">
              <span>外部校验</span>
              <span className={`rounded-full border px-2 py-0.5 ${
                handoffResult.validation.status === 'passed'
                  ? 'border-emerald-900/70 bg-emerald-950/30 text-emerald-300'
                  : handoffResult.validation.status === 'failed'
                    ? 'border-red-900/70 bg-red-950/30 text-red-300'
                    : 'border-amber-900/70 bg-amber-950/30 text-amber-300'
              }`}>
                {handoffValidationStatusLabel(handoffResult.validation.status)}
              </span>
              <span className="font-mono text-slate-500">{handoffResult.validation.command}</span>
            </div>
            <div className="mt-2 grid gap-1 text-slate-400 md:grid-cols-2">
              {handoffResult.files.map(file => (
                <div key={file.kind} className="break-all">
                  <span className="text-slate-500">{handoffFileKindLabel(file.kind)}： </span>
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
                  <span className="font-medium text-slate-200">Beancount 处理器</span>
                  <span className={`rounded-full border px-2 py-0.5 ${handoffStatusClass(reviewState.status?.status)}`}>
                    {handoffStatusLabel(reviewState.status?.status)}
                  </span>
                  {reviewState.status?.ok !== undefined && (
                    <span className={reviewState.status.ok ? 'text-emerald-300' : 'text-red-300'}>
                      {reviewState.status.ok ? '通过' : '未通过'}
                    </span>
                  )}
                </div>
                <div className="mt-1 break-all font-mono text-slate-500">{reviewState.directory}</div>
                {reviewState.status?.message && (
                  <p className="mt-2 text-slate-300">{reviewState.status.message}</p>
                )}
                {reviewState.status?.stagingDir && (
                  <p className="mt-1 break-all text-slate-500">
                    暂存目录：<span className="font-mono">{reviewState.status.stagingDir}</span>
                  </p>
                )}
                {reviewState.status?.checkLog && (
                  <p className="mt-1 break-all text-slate-500">
                    检查日志：<span className="font-mono">{reviewState.status.checkLog}</span>
                  </p>
                )}
                {reviewState.status?.promotedFiles && reviewState.status.promotedFiles.length > 0 && (
                  <div className="mt-2 text-slate-500">
                    已提升：
                    <div className="mt-1 space-y-1">
                      {reviewState.status.promotedFiles.map(file => (
                        <div key={file} className="break-all font-mono text-slate-300">{file}</div>
                      ))}
                    </div>
                  </div>
                )}
                {reviewState.status?.errors && reviewState.status.errors.length > 0 && (
                  <div className="mt-2 rounded border border-red-900/60 bg-red-950/20 px-2 py-2 text-red-200">
                    <div className="font-medium">处理器错误</div>
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
                    已成功写入 Beancount，并通过检查。
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => submitHandoffDecision('approve')}
                  disabled={reviewState.exists.decision || !reviewState.readyForApproval || decisionLoading !== null}
                  className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {decisionLoading === 'approve' ? '提交中...' : '批准交接'}
                </button>
                <button
                  onClick={() => submitHandoffDecision('reject')}
                  disabled={reviewState.exists.decision || !reviewState.canReject || decisionLoading !== null}
                  className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {decisionLoading === 'reject' ? '提交中...' : '拒绝'}
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={decisionNote}
                onChange={event => setDecisionNote(event.target.value)}
                placeholder="审核备注，可选"
                className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
              />
              <div className="grid grid-cols-4 gap-1 text-slate-500">
                <span className={reviewState.exists.manifest ? 'text-emerald-300' : 'text-slate-600'}>清单</span>
                <span className={reviewState.exists.combinedDraft ? 'text-emerald-300' : 'text-slate-600'}>草稿</span>
                <span className={reviewState.exists.status ? 'text-emerald-300' : 'text-slate-600'}>状态</span>
                <span className={reviewState.exists.decision ? 'text-blue-300' : 'text-slate-600'}>决定</span>
              </div>
            </div>
            {reviewState.decision && (
              <div className="mt-2 rounded border border-slate-700 bg-slate-950/70 px-2 py-1 text-slate-400">
                决定：<span className="font-mono text-slate-200">{handoffDecisionLabel(reviewState.decision.decision)}</span>
                <span className="ml-2">{reviewState.decision.requestedAt}</span>
                {reviewState.decision.decision === 'approve'
                  && !['merged', 'failed', 'rejected'].includes(reviewState.status?.status ?? '') && (
                  <span className="ml-2 text-amber-300">等待 Beancount 处理器</span>
                )}
                {reviewState.decision.decision === 'approve' && reviewState.status?.status === 'failed' && (
                  <span className="ml-2 text-red-300">处理器失败</span>
                )}
              </div>
            )}
          </div>
        )}

        {manifest && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                账本 <span className="font-mono text-slate-200">{manifest.ledger.revision}</span>
              </div>
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                交易 <span className="text-emerald-300">{manifest.counts.transactions}</span>
              </div>
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                转账 <span className="text-blue-300">{manifest.counts.transfers}</span>
              </div>
              <div className="rounded bg-slate-950/60 px-2 py-2 text-slate-500">
                余额 <span className="text-amber-300">{manifest.counts.balanceAssertions}</span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
              <div className="rounded bg-slate-900/60 px-3 py-2">
                <span className="text-slate-500">清单： </span>
                <span className="break-all font-mono text-slate-300">{manifest.handoff.manifestFile}</span>
              </div>
              <div className="rounded bg-slate-900/60 px-3 py-2">
                <span className="text-slate-500">草稿： </span>
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
        <div className="py-12 text-center text-slate-500">加载中...</div>
      ) : result ? (
        <>
          <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">草稿</h2>
                <p className="mt-1 text-xs text-slate-500">
                  仅生成内容或下载文件，不会写入 Beancount 仓库。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={loadDraftPreview}
                  disabled={!result.ok || draftLoading}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {draftLoading ? '生成中...' : '预览草稿'}
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
                  下载 .bean
                </a>
                <button
                  onClick={copyDraft}
                  disabled={!draftText}
                  className="rounded-md border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>
            {!result.ok && (
              <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                生成草稿前需先解决 {result.summary.blockers} 个阻塞项。
              </div>
            )}
            {result.ok && result.summary.reviewItems > 0 && (
              <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                仍有 {result.summary.reviewItems} 个 Ledger 准备项目。下载前请先处理。
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
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-9">
              <SummaryCard label="已扫描" value={summary.transactionsScanned} />
              <SummaryCard label="可导出" value={summary.exportableTransactions} tone="emerald" />
              <SummaryCard label="投资" value={summary.exportableInvestmentActivities ?? 0} tone="emerald" />
              <SummaryCard label="已合并" value={summary.mergedTransfers} tone="blue" />
              <SummaryCard label="已跳过" value={summary.skipped} />
              <SummaryCard label="阻塞项" value={summary.blockers} tone="red" />
              <SummaryCard label="准备项" value={summary.reviewItems} tone="amber" />
              <SummaryCard label="重复候选" value={summary.duplicateCandidates} tone="violet" />
              <SummaryCard label="已导出" value={summary.previouslyExported ?? 0} tone="blue" />
            </div>
          )}

          <div className="grid gap-3 text-xs text-slate-400 md:grid-cols-3">
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              Ledger 文件：<span className="text-slate-200">{result.ledger.filesScanned}</span>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              开放账户：<span className="text-slate-200">{result.ledger.openAccounts}</span>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
              来源 ID：<span className="text-slate-200">{result.ledger.sourceIds}</span>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <IssueList title="阻塞项" items={result.blockers} tone="red" />
            <IssueList title="Ledger 准备项目" items={result.reviewItems} tone="amber" />
          </div>

          <IssueList title="重复候选" items={result.duplicateCandidates} tone="violet" />

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200">可导出交易</h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
                {visibleTransactions.length}
              </span>
            </div>
            {visibleTransactions.length === 0 ? (
              <EmptyState>没有可导出的普通交易</EmptyState>
            ) : (
              <div className="space-y-2">
                {visibleTransactions.map(txn => <TransactionRow key={txn.id} txn={txn} />)}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200">可导出投资活动</h2>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs tabular-nums text-slate-400">
                {visibleInvestmentActivities.length}
              </span>
            </div>
            {visibleInvestmentActivities.length === 0 ? (
              <EmptyState>没有可导出的投资活动</EmptyState>
            ) : (
              <div className="space-y-2">
                {visibleInvestmentActivities.map(activity => (
                  <InvestmentActivityRow key={activity.id} activity={activity} />
                ))}
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
