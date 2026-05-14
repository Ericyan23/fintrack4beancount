'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type StagedRow = Record<string, unknown>
type RowAction = 'save' | 'ignore' | 'delete' | 'restore' | 'cancelPending' | 'keepPending'
type SummaryKey = 'raw' | 'staged' | 'ready' | 'merged' | 'ignored' | 'deleted' | 'error' | 'canonical'
type Summary = Record<SummaryKey, number | null>

interface AccountInfo {
  id: string
  name: string
}

interface EditDraft {
  accountId: string
  posted: string
  amount: string
  description: string
  category: string
  notes: string
  tags: string
  pending: boolean
}

interface RunInfo {
  id: string
  status: string
  filename: string
  source: string
  created: string
}

interface SourceAccountMapping {
  id: string
  externalAccountId: string
  name: string | null
  currency: string | null
  fintrackAccountId: string | null
  fintrackAccountName: string | null
  stagedCount: number
  errorCount: number
}

interface PromoteNotice {
  promoted: number
  skipped: number
  errors: string[]
}

interface ReplayNotice {
  importRunId: string
  reviewUrl: string
  rawReplayed: number
  stagedReplayed: number
}

type RowStatusFilter = 'attention' | 'all' | 'error' | 'staged' | 'ready' | 'merged' | 'ignored' | 'deleted'

const SUMMARY_KEYS: SummaryKey[] = ['raw', 'staged', 'ready', 'merged', 'ignored', 'deleted', 'error', 'canonical']
const ROW_STATUS_FILTERS: Array<[RowStatusFilter, string]> = [
  ['attention', 'Needs attention'],
  ['all', 'All rows'],
  ['error', 'Errors'],
  ['staged', 'Staged'],
  ['ready', 'Ready'],
  ['merged', 'Merged'],
  ['ignored', 'Ignored'],
  ['deleted', 'Deleted'],
]
const ELIGIBLE_STATUSES = new Set(['staged', 'ready'])
const LOCKED_STATUSES = new Set(['merged', 'canonical', 'ignored', 'deleted'])
const RESTORABLE_STATUSES = new Set(['ignored', 'deleted'])

const COMPACT_FIELD_CLASS =
  'h-8 w-full rounded border border-slate-600 bg-slate-900/70 px-2 text-xs text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'

const SUMMARY_SOURCE_KEYS: Record<SummaryKey, string[]> = {
  raw: ['raw', 'rawRows', 'rawCount', 'rawInserted'],
  staged: ['staged', 'stagedRows', 'stagedCount'],
  ready: ['ready', 'readyRows', 'readyCount'],
  merged: ['merged', 'mergedRows', 'mergedCount'],
  ignored: ['ignored', 'ignoredRows', 'ignoredCount'],
  deleted: ['deleted', 'deletedRows', 'deletedCount'],
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

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
  if (typeof value === 'string' && value.trim()) {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'pending'
  }
  return false
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

function extractAccounts(payload: unknown): AccountInfo[] {
  const source = isRecord(payload) && Array.isArray(payload.accounts) ? payload.accounts : Array.isArray(payload) ? payload : []

  return source
    .filter(isRecord)
    .map(account => {
      const id = stringValue(account.id)
      return {
        id,
        name: stringValue(account.name, account.displayName, account.institutionName) || id,
      }
    })
    .filter(account => account.id)
}

function extractSourceAccounts(payload: unknown): SourceAccountMapping[] {
  const source = isRecord(payload) && Array.isArray(payload.sourceAccounts)
    ? payload.sourceAccounts
    : Array.isArray(payload)
      ? payload
      : []

  return source
    .filter(isRecord)
    .map(sourceAccount => {
      const id = stringValue(sourceAccount.id)
      return {
        id,
        externalAccountId: stringValue(sourceAccount.externalAccountId, sourceAccount.external_account_id) || id,
        name: stringValue(sourceAccount.name) || null,
        currency: stringValue(sourceAccount.currency) || null,
        fintrackAccountId: stringValue(sourceAccount.fintrackAccountId, sourceAccount.fintrack_account_id) || null,
        fintrackAccountName: stringValue(sourceAccount.fintrackAccountName, sourceAccount.fintrack_account_name) || null,
        stagedCount: numberValue(sourceAccount.stagedCount ?? sourceAccount.staged_count) ?? 0,
        errorCount: numberValue(sourceAccount.errorCount ?? sourceAccount.error_count) ?? 0,
      }
    })
    .filter(sourceAccount => sourceAccount.id)
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
    deleted: null,
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
  for (const key of ['ready', 'merged', 'ignored', 'deleted', 'error', 'canonical'] satisfies SummaryKey[]) {
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

function utcDateInputValue(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateInputValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return utcDateInputValue(new Date(millis))
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim()
    const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/)
    if (match) return match[0]

    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return utcDateInputValue(new Date(parsed))
  }
  return ''
}

function dateInputToEpochSeconds(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const millis = Date.UTC(year, month - 1, day)
  const date = new Date(millis)

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null
  }

  return Math.floor(millis / 1000)
}

