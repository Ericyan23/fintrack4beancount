'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type StagedRow = Record<string, unknown>
type SummaryKey = 'raw' | 'staged' | 'ready' | 'merged' | 'ignored' | 'error' | 'canonical'
type Summary = Record<SummaryKey, number | null>

interface RunInfo {
  id: string
  status: string
  filename: string
  source: string
  created: string
}

interface PromoteNotice {
  promoted: number
  skipped: number
  errors: string[]
}

const SUMMARY_KEYS: SummaryKey[] = ['raw', 'staged', 'ready', 'merged', 'ignored', 'error', 'canonical']
const ELIGIBLE_STATUSES = new Set(['staged', 'ready'])

const SUMMARY_SOURCE_KEYS: Record<SummaryKey, string[]> = {
  raw: ['raw', 'rawRows', 'rawCount', 'rawInserted'],
  staged: ['staged', 'stagedRows', 'stagedCount'],
  ready: ['ready', 'readyRows', 'readyCount'],
  merged: ['merged', 'mergedRows', 'mergedCount'],
  ignored: ['ignored', 'ignoredRows', 'ignoredCount'],
  error: ['error', 'errors', 'errorRows', 'errorCount'],
  canonical: ['canonical', 'canonicalRows', 'canonicalCount'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function getFirst(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function getFirstRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key]
    if (isRecord(value)) return value
  }
  return null
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function responseError(res: Response, payload: unknown, label: string): string {
  if (isRecord(payload)) {
    const message = stringValue(payload.error, payload.message)
    if (message) return message
  }
  return `${label} failed with status ${res.status}`
}

function extractStagedRows(payload: unknown): StagedRow[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []

  for (const key of ['rows', 'staged', 'items', 'transactions']) {
    const value = payload[key]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

function summaryRecords(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) return []

  const records: Record<string, unknown>[] = []
  for (const key of ['summary', 'counts', 'totals']) {
    const value = payload[key]
    if (isRecord(value)) records.push(value)
  }

  for (const key of ['run', 'importRun']) {
    const value = payload[key]
    if (isRecord(value) && isRecord(value.summary)) records.push(value.summary)
  }

  records.push(payload)
  return records
}

function rowStatus(row: StagedRow): string {
  return stringValue(getFirst(row, ['status', 'stageStatus', 'state'])) || 'staged'
}

function normalizeSummary(payloads: unknown[], rows: StagedRow[]): Summary {
  const summary: Summary = {
    raw: null,
    staged: null,
    ready: null,
    merged: null,
    ignored: null,
    error: null,
    canonical: null,
  }
  const records = payloads.flatMap(summaryRecords)

  for (const key of SUMMARY_KEYS) {
    for (const record of records) {
      const sourceKeys = SUMMARY_SOURCE_KEYS[key]
      for (const sourceKey of sourceKeys) {
        const value = record[sourceKey]
        const parsed = key === 'error' && Array.isArray(value) ? value.length : numberValue(value)
        if (parsed !== null) {
          summary[key] = parsed
          break
        }
      }
      if (summary[key] !== null) break
    }
  }

  const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const status = rowStatus(row).toLowerCase()
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})

  if (summary.staged === null) summary.staged = rows.length
  for (const key of ['ready', 'merged', 'ignored', 'error', 'canonical'] satisfies SummaryKey[]) {
    if (summary[key] === null && statusCounts[key] !== undefined) summary[key] = statusCounts[key]
  }

  return summary
}

function normalizeRun(payload: unknown, fallbackId: string): RunInfo {
  const root = isRecord(payload) ? payload : {}
  const source = getFirstRecord(root, ['run', 'importRun']) ?? root

  return {
    id: stringValue(getFirst(source, ['id', 'importRunId', 'runId'])) || fallbackId,
    status: stringValue(getFirst(source, ['status', 'state'])) || 'unknown',
    filename: stringValue(getFirst(source, ['filename', 'fileName', 'originalFilename'])),
    source: stringValue(getFirst(source, ['source', 'sourceName', 'importSource'])),
    created: formatDateTime(getFirst(source, ['createdAt', 'created_at', 'startedAt', 'started_at'])),
  }
}

function formatDateTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    }
    return value.trim()
  }
  return ''
}

function formatPosted(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (typeof value === 'string' && value.trim()) return value.trim()
  return '-'
}

function rowText(row: StagedRow, keys: string[], fallback = '-'): string {
  return stringValue(getFirst(row, keys)) || fallback
}

function rowValidationErrors(row: StagedRow): string {
  const value = getFirst(row, ['validationErrors', 'validation_errors'])
  if (!Array.isArray(value)) return '-'

  const messages = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return messages.length > 0 ? messages.join('; ') : '-'
}

function rowAccount(row: StagedRow): string {
  const account = rowText(row, ['accountName', 'account', 'accountId', 'canonicalAccountName'], '')
  const sourceAccount = rowText(
    row,
    ['sourceAccountName', 'sourceAccount', 'source_account', 'sourceAccountId', 'source_account_id'],
    '',
  )

  if (account && sourceAccount && account !== sourceAccount) return `${account} / ${sourceAccount}`
  return account || sourceAccount || '-'
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'ready') return 'border-emerald-700 bg-emerald-900/30 text-emerald-200'
  if (normalized === 'merged' || normalized === 'canonical') return 'border-blue-700 bg-blue-900/30 text-blue-200'
  if (normalized === 'ignored') return 'border-slate-600 bg-slate-700/50 text-slate-300'
  if (normalized === 'error') return 'border-red-800 bg-red-900/30 text-red-200'
  return 'border-slate-600 bg-slate-700/50 text-slate-300'
}

function rowKey(row: StagedRow, index: number): string {
  return stringValue(getFirst(row, ['id', 'rawItemId', 'raw_item_id', 'externalId', 'external_id', 'rowNumber'])) || `row-${index}`
}

function collectErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map(item => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''

      const row = stringValue(item.rowNumber, item.row, item.line)
      const stagedTransactionId = stringValue(item.stagedTransactionId, item.staged_transaction_id)
      const message = stringValue(item.error, item.message, item.reason) || 'Error'
      if (row) return `Row ${row}: ${message}`
      return stagedTransactionId ? `Staged ${stagedTransactionId}: ${message}` : message
    })
    .filter(Boolean)
}

function promoteNotice(payload: unknown): PromoteNotice {
  const record = isRecord(payload) ? payload : {}
  return {
    promoted: numberValue(getFirst(record, ['promoted', 'promotedCount'])) ?? 0,
    skipped: numberValue(getFirst(record, ['skipped', 'skippedCount'])) ?? 0,
    errors: collectErrors(getFirst(record, ['errors', 'errorRows'])),
  }
}

