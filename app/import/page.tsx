'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type ImportField =
  | 'date'
  | 'amount'
  | 'description'
  | 'account'
  | 'category'
  | 'notes'
  | 'tags'
  | 'status'
  | 'externalId'

type ImportMapping = Partial<Record<ImportField, string>>

interface AccountInfo {
  id: string
  name: string
}

interface ImportProfileConfig {
  connectionName: string | null
  defaultAccountId: string | null
  defaultLedgerAccount: string | null
  parserProfileId: string | null
}

interface ImportProfile {
  id: string
  name: string
  sourceId: string
  kind: string
  mapping: ImportMapping
  config: ImportProfileConfig
  createdAt: number
  updatedAt: number
}

interface PreviewRow {
  rowNumber: number
  date: string
  amount: string
  description: string
  account: string
  category: string
  status: string
  error?: string
  review?: string
}

interface ParserProfile {
  id: string
  name: string
  sourceName: string
  normalizerVersion: string
  blocksCashPromotion: boolean
}

interface PreviewResult {
  columns: string[]
  mapping: ImportMapping
  parserProfile: ParserProfile | null
  rows: PreviewRow[]
  totalRows: number
  validRows: number
  reviewRows: number
  errorRows: number
}

interface StageImportResult {
  importRunId: string
  reviewUrl: string
  parserProfileId: string | null
  parserProfileName: string | null
  totalRows: number
  rawInserted: number
  staged: number
  duplicates: number
  errors: Array<{ rowNumber: number; error: string }>
}

interface SimpleFinStageResult {
  success: boolean
  importRunId?: string
  error?: string
}

interface RunSummary {
  id: string
  status: string
  itemCount: number
  startedAt: number | null
  error: string | null
  connectionName: string | null
  sourceKind: string | null
  eligibleCount: number
  errorCount: number
  mergedCount: number
}

const FIELD_LABELS: Array<[ImportField, string, boolean]> = [
  ['date', '日期', true],
  ['amount', '金额', true],
  ['description', '描述', true],
  ['account', '账户列', false],
  ['category', 'Ledger 账户', false],
  ['notes', '备注', false],
  ['tags', '标签', false],
  ['status', '状态', false],
  ['externalId', '外部 ID', false],
]

const PARSER_PROFILE_OPTIONS = [
  { id: '', name: '自动识别' },
  { id: 'fidelity-brokerage-csv', name: 'Fidelity Brokerage CSV' },
]

function timeAgo(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function sourceLabel(kind: string | null, name: string | null): string {
  if (name) return name
  if (kind === 'simplefin') return 'SimpleFIN'
  if (kind === 'csv') return 'CSV'
  return kind ?? '未知来源'
}

function runStatusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'running') return '运行中'
  if (status === 'error') return '错误'
  return status || '未知'
}

function runStatusClass(status: string): string {
  if (status === 'completed') return 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
  if (status === 'running') return 'border-blue-800 bg-blue-900/30 text-blue-200'
  if (status === 'error') return 'border-red-800 bg-red-900/30 text-red-200'
  return 'border-slate-700 bg-slate-800 text-slate-400'
}