function rowText(row: StagedRow, keys: string[], fallback = '-'): string {
  return stringValue(getFirst(row, keys)) || fallback
}

function rowId(row: StagedRow): string {
  return stringValue(getFirst(row, ['id']))
}

function tagsInputValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map(item => item.trim())
      .join(', ')
  }
  return stringValue(value)
}

function parseTagsInput(value: string): string[] {
  return value
    .split(/[;,]/)
    .map(tag => tag.trim())
    .filter(Boolean)
}

function draftFromRow(row: StagedRow): EditDraft {
  return {
    accountId: stringValue(getFirst(row, ['accountId', 'account_id'])),
    posted: dateInputValue(getFirst(row, ['posted', 'postedAt', 'posted_at', 'date'])),
    amount: stringValue(getFirst(row, ['amount', 'amountText', 'normalizedAmount'])),
    description: rowText(row, ['description', 'name', 'memo'], ''),
    category: rowText(row, ['category', 'suggestedCategory', 'canonicalCategory'], ''),
    notes: rowText(row, ['notes', 'note', 'memo'], ''),
    tags: tagsInputValue(getFirst(row, ['tags', 'tagList'])),
    pending: booleanValue(getFirst(row, ['pending', 'isPending'])),
  }
}

function rowValidationErrors(row: StagedRow): string {
  const value = getFirst(row, ['validationErrors', 'validation_errors'])
  if (!Array.isArray(value)) return '-'

  const messages = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  return messages.length > 0 ? messages.join('; ') : '-'
}

function rowReconciliationStatus(row: StagedRow): string {
  return stringValue(getFirst(row, ['reconciliationStatus', 'reconciliation_status']))
}

function rowReconciliationReason(row: StagedRow): string {
  return stringValue(getFirst(row, ['reconciliationReason', 'reconciliation_reason']))
}

function rowIsExpiredPending(row: StagedRow): boolean {
  return rowReconciliationStatus(row) === 'pending_expired'
}