export default function ImportRunPage() {
  const params = useParams<Record<string, string | string[]>>()
  const idParam = params.id
  const runId = Array.isArray(idParam) ? idParam[0] : idParam

  const [runInfo, setRunInfo] = useState<RunInfo | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<StagedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<PromoteNotice | null>(null)

  const loadRun = useCallback(async (initial = false) => {
    if (!runId) {
      setError('Missing import run id')
      setLoading(false)
      return
    }

    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const [runRes, stagedRes] = await Promise.all([
        fetch(`/api/import/runs/${encodeURIComponent(runId)}`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/staged`),
      ])
      const [runPayload, stagedPayload] = await Promise.all([readJson(runRes), readJson(stagedRes)])

      if (!runRes.ok) {
        setError(responseError(runRes, runPayload, 'Import run summary'))
        return
      }
      if (!stagedRes.ok) {
        setError(responseError(stagedRes, stagedPayload, 'Staged rows'))
        return
      }

      const nextRows = extractStagedRows(stagedPayload)
      setRunInfo(normalizeRun(runPayload, runId))
      setRows(nextRows)
      setSummary(normalizeSummary([runPayload, stagedPayload], nextRows))
    } catch {
      setError('Unable to load staged import review data')
    } finally {
      if (initial) setLoading(false)
      setRefreshing(false)
    }
  }, [runId])

  useEffect(() => {
    loadRun(true)
  }, [loadRun])

  const eligibleCount = useMemo(() => {
    if (summary && (summary.staged !== null || summary.ready !== null)) {
      return (summary.staged ?? 0) + (summary.ready ?? 0)
    }
    return rows.filter(row => ELIGIBLE_STATUSES.has(rowStatus(row).toLowerCase())).length
  }, [rows, summary])

  async function promoteRun() {
    if (!runId) return

    setPromoting(true)
    setError(null)
    setNotice(null)

    try {
      const res = await fetch(`/api/import/runs/${encodeURIComponent(runId)}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = await readJson(res)

      if (!res.ok) {
        setError(responseError(res, payload, 'Promote'))
        return
      }

      setNotice(promoteNotice(payload))
      await loadRun(false)
    } catch {
      setError('Unable to promote staged rows')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Staged CSV Review</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review staged rows before promoting eligible transactions for Beancount preparation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/import"
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Back to import
          </Link>
          <button
            onClick={() => loadRun(false)}
            disabled={loading || refreshing || promoting}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-md border border-emerald-800 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200">
          Promoted {notice.promoted}, skipped {notice.skipped}, {notice.errors.length} errors.
          {notice.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-100">
              {notice.errors.slice(0, 5).map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
        {loading ? (
          <p className="text-sm text-slate-500">Loading import run...</p>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase text-slate-500">Run</span>
                <span className="font-mono text-sm text-slate-300">{runInfo?.id ?? runId}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(runInfo?.status ?? 'unknown')}`}>
                  {runInfo?.status ?? 'unknown'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {runInfo?.filename && <span>File: {runInfo.filename}</span>}
                {runInfo?.source && <span>Source: {runInfo.source}</span>}
                {runInfo?.created && <span>Created: {runInfo.created}</span>}
              </div>
            </div>
            <button
              onClick={promoteRun}
              disabled={loading || refreshing || promoting || !runId || eligibleCount === 0}
              className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60 md:self-auto"
            >
              {promoting ? 'Promoting...' : `Promote eligible rows${eligibleCount ? ` (${eligibleCount})` : ''}`}
            </button>
          </div>
        )}
      </section>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {SUMMARY_KEYS.map(key => (
            <div key={key} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs capitalize text-slate-400">{key}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-100">
                {summary[key] ?? '-'}
              </p>
            </div>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
        <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-300">Staged rows</h2>
          <span className="text-xs text-slate-500">{rows.length} rows</span>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Loading staged rows...</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No staged rows returned for this import run.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1200px]">
              <div className="grid grid-cols-[110px_120px_120px_minmax(220px,1fr)_minmax(180px,1fr)_160px_minmax(180px,1fr)_minmax(180px,1fr)] gap-3 border-b border-slate-700 px-4 py-2 text-xs text-slate-500">
                <span>Status</span>
                <span>Posted</span>
                <span>Amount</span>
                <span>Description</span>
                <span>Account / source account</span>
                <span>Category</span>
                <span>Notes</span>
                <span>Validation</span>
              </div>
              {rows.map((row, index) => {
                const status = rowStatus(row)
                return (
                  <div
                    key={rowKey(row, index)}
                    className="grid grid-cols-[110px_120px_120px_minmax(220px,1fr)_minmax(180px,1fr)_160px_minmax(180px,1fr)_minmax(180px,1fr)] gap-3 border-b border-slate-700 px-4 py-2 text-sm last:border-b-0"
                  >
                    <span>
                      <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}>
                        <span className="truncate">{status}</span>
                      </span>
                    </span>
                    <span className="text-slate-300">
                      {formatPosted(getFirst(row, ['posted', 'postedAt', 'posted_at', 'date']))}
                    </span>
                    <span className="tabular-nums text-slate-100">
                      {rowText(row, ['amount', 'amountText', 'normalizedAmount'])}
                    </span>
                    <span className="truncate text-slate-300">
                      {rowText(row, ['description', 'name', 'memo'])}
                    </span>
                    <span className="truncate text-slate-400">{rowAccount(row)}</span>
                    <span className="truncate text-slate-300">
                      {rowText(row, ['category', 'suggestedCategory', 'canonicalCategory'])}
                    </span>
                    <span className="truncate text-slate-400">
                      {rowText(row, ['notes', 'note', 'memo'])}
                    </span>
                    <span className="truncate text-red-200">
                      {rowValidationErrors(row)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