export default function ImportPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([])
  const [profiles, setProfiles] = useState<ImportProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileName, setProfileName] = useState('')
  const [defaultLedgerAccount, setDefaultLedgerAccount] = useState('')
  const [parserProfileId, setParserProfileId] = useState('')
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('')
  const [defaultAccountId, setDefaultAccountId] = useState('')
  const [csvConnectionName, setCsvConnectionName] = useState('')
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<StageImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [simpleFinLoading, setSimpleFinLoading] = useState(false)
  const previewUsesInvestmentReview = Boolean(preview?.parserProfile?.blocksCashPromotion)
  const stageButtonLabel = previewUsesInvestmentReview ? '暂存供审核' : '暂存导入'
  const stageResultSummary = result
    ? [
        result.parserProfileId
          ? `已归档 ${result.rawInserted} 条原始记录供 ${result.parserProfileName ?? 'investment'} 审核`
          : `已暂存 ${result.staged} 条，归档 ${result.rawInserted} 条原始记录`,
        `跳过 ${result.duplicates} 条重复记录`,
        `${result.errors.length} 条校验提示`,
        `导入批次 ${result.importRunId} 可审核`,
      ].join(', ')
    : ''

  function loadRecentRuns() {
    fetch('/api/import/runs')
      .then(res => res.json())
      .then((payload: { runs?: RunSummary[] }) => setRecentRuns(payload.runs ?? []))
      .catch(() => {})
  }

  function loadProfiles() {
    fetch('/api/import/profiles')
      .then(res => res.json())
      .then((payload: { profiles?: ImportProfile[] }) => setProfiles(payload.profiles ?? []))
      .catch(() => {})
  }

  useEffect(() => {
    fetch('/api/accounts')
      .then(res => res.json())
      .then((payload: { accounts?: AccountInfo[] }) => setAccounts(payload.accounts ?? []))
    loadProfiles()
    loadRecentRuns()
  }, [])

  function applyProfile(profile: ImportProfile) {
    setSelectedProfileId(profile.id)
    setProfileName(profile.name)
    setMapping(profile.mapping ?? {})
    setDefaultAccountId(profile.config.defaultAccountId ?? '')
    setDefaultLedgerAccount(profile.config.defaultLedgerAccount ?? '')
    setParserProfileId(profile.config.parserProfileId ?? '')
    setCsvConnectionName(profile.config.connectionName ?? '')
    setProfileError(null)
    setProfileMessage(null)

    if (csv.trim()) {
      void runPreview(
        profile.mapping ?? {},
        profile.config.defaultAccountId ?? '',
        false,
        profile.config.defaultLedgerAccount ?? '',
        profile.config.parserProfileId ?? '',
      )
    }
  }

  async function saveProfile() {
    setProfileError(null)
    setProfileMessage(null)

    const name = profileName.trim()
    if (!name) {
      setProfileError('请输入 profile 名称')
      return
    }

    try {
      const res = await fetch('/api/import/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: selectedProfileId || undefined,
          name,
          mapping,
          connectionName: csvConnectionName.trim() || null,
          defaultAccountId: defaultAccountId || null,
          defaultLedgerAccount: defaultLedgerAccount || null,
          parserProfileId: parserProfileId || null,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { profile?: ImportProfile; error?: string; validationErrors?: string[] }

      if (!res.ok || !payload.profile) {
        setProfileError(payload.validationErrors?.join(', ') || payload.error || '保存 profile 失败')
        return
      }

      setProfiles(current => {
        const next = current.filter(item => item.id !== payload.profile?.id)
        return [payload.profile!, ...next]
      })
      applyProfile(payload.profile)
      setProfileMessage('Profile 已保存')
    } catch {
      setProfileError('保存 profile 失败')
    }
  }

  async function runPreview(
    nextMapping = mapping,
    nextDefaultAccountId = defaultAccountId,
    clearResult = true,
    nextDefaultLedgerAccount = defaultLedgerAccount,
    nextParserProfileId = parserProfileId,
  ) {
    if (!csv.trim()) return
    setLoading(true)
    setError(null)
    if (clearResult) setResult(null)
    try {
      const res = await fetch('/api/import/transactions/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          mapping: nextMapping,
          defaultAccountId: nextDefaultAccountId || undefined,
          defaultLedgerAccount: nextDefaultLedgerAccount || undefined,
          parserProfileId: nextParserProfileId || undefined,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? '预览失败')
        return
      }
      const payload = (await res.json()) as PreviewResult
      setPreview(payload)
      setMapping(payload.mapping)
      if (!nextParserProfileId && payload.parserProfile) {
        setParserProfileId(payload.parserProfile.id)
      }
    } finally {
      setLoading(false)
    }
  }

  async function stageRows() {
    if (!csv.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/import/transactions/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv,
          mapping,
          defaultAccountId: defaultAccountId || undefined,
          connectionName: csvConnectionName.trim() || undefined,
          importProfileId: selectedProfileId || undefined,
          defaultLedgerAccount: defaultLedgerAccount || undefined,
          parserProfileId: parserProfileId || undefined,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? '暂存失败')
        return
      }
      setResult((await res.json()) as StageImportResult)
      loadRecentRuns()
      await runPreview(mapping, defaultAccountId, false, defaultLedgerAccount, parserProfileId)
    } finally {
      setLoading(false)
    }
  }

  async function stageSimpleFin() {
    setSimpleFinLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/import/simplefin/stage', {
        method: 'POST',
      })
      const payload = (await res.json().catch(() => ({}))) as SimpleFinStageResult
      if (!res.ok || !payload.importRunId) {
        setError(payload.error ?? 'SimpleFIN 暂存失败')
        return
      }
      loadRecentRuns()
      router.push(`/import/runs/${encodeURIComponent(payload.importRunId)}`)
    } finally {
      setSimpleFinLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">导入</h1>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-800 text-red-200 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-800 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200 md:flex-row md:items-center md:justify-between">
          <span>{stageResultSummary}.</span>
          <Link
            href={result.reviewUrl}
            className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 md:self-auto"
          >
            审核暂存记录
          </Link>
        </div>
      )}

      {/* ── Recent import runs ─────────────────────────────────────────── */}
      {recentRuns.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="border-b border-slate-700 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-300">最近导入批次</h2>
          </div>
          <div className="divide-y divide-slate-700">
            {recentRuns.map(run => {
              const hasWork = run.eligibleCount > 0 || run.errorCount > 0
              return (
                <Link
                  key={run.id}
                  href={`/import/runs/${encodeURIComponent(run.id)}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 hover:bg-slate-700/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {sourceLabel(run.sourceKind, run.connectionName)}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${runStatusClass(run.status)}`}>
                        {runStatusLabel(run.status)}
                      </span>
                      {run.error && (
                        <span className="text-[11px] text-red-300 truncate max-w-[180px]">{run.error}</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                      <span>{run.itemCount} 条</span>
                      {run.eligibleCount > 0 && (
                        <span className="text-amber-300">{run.eligibleCount} 条可提升</span>
                      )}
                      {run.errorCount > 0 && (
                        <span className="text-red-400">{run.errorCount} 条错误</span>
                      )}
                      {run.mergedCount > 0 && <span>{run.mergedCount} 条已合并</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-500">{timeAgo(run.startedAt)}</p>
                    {hasWork && (
                      <p className="mt-1 text-[11px] font-medium text-amber-300">审核</p>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">SimpleFIN</p>
            <h2 className="mt-1 text-base font-semibold text-slate-100">暂存最新导入</h2>
            <p className="mt-1 text-sm text-slate-400">将最新交易送入 Ledger Prep。</p>
          </div>
          <button
            onClick={stageSimpleFin}
            disabled={loading || simpleFinLoading}
            className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 md:self-auto"
          >
            {simpleFinLoading ? '暂存中...' : '暂存 SimpleFIN'}
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">CSV profiles</p>
            <h2 className="mt-1 text-base font-semibold text-slate-100">映射 profile</h2>
          </div>
          <button
            onClick={saveProfile}
            disabled={!profileName.trim()}
            className="self-start rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600 disabled:opacity-50 md:self-auto"
          >
            保存 profile
          </button>
        </div>

        {profileError && (
          <div className="rounded-md border border-red-900/70 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {profileError}
          </div>
        )}
        {profileMessage && (
          <div className="rounded-md border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
            {profileMessage}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">已保存 profile</span>
            <select
              value={selectedProfileId}
              onChange={event => {
                const profileId = event.target.value
                if (!profileId) {
                  setSelectedProfileId('')
                  setProfileName('')
                  setParserProfileId('')
                  setProfileError(null)
                  setProfileMessage(null)
                  return
                }
                const profile = profiles.find(item => item.id === profileId)
                if (profile) applyProfile(profile)
              }}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            >
              <option value="">新建 profile</option>
              {profiles.map(profile => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">Profile 名称</span>
            <input
              type="text"
              value={profileName}
              onChange={event => setProfileName(event.target.value)}
              placeholder="例如 Chase checking CSV"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </label>

          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">Parser profile</span>
            <select
              value={parserProfileId}
              onChange={event => {
                setParserProfileId(event.target.value)
                if (csv) runPreview(mapping, defaultAccountId, false, defaultLedgerAccount, event.target.value)
              }}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            >
              {PARSER_PROFILE_OPTIONS.map(option => (
                <option key={option.id || 'auto'} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">默认 Ledger account 提示</span>
            <input
              type="text"
              value={defaultLedgerAccount}
              onChange={event => {
                setDefaultLedgerAccount(event.target.value)
                if (csv) runPreview(mapping, defaultAccountId, false, event.target.value)
              }}
              placeholder="Expenses:Food:Restaurants"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </label>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_220px] gap-3">
          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">CSV 文件</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async e => {
                const file = e.target.files?.[0]
                if (!file) return
                setFilename(file.name)
                const text = await file.text()
                setCsv(text)
                setPreview(null)
                setResult(null)
                if (!selectedProfileId) {
                  setMapping({})
                  setParserProfileId('')
                }
              }}
              className="w-full text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">来源名称 <span className="text-slate-600">（可选）</span></span>
            <input
              type="text"
              value={csvConnectionName}
              onChange={e => setCsvConnectionName(e.target.value)}
              placeholder="例如 Chase Checking"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">默认账户</span>
            <select
              value={defaultAccountId}
              onChange={e => {
                setDefaultAccountId(e.target.value)
                if (csv) runPreview(mapping, e.target.value, false, defaultLedgerAccount)
              }}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            >
              <option value="">使用 CSV 账户列</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 truncate">{filename || '尚未选择文件'}</p>
          <button
            onClick={() => runPreview()}
            disabled={!csv || loading || simpleFinLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md"
          >
            {loading ? '处理中...' : '预览'}
          </button>
        </div>
      </div>

      {preview && (
        <>
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
            {preview.parserProfile && (
              <div className="rounded-md border border-amber-900/70 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                解析 profile：{preview.parserProfile.name}
                {preview.parserProfile.blocksCashPromotion
                  ? '。记录将归档供投资审核，不会进入现金提升流程。'
                  : ''}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <p className="text-xs text-slate-400">总行数</p>
                <p className="text-xl font-bold text-slate-100 mt-1">{preview.totalRows}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">{previewUsesInvestmentReview ? '可现金暂存' : '可暂存'}</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{preview.validRows}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">需审核</p>
                <p className="text-xl font-bold text-amber-300 mt-1">{preview.reviewRows}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">错误</p>
                <p className="text-xl font-bold text-red-400 mt-1">{preview.errorRows}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FIELD_LABELS.map(([field, label, required]) => (
                <label key={field} className="block">
                  <span className="text-xs text-slate-400 block mb-1">
                    {label}{required ? ' *' : ''}
                  </span>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={e => {
                      const next = { ...mapping, [field]: e.target.value || undefined }
                      setMapping(next)
                      runPreview(next)
                    }}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="">不映射</option>
                    {preview.columns.map(column => (
                      <option key={`${field}-${column}`} value={column}>{column}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[70px_110px_100px_1fr_160px_180px_120px] gap-3 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
              <span>行</span>
              <span>日期</span>
              <span>金额</span>
              <span>描述</span>
              <span>账户</span>
              <span>Ledger 账户</span>
              <span>状态</span>
            </div>
            {preview.rows.map(row => (
              <div
                key={row.rowNumber}
                className={`grid grid-cols-[70px_110px_100px_1fr_160px_180px_120px] gap-3 px-4 py-2 text-sm border-b border-slate-700 last:border-b-0 ${
                  row.error ? 'bg-red-950/30' : row.review ? 'bg-amber-950/20' : ''
                }`}
              >
                <span className="text-slate-500">{row.rowNumber}</span>
                <span className="text-slate-300">{row.date}</span>
                <span className="text-slate-100">{row.amount}</span>
                <span className="text-slate-300 truncate">{row.description}</span>
                <span className="text-slate-400 truncate">{row.account}</span>
                <span className="text-slate-400 truncate">{row.category || '-'}</span>
                <span className={row.error ? 'text-red-300' : row.review ? 'text-amber-200' : 'text-slate-400'}>
                  {row.error ?? row.review ?? row.status}
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={stageRows}
              disabled={loading || simpleFinLoading || !mapping.date || !mapping.amount || !mapping.description}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded-md"
            >
              {loading ? '暂存中...' : stageButtonLabel}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