function rowValidationErrorList(row: StagedRow): string[] {
  const value = getFirst(row, ['validationErrors', 'validation_errors'])
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function rowAccountId(row: StagedRow): string {
  return stringValue(getFirst(row, ['accountId', 'account_id']))
}

function rowSourceAccountId(row: StagedRow): string {
  return stringValue(getFirst(row, ['sourceAccountId', 'source_account_id']))
}

function rowNeedsAccountMapping(row: StagedRow): boolean {
  return Boolean(rowSourceAccountId(row)) && (
    !rowAccountId(row)
    || rowValidationErrorList(row).some(message => message.includes('account_id'))
  )
}

function rowNeedsAttention(row: StagedRow): boolean {
  return rowStatus(row).toLowerCase() === 'error' || rowNeedsAccountMapping(row)
}

function rowPriority(row: StagedRow): number {
  const status = rowStatus(row).toLowerCase()
  if (status === 'error') return 0
  if (rowNeedsAccountMapping(row)) return 1
  if (status === 'ready') return 2
  if (status === 'staged') return 3
  if (status === 'merged') return 4
  if (status === 'ignored' || status === 'deleted') return 5
  return 6
}

function sourceAccountLabel(sourceAccount: SourceAccountMapping): string {
  return sourceAccount.name || sourceAccount.externalAccountId || sourceAccount.id
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

function rowIsLocked(row: StagedRow): boolean {
  return LOCKED_STATUSES.has(rowStatus(row).toLowerCase())
}

function rowIsRestorable(row: StagedRow): boolean {
  return RESTORABLE_STATUSES.has(rowStatus(row).toLowerCase())
}

function rowActionLabel(action: RowAction): string {
  if (action === 'cancelPending') return 'Cancel pending...'
  if (action === 'keepPending') return 'Keep pending...'
  return `${action[0].toUpperCase()}${action.slice(1)}...`
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
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [sourceAccounts, setSourceAccounts] = useState<SourceAccountMapping[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({})
  const [rowActions, setRowActions] = useState<Record<string, RowAction>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [mappingActions, setMappingActions] = useState<Record<string, boolean>>({})
  const [mappingErrors, setMappingErrors] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<RowStatusFilter>('attention')
  const [sourceAccountFilter, setSourceAccountFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<PromoteNotice | null>(null)
  const [replayNotice, setReplayNotice] = useState<ReplayNotice | null>(null)

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    setAccountsError(null)

    try {
      const res = await fetch('/api/accounts')
      const payload = await readJson(res)

      if (!res.ok) {
        setAccountsError(responseError(res, payload, 'Accounts'))
        return
      }

      setAccounts(extractAccounts(payload))
    } catch {
      setAccountsError('Unable to load accounts')
    } finally {
      setAccountsLoading(false)
    }
  }, [])

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
      const [runRes, stagedRes, sourceAccountsRes] = await Promise.all([
        fetch(`/api/import/runs/${encodeURIComponent(runId)}`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/staged`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/source-accounts`),
      ])
      const [runPayload, stagedPayload, sourceAccountsPayload] = await Promise.all([
        readJson(runRes),
        readJson(stagedRes),
        readJson(sourceAccountsRes),
      ])

      if (!runRes.ok) {
        setError(responseError(runRes, runPayload, 'Import run summary'))
        return
      }
      if (!stagedRes.ok) {
        setError(responseError(stagedRes, stagedPayload, 'Staged rows'))
        return
      }
      if (!sourceAccountsRes.ok) {
        setError(responseError(sourceAccountsRes, sourceAccountsPayload, 'Source account mapping'))
        return
      }

      const nextRows = extractStagedRows(stagedPayload)
      setSourceAccounts(extractSourceAccounts(sourceAccountsPayload))
      setRunInfo(normalizeRun(runPayload, runId))
      setRows(nextRows)
      setRowErrors({})
      setMappingErrors({})
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

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    setDrafts(() => {
      const nextDrafts: Record<string, EditDraft> = {}
      rows.forEach((row, index) => {
        nextDrafts[rowKey(row, index)] = draftFromRow(row)
      })
      return nextDrafts
    })
  }, [rows])

  const eligibleCount = useMemo(() => {
    if (summary && (summary.staged !== null || summary.ready !== null)) {
      return (summary.staged ?? 0) + (summary.ready ?? 0)
    }
    return rows.filter(row => ELIGIBLE_STATUSES.has(rowStatus(row).toLowerCase())).length
  }, [rows, summary])

  const unmappedSourceAccounts = useMemo(
    () => sourceAccounts.filter(sourceAccount => !sourceAccount.fintrackAccountId),
    [sourceAccounts],
  )
  const attentionRows = useMemo(() => rows.filter(rowNeedsAttention), [rows])
  const sortedRows = useMemo(() => (
    [...rows].sort((a, b) => {
      const priorityDelta = rowPriority(a) - rowPriority(b)
      if (priorityDelta !== 0) return priorityDelta
      const sourceAccountDelta = rowText(a, ['sourceAccountName', 'sourceAccountId'], '')
        .localeCompare(rowText(b, ['sourceAccountName', 'sourceAccountId'], ''))
      if (sourceAccountDelta !== 0) return sourceAccountDelta
      return dateInputValue(getFirst(a, ['posted', 'date']))
        .localeCompare(dateInputValue(getFirst(b, ['posted', 'date'])))
    })
  ), [rows])
  const displayedRows = useMemo(() => {
    const base = statusFilter === 'attention' && attentionRows.length > 0
      ? sortedRows.filter(rowNeedsAttention)
      : sortedRows.filter(row => statusFilter === 'all' || rowStatus(row).toLowerCase() === statusFilter)

    return base.filter(row => sourceAccountFilter === 'all' || rowSourceAccountId(row) === sourceAccountFilter)
  }, [attentionRows.length, sortedRows, sourceAccountFilter, statusFilter])
  const errorCount = summary?.error ?? rows.filter(row => rowStatus(row).toLowerCase() === 'error').length
  const promoteBlockReason = useMemo(() => {
    if (unmappedSourceAccounts.length > 0) return `${unmappedSourceAccounts.length} source account${unmappedSourceAccounts.length === 1 ? '' : 's'} unmapped`
    if (errorCount > 0) return `${errorCount} row${errorCount === 1 ? '' : 's'} need review`
    if (eligibleCount === 0) return 'No eligible rows'
    return null
  }, [eligibleCount, errorCount, unmappedSourceAccounts.length])

  async function promoteRun() {
    if (!runId) return
    if (promoteBlockReason) {
      setError(`Cannot promote yet: ${promoteBlockReason}`)
      return
    }

    setPromoting(true)
    setError(null)
    setNotice(null)
    setReplayNotice(null)

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

  async function replayRun() {
    if (!runId) return

    setReplaying(true)
    setError(null)
    setNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(`/api/import/runs/${encodeURIComponent(runId)}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'import_run_detail_replay' }),
      })
      const payload = await readJson(res)

      if (!res.ok) {
        setError(responseError(res, payload, 'Replay'))
        return
      }

      const replay = isRecord(payload) && isRecord(payload.replay) ? payload.replay : {}
      setReplayNotice({
        importRunId: stringValue(getFirst(isRecord(payload) ? payload : {}, ['importRunId'])) || stringValue(replay.importRunId),
        reviewUrl: stringValue(getFirst(isRecord(payload) ? payload : {}, ['reviewUrl'])) || '/import',
        rawReplayed: numberValue(replay.rawReplayed) ?? 0,
        stagedReplayed: numberValue(replay.stagedReplayed) ?? 0,
      })
    } catch {
      setError('Unable to replay import run')
    } finally {
      setReplaying(false)
    }
  }

  function updateDraft(key: string, updates: Partial<EditDraft>) {
    setDrafts(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {
          accountId: '',
          posted: '',
          amount: '',
          description: '',
          category: '',
          notes: '',
          tags: '',
          pending: false,
        }),
        ...updates,
      },
    }))
  }

  function setRowActionState(key: string, action: RowAction | null) {
    setRowActions(prev => {
      const next = { ...prev }
      if (action) next[key] = action
      else delete next[key]
      return next
    })
  }

  function setRowErrorState(key: string, message: string | null) {
    setRowErrors(prev => {
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }

  async function mutateStagedRow(
    row: StagedRow,
    key: string,
    action: RowAction,
    label: string,
    init: RequestInit,
    suffix = '',
  ) {
    if (!runId) return

    const stagedRowId = rowId(row)
    if (!stagedRowId) {
      setRowErrorState(key, 'Missing staged row id')
      return
    }

    setRowActionState(key, action)
    setRowErrorState(key, null)
    setError(null)
    setNotice(null)

    try {
      const res = await fetch(
        `/api/import/runs/${encodeURIComponent(runId)}/staged/${encodeURIComponent(stagedRowId)}${suffix}`,
        init,
      )
      const payload = await readJson(res)

      if (!res.ok) {
        setRowErrorState(key, responseError(res, payload, label))
        return
      }

      await loadRun(false)
    } catch {
      setRowErrorState(key, `Unable to ${label.toLowerCase()} staged row`)
    } finally {
      setRowActionState(key, null)
    }
  }

  async function saveRow(row: StagedRow, key: string) {
    const draft = drafts[key] ?? draftFromRow(row)

    await mutateStagedRow(row, key, 'save', 'Save', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId: draft.accountId || null,
        posted: dateInputToEpochSeconds(draft.posted),
        amount: draft.amount.trim() || null,
        description: draft.description.trim(),
        category: draft.category.trim() || null,
        notes: draft.notes.trim() || null,
        tags: parseTagsInput(draft.tags),
        pending: draft.pending,
      }),
    })
  }

  async function ignoreRow(row: StagedRow, key: string) {
    await mutateStagedRow(row, key, 'ignore', 'Ignore', { method: 'POST' }, '/ignore')
  }

  async function deleteRow(row: StagedRow, key: string) {
    await mutateStagedRow(row, key, 'delete', 'Delete', { method: 'DELETE' })
  }

  async function restoreRow(row: StagedRow, key: string) {
    await mutateStagedRow(row, key, 'restore', 'Restore', { method: 'POST' }, '/restore')
  }

  async function resolvePendingRow(row: StagedRow, key: string, action: 'cancel_pending' | 'keep_pending') {
    await mutateStagedRow(
      row,
      key,
      action === 'cancel_pending' ? 'cancelPending' : 'keepPending',
      action === 'cancel_pending' ? 'Cancel pending' : 'Keep pending',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      },
      '/resolve-pending',
    )
  }

  async function updateSourceAccountMapping(sourceAccount: SourceAccountMapping, accountId: string) {
    if (!runId) return

    setMappingActions(prev => ({ ...prev, [sourceAccount.id]: true }))
    setMappingErrors(prev => {
      const next = { ...prev }
      delete next[sourceAccount.id]
      return next
    })
    setError(null)
    setNotice(null)

    try {
      const res = await fetch(
        `/api/import/runs/${encodeURIComponent(runId)}/source-accounts/${encodeURIComponent(sourceAccount.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accountId || null }),
        },
      )
      const payload = await readJson(res)

      if (!res.ok) {
        setMappingErrors(prev => ({
          ...prev,
          [sourceAccount.id]: responseError(res, payload, 'Source account mapping'),
        }))
        return
      }

      await loadRun(false)
    } catch {
      setMappingErrors(prev => ({
        ...prev,
        [sourceAccount.id]: 'Unable to update source account mapping',
      }))
    } finally {
      setMappingActions(prev => {
        const next = { ...prev }
        delete next[sourceAccount.id]
        return next
      })
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-bold">Staged Import Review</h1>
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
        <div className={`rounded-md border px-3 py-2 text-sm ${
          notice.errors.length > 0
            ? 'border-amber-800 bg-amber-900/30 text-amber-200'
            : 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
        }`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              {notice.promoted} transaction{notice.promoted !== 1 ? 's' : ''} promoted.
            </span>
            {notice.skipped > 0 && (
              <span className="text-xs opacity-75">
                {notice.skipped} already imported or skipped.
              </span>
            )}
            {notice.errors.length > 0 && (
              <span>{notice.errors.length} failed — see details below.</span>
            )}
          </div>
          {notice.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {notice.errors.slice(0, 5).map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
          )}
          {notice.errors.length === 0 && errorCount > 0 && (
            <p className="mt-2 text-xs">
              {errorCount} row{errorCount !== 1 ? 's' : ''} still have validation errors.{' '}
              <button
                onClick={() => setStatusFilter('error')}
                className="underline hover:no-underline"
              >
                View errors
              </button>
            </p>
          )}
          {notice.errors.length === 0 && unmappedSourceAccounts.length > 0 && (
            <p className="mt-2 text-xs">
              {unmappedSourceAccounts.length} source account{unmappedSourceAccounts.length !== 1 ? 's' : ''} still unmapped — map them above to make more rows eligible.
            </p>
          )}
          {notice.errors.length > 0 && eligibleCount > 0 && (
            <p className="mt-2 text-xs">
              {eligibleCount} row{eligibleCount !== 1 ? 's' : ''} still eligible — fix errors and promote again.
            </p>
          )}
        </div>
      )}

      {replayNotice && (
        <div className="rounded-md border border-blue-800 bg-blue-900/30 px-3 py-2 text-sm text-blue-100">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              Replayed {replayNotice.rawReplayed} raw item{replayNotice.rawReplayed !== 1 ? 's' : ''} into a new import run.
            </span>
            <span className="text-xs text-blue-200/80">
              {replayNotice.stagedReplayed} staged row{replayNotice.stagedReplayed !== 1 ? 's' : ''} created.
            </span>
            <Link href={replayNotice.reviewUrl} className="text-xs font-medium underline hover:no-underline">
              Open replay
            </Link>
          </div>
          <div className="mt-1 font-mono text-xs text-blue-200/80">{replayNotice.importRunId}</div>
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
            <div className="flex flex-wrap gap-2 md:justify-end">
              <button
                onClick={replayRun}
                disabled={loading || refreshing || promoting || replaying || !runId}
                className="self-start rounded-md border border-blue-800 bg-blue-950/60 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-900/70 disabled:opacity-60 md:self-auto"
              >
                {replaying ? 'Replaying...' : 'Replay run'}
              </button>
              <button
                onClick={promoteRun}
                disabled={loading || refreshing || promoting || replaying || !runId || Boolean(promoteBlockReason)}
                className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60 md:self-auto"
              >
                {promoting ? 'Promoting...' : `Promote eligible rows${eligibleCount ? ` (${eligibleCount})` : ''}`}
              </button>
            </div>
            {promoteBlockReason && (
              <p className="text-xs text-amber-300 md:max-w-[220px] md:text-right">{promoteBlockReason}</p>
            )}
          </div>
        )}
      </section>

      {sourceAccounts.length > 0 && (
        <section className={`rounded-xl border p-5 ${
          unmappedSourceAccounts.length > 0
            ? 'border-amber-800 bg-amber-950/20'
            : 'border-slate-700 bg-slate-800'
        }`}>
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Source Account Mapping</h2>
              <p className="mt-1 text-sm text-slate-400">
                {unmappedSourceAccounts.length > 0
                  ? `${unmappedSourceAccounts.length} source account${unmappedSourceAccounts.length === 1 ? '' : 's'} need mapping`
                  : 'All source accounts are mapped'}
              </p>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300">
              {sourceAccounts.length} source accounts
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {sourceAccounts.map(sourceAccount => {
              const busy = Boolean(mappingActions[sourceAccount.id])
              return (
                <div key={sourceAccount.id} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{sourceAccountLabel(sourceAccount)}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">{sourceAccount.externalAccountId}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${
                      sourceAccount.fintrackAccountId
                        ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
                        : 'border-amber-800 bg-amber-900/30 text-amber-200'
                    }`}>
                      {sourceAccount.fintrackAccountId ? 'Mapped' : 'Unmapped'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <select
                      value={sourceAccount.fintrackAccountId ?? ''}
                      onChange={event => updateSourceAccountMapping(sourceAccount, event.target.value)}
                      disabled={busy || accountsLoading}
                      className="h-9 w-full rounded border border-slate-600 bg-slate-900/70 px-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                    >
                      <option value="">{accountsLoading ? 'Loading accounts...' : 'Unmapped account'}</option>
                      {accounts.map(account => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                    <span className="self-center text-xs tabular-nums text-slate-500">
                      {sourceAccount.errorCount}/{sourceAccount.stagedCount}
                    </span>
                  </div>
                  {sourceAccount.fintrackAccountName && (
                    <p className="mt-2 truncate text-xs text-slate-400">{sourceAccount.fintrackAccountName}</p>
                  )}
                  {mappingErrors[sourceAccount.id] && (
                    <p className="mt-2 text-xs text-red-200">{mappingErrors[sourceAccount.id]}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

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
        <div className="flex flex-col gap-3 border-b border-slate-700 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-300">Ledger Prep Rows</h2>
            {accountsError && <p className="mt-1 text-xs text-amber-300">{accountsError}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as RowStatusFilter)}
              className="h-8 rounded border border-slate-600 bg-slate-900/70 px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              {ROW_STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              value={sourceAccountFilter}
              onChange={event => setSourceAccountFilter(event.target.value)}
              className="h-8 rounded border border-slate-600 bg-slate-900/70 px-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All source accounts</option>
              {sourceAccounts.map(sourceAccount => (
                <option key={sourceAccount.id} value={sourceAccount.id}>
                  {sourceAccountLabel(sourceAccount)}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">{displayedRows.length}/{rows.length} rows</span>
          </div>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Loading staged rows...</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No staged rows returned for this import run.</p>
        ) : displayedRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No rows match the selected filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[2050px]">
              <div className="grid grid-cols-[100px_220px_130px_130px_minmax(260px,1fr)_180px_220px_190px_90px_minmax(220px,1fr)_190px] gap-3 border-b border-slate-700 px-4 py-2 text-xs text-slate-500">
                <span>Status</span>
                <span>Account</span>
                <span>Posted</span>
                <span>Amount</span>
                <span>Description</span>
                <span>Ledger Account</span>
                <span>Notes</span>
                <span>Tags</span>
                <span>Pending</span>
                <span>Validation</span>
                <span>Actions</span>
              </div>
              {displayedRows.map((row, index) => {
                const key = rowKey(row, index)
                const status = rowStatus(row)
                const draft = drafts[key] ?? draftFromRow(row)
                const locked = rowIsLocked(row)
                const restorable = rowIsRestorable(row)
                const expiredPending = rowIsExpiredPending(row)
                const busyAction = rowActions[key]
                const disabled = locked || Boolean(busyAction)
                const hasSelectedAccount = accounts.some(account => account.id === draft.accountId)
                const sourceAccount = rowText(
                  row,
                  ['sourceAccountName', 'sourceAccount', 'source_account', 'sourceAccountId', 'source_account_id'],
                  '',
                )
                const currentAccountName = rowText(row, ['accountName', 'account', 'canonicalAccountName'], draft.accountId)
                const validationErrors = rowValidationErrors(row)
                const reconciliationReason = rowReconciliationReason(row)
                const actionLabel = busyAction ? rowActionLabel(busyAction) : ''

                return (
                  <div
                    key={key}
                    className="grid grid-cols-[100px_220px_130px_130px_minmax(260px,1fr)_180px_220px_190px_90px_minmax(220px,1fr)_190px] items-start gap-3 border-b border-slate-700 px-4 py-2 text-sm last:border-b-0"
                  >
                    <span>
                      <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}>
                        <span className="truncate">{status}</span>
                      </span>
                    </span>
                    <span className="space-y-1">
                      <select
                        value={draft.accountId}
                        onChange={event => updateDraft(key, { accountId: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                      >
                        <option value="">{accountsLoading ? 'Loading accounts...' : 'Unmatched account'}</option>
                        {draft.accountId && !hasSelectedAccount && (
                          <option value={draft.accountId}>{currentAccountName}</option>
                        )}
                        {accounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                      {sourceAccount && (
                        <span className="block truncate text-[11px] text-slate-500">Source: {sourceAccount}</span>
                      )}
                    </span>
                    <span>
                      <input
                        type="date"
                        value={draft.posted}
                        onChange={event => updateDraft(key, { posted: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Posted date"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.amount}
                        onChange={event => updateDraft(key, { amount: event.target.value })}
                        disabled={disabled}
                        className={`${COMPACT_FIELD_CLASS} tabular-nums`}
                        aria-label="Amount"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.description}
                        onChange={event => updateDraft(key, { description: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Description"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.category}
                        onChange={event => updateDraft(key, { category: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Ledger account"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.notes}
                        onChange={event => updateDraft(key, { notes: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Notes"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.tags}
                        onChange={event => updateDraft(key, { tags: event.target.value })}
                        disabled={disabled}
                        placeholder="tag1, tag2"
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Tags"
                      />
                    </span>
                    <span className="flex h-8 items-center">
                      <input
                        type="checkbox"
                        checked={draft.pending}
                        onChange={event => updateDraft(key, { pending: event.target.checked })}
                        disabled={disabled}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Pending"
                      />
                    </span>
                    <span className={validationErrors === '-' ? 'text-slate-500' : 'text-red-200'}>
                      <span className="block">{validationErrors}</span>
                      {reconciliationReason && reconciliationReason !== validationErrors && (
                        <span className="mt-1 block text-[11px] text-slate-400">{reconciliationReason}</span>
                      )}
                    </span>
                    <span className="space-y-1">
                      {restorable ? (
                        <button
                          onClick={() => restoreRow(row, key)}
                          disabled={Boolean(busyAction)}
                          className="rounded-md border border-emerald-800 bg-emerald-950/50 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-60"
                        >
                          {busyAction === 'restore' ? actionLabel : 'Restore'}
                        </button>
                      ) : locked ? (
                        <span className="text-xs text-slate-500">Locked</span>
                      ) : expiredPending ? (
                        <span className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => resolvePendingRow(row, key, 'cancel_pending')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-red-900 bg-red-950/50 px-2 py-1 text-xs text-red-200 hover:bg-red-900/70 disabled:opacity-60"
                          >
                            {busyAction === 'cancelPending' ? actionLabel : 'Cancel pending'}
                          </button>
                          <button
                            onClick={() => resolvePendingRow(row, key, 'keep_pending')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'keepPending' ? actionLabel : 'Keep pending'}
                          </button>
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => saveRow(row, key)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                          >
                            {busyAction === 'save' ? actionLabel : 'Save'}
                          </button>
                          <button
                            onClick={() => ignoreRow(row, key)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'ignore' ? actionLabel : 'Ignore'}
                          </button>
                          <button
                            onClick={() => deleteRow(row, key)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-red-900 bg-red-950/50 px-2 py-1 text-xs text-red-200 hover:bg-red-900/70 disabled:opacity-60"
                          >
                            {busyAction === 'delete' ? actionLabel : 'Delete'}
                          </button>
                        </span>
                      )}
                      {rowErrors[key] && <span className="block text-xs text-red-200">{rowErrors[key]}</span>}
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
