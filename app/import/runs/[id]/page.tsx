'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type StagedRow = Record<string, unknown>
type InvestmentActivityRow = Record<string, unknown>
type InvestmentPositionRow = Record<string, unknown>
type SecurityMappingRow = Record<string, unknown>
type RowAction = 'save' | 'ignore' | 'delete' | 'restore' | 'cancelPending' | 'keepPending'
type InvestmentActivityAction = 'review' | 'ignore' | 'block'
type InvestmentPositionAction = InvestmentActivityAction
type SecurityMappingAction = 'save' | 'clear'
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

interface PromotionValidationNotice {
  ok: boolean
  period: string
  promotion: {
    promoted: number
    skipped: number
    errors: string[]
  }
  validation: {
    ok: boolean
    stage: string
    summary: {
      exportableTransactions: number
      mergedTransfers: number
      blockers: number
      reviewItems: number
      previouslyExported: number
      exportableInvestmentActivities: number
    }
    blockers: string[]
    checker: {
      status: string
      mode: string
      message: string
    } | null
  } | null
}

interface ReplayNotice {
  importRunId: string
  reviewUrl: string
  rawReplayed: number
  stagedReplayed: number
}

interface InvestmentActivityCounts {
  total: number
  blocked: number
  needsReview: number
  reviewed: number
  ignored: number
}

interface InvestmentPositionCounts {
  total: number
  blocked: number
  needsReview: number
  reviewed: number
  ignored: number
}

interface SecurityMappingCounts {
  total: number
  mapped: number
  unmapped: number
}

type RowStatusFilter = 'attention' | 'all' | 'error' | 'staged' | 'ready' | 'merged' | 'ignored' | 'deleted'

const SUMMARY_KEYS: SummaryKey[] = ['raw', 'staged', 'ready', 'merged', 'ignored', 'deleted', 'error', 'canonical']
const ROW_STATUS_FILTERS: Array<[RowStatusFilter, string]> = [
  ['attention', '需处理'],
  ['all', '全部记录'],
  ['error', '错误'],
  ['staged', '已暂存'],
  ['ready', '就绪'],
  ['merged', '已合并'],
  ['ignored', '已忽略'],
  ['deleted', '已删除'],
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

const SUMMARY_LABELS: Record<SummaryKey, string> = {
  raw: '原始',
  staged: '暂存',
  ready: '就绪',
  merged: '已合并',
  ignored: '已忽略',
  deleted: '已删除',
  error: '错误',
  canonical: '正式',
}

const STATUS_LABELS: Record<string, string> = {
  blocked: '已阻止',
  canonical: '正式',
  completed: '已完成',
  deleted: '已删除',
  error: '错误',
  export_ready: '可导出',
  exported: '已导出',
  failed: '失败',
  ignored: '已忽略',
  mapped: '已映射',
  merged: '已合并',
  needs_review: '需审核',
  passed: '通过',
  ready: '就绪',
  reviewed: '已审核',
  running: '运行中',
  staged: '已暂存',
  skipped: '已跳过',
  unmapped: '未映射',
  unknown: '未知',
  unavailable: '不可用',
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
  return `${label}失败，状态码 ${res.status}`
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

function extractInvestmentActivities(payload: unknown): InvestmentActivityRow[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []

  const rows = payload.rows
  return Array.isArray(rows) ? rows.filter(isRecord) : []
}

function extractInvestmentPositions(payload: unknown): InvestmentPositionRow[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []

  const rows = payload.rows
  return Array.isArray(rows) ? rows.filter(isRecord) : []
}

function extractSecurityMappings(payload: unknown): SecurityMappingRow[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []

  const securities = payload.securities
  return Array.isArray(securities) ? securities.filter(isRecord) : []
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

function rowLifecycleState(row: StagedRow): string {
  return stringValue(getFirst(row, ['lifecycleState', 'lifecycle_state'])) || rowStatus(row)
}

function stateLabel(value: string): string {
  const normalized = value.toLowerCase()
  if (STATUS_LABELS[normalized]) return STATUS_LABELS[normalized]

  return value
    .split('_')
    .filter(Boolean)
    .map(part => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
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
    return new Date(millis).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
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

function arrayText(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function activityValidationErrors(row: InvestmentActivityRow): string {
  const messages = arrayText(getFirst(row, ['validationErrors', 'validation_errors']))
  return messages.length > 0 ? messages.join('; ') : '-'
}

function positionValidationErrors(row: InvestmentPositionRow): string {
  const messages = arrayText(getFirst(row, ['validationErrors', 'validation_errors']))
  return messages.length > 0 ? messages.join('; ') : '-'
}

function activityStatus(row: InvestmentActivityRow): string {
  return stringValue(getFirst(row, ['status'])) || 'blocked'
}

function positionStatus(row: InvestmentPositionRow): string {
  return stringValue(getFirst(row, ['status'])) || 'needs_review'
}

function activityId(row: InvestmentActivityRow): string {
  return stringValue(getFirst(row, ['id']))
}

function positionId(row: InvestmentPositionRow): string {
  return stringValue(getFirst(row, ['id']))
}

function activityKey(row: InvestmentActivityRow, index: number): string {
  return activityId(row) || `investment-activity-${index}`
}

function positionKey(row: InvestmentPositionRow, index: number): string {
  return positionId(row) || `investment-position-${index}`
}

function investmentActivityTypeLabel(value: string): string {
  switch (value) {
    case 'buy':
      return '买入'
    case 'sell':
      return '卖出'
    case 'dividend':
      return '股息'
    case 'reinvest_dividend':
      return '股息再投资'
    case 'interest':
      return '利息'
    case 'fee':
      return '费用'
    case 'cash_transfer':
      return '现金转账'
    case 'other':
      return '其他'
    default:
      return value || '其他'
  }
}

function investmentInstrumentTypeLabel(value: string): string {
  switch (value) {
    case 'equity':
      return '股票'
    case 'option':
      return '期权'
    case 'cash':
      return '现金'
    case 'fund':
      return '基金'
    case 'unknown':
      return '未知'
    default:
      return value || '未知'
  }
}

function investmentPositionEffectLabel(value: string): string {
  switch (value) {
    case 'open':
      return '开仓'
    case 'close':
      return '平仓'
    case 'unknown':
      return '未知'
    case 'none':
    case '':
      return ''
    default:
      return value
  }
}

function investmentOptionTypeLabel(value: string): string {
  switch (value) {
    case 'call':
      return '看涨'
    case 'put':
      return '看跌'
    case '':
      return ''
    default:
      return value
  }
}

function activityLabel(row: InvestmentActivityRow): string {
  const activityType = stringValue(getFirst(row, ['activityType', 'activity_type'])) || 'other'
  const instrumentType = stringValue(getFirst(row, ['instrumentType', 'instrument_type'])) || 'unknown'
  const positionEffect = stringValue(getFirst(row, ['positionEffect', 'position_effect']))
  return [
    investmentActivityTypeLabel(activityType),
    investmentInstrumentTypeLabel(instrumentType),
    positionEffect === 'none' ? '' : investmentPositionEffectLabel(positionEffect),
  ]
    .filter(Boolean)
    .join(' / ')
}

function activitySecurityLabel(row: InvestmentActivityRow): string {
  return stringValue(
    getFirst(row, ['sourceSymbol', 'source_symbol']),
    getFirst(row, ['beancountCommodity', 'beancount_commodity']),
    getFirst(row, ['securityName', 'security_name']),
  ) || '-'
}

function activityDescription(row: InvestmentActivityRow): string {
  return stringValue(getFirst(row, ['description', 'action'])) || '-'
}

function activityOptionLabel(row: InvestmentActivityRow): string {
  const optionType = stringValue(getFirst(row, ['optionType', 'option_type']))
  const positionEffect = stringValue(getFirst(row, ['positionEffect', 'position_effect']))
  const settlementDate = stringValue(getFirst(row, ['settlementDate', 'settlement_date']))
  const parts = [
    investmentOptionTypeLabel(optionType),
    positionEffect && positionEffect !== 'none' ? investmentPositionEffectLabel(positionEffect) : '',
    settlementDate ? `结算 ${settlementDate}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : '-'
}

function investmentActivityActionLabel(action: InvestmentActivityAction): string {
  if (action === 'review') return '审核中...'
  if (action === 'ignore') return '忽略中...'
  return '阻止中...'
}

function investmentPositionActionLabel(action: InvestmentPositionAction): string {
  if (action === 'review') return '审核中...'
  if (action === 'ignore') return '忽略中...'
  return '阻止中...'
}

function positionSecurityLabel(row: InvestmentPositionRow): string {
  return stringValue(
    getFirst(row, ['sourceSymbol', 'source_symbol']),
    getFirst(row, ['beancountCommodity', 'beancount_commodity']),
    getFirst(row, ['securityName', 'security_name']),
  ) || '-'
}

function securityId(row: SecurityMappingRow): string {
  return stringValue(getFirst(row, ['id']))
}

function securityKey(row: SecurityMappingRow, index: number): string {
  return securityId(row) || `security-${index}`
}

function securityCommodity(row: SecurityMappingRow): string {
  return stringValue(getFirst(row, ['beancountCommodity', 'beancount_commodity']))
}

function securitySuggestedCommodity(row: SecurityMappingRow): string {
  return stringValue(getFirst(row, ['suggestedCommodity', 'suggested_commodity']))
}

function securityMappingStatus(row: SecurityMappingRow): 'mapped' | 'unmapped' {
  return securityCommodity(row) ? 'mapped' : 'unmapped'
}

function securityDisplaySymbol(row: SecurityMappingRow): string {
  return stringValue(
    getFirst(row, ['sourceSymbol', 'source_symbol']),
    getFirst(row, ['contractSymbol', 'contract_symbol']),
    getFirst(row, ['name']),
  ) || '-'
}

function securityName(row: SecurityMappingRow): string {
  return stringValue(getFirst(row, ['name'])) || '-'
}

function securityInstrumentLabel(row: SecurityMappingRow): string {
  const instrumentType = stringValue(getFirst(row, ['instrumentType', 'instrument_type'])) || 'unknown'
  const optionType = stringValue(getFirst(row, ['optionType', 'option_type']))
  const expirationDate = stringValue(getFirst(row, ['expirationDate', 'expiration_date']))
  const strikePrice = stringValue(getFirst(row, ['strikePrice', 'strike_price']))
  const parts = [
    investmentInstrumentTypeLabel(instrumentType),
    investmentOptionTypeLabel(optionType),
    expirationDate,
    strikePrice ? `$${strikePrice}` : '',
  ].filter(Boolean)
  return parts.join(' / ')
}

function securityActivitySummary(row: SecurityMappingRow): string {
  const total = numberValue(getFirst(row, ['activityCount', 'activity_count'])) ?? 0
  const reviewed = numberValue(getFirst(row, ['reviewedCount', 'reviewed_count'])) ?? 0
  const ignored = numberValue(getFirst(row, ['ignoredCount', 'ignored_count'])) ?? 0
  const blocked = numberValue(getFirst(row, ['blockedCount', 'blocked_count'])) ?? 0
  const needsReview = numberValue(getFirst(row, ['needsReviewCount', 'needs_review_count'])) ?? 0
  return `${total} 条 / ${reviewed} 已审核 / ${ignored} 已忽略 / ${blocked + needsReview} 待处理`
}

function securityMappingActionLabel(action: SecurityMappingAction): string {
  return action === 'clear' ? '清除中...' : '保存中...'
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
  const lifecycleState = rowLifecycleState(row).toLowerCase()
  return lifecycleState === 'needs_review' || lifecycleState === 'failed' || rowNeedsAccountMapping(row)
}

function rowPriority(row: StagedRow): number {
  const lifecycleState = rowLifecycleState(row).toLowerCase()
  const status = rowStatus(row).toLowerCase()
  if (lifecycleState === 'failed') return 0
  if (lifecycleState === 'needs_review') return 1
  if (rowNeedsAccountMapping(row)) return 1
  if (lifecycleState === 'reviewed') return 2
  if (status === 'staged') return 3
  if (lifecycleState === 'export_ready' || lifecycleState === 'exported') return 4
  if (lifecycleState === 'ignored' || lifecycleState === 'deleted') return 5
  return 6
}

function sourceAccountLabel(sourceAccount: SourceAccountMapping): string {
  return sourceAccount.name || sourceAccount.externalAccountId || sourceAccount.id
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'ready' || normalized === 'reviewed') return 'border-emerald-700 bg-emerald-900/30 text-emerald-200'
  if (normalized === 'merged' || normalized === 'canonical' || normalized === 'export_ready' || normalized === 'exported') return 'border-blue-700 bg-blue-900/30 text-blue-200'
  if (normalized === 'needs_review' || normalized === 'blocked') return 'border-amber-800 bg-amber-900/30 text-amber-200'
  if (normalized === 'ignored') return 'border-slate-600 bg-slate-700/50 text-slate-300'
  if (normalized === 'error' || normalized === 'failed') return 'border-red-800 bg-red-900/30 text-red-200'
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
  if (action === 'cancelPending') return '取消待处理中...'
  if (action === 'keepPending') return '保留待处理中...'
  if (action === 'save') return '保存中...'
  if (action === 'ignore') return '忽略中...'
  if (action === 'delete') return '删除中...'
  if (action === 'restore') return '恢复中...'
  return '处理中...'
}

function collectErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map(item => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''

      const row = stringValue(item.rowNumber, item.row, item.line)
      const stagedTransactionId = stringValue(item.stagedTransactionId, item.staged_transaction_id)
      const message = stringValue(item.error, item.message, item.reason) || '错误'
      if (row) return `第 ${row} 行：${message}`
      return stagedTransactionId ? `暂存记录 ${stagedTransactionId}：${message}` : message
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

function validationBlockers(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map(item => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''

      const code = stringValue(item.code)
      const message = stringValue(item.message)
      if (code && message) return `${code}: ${message}`
      return message || code
    })
    .filter(Boolean)
}

function promotionValidationNotice(payload: unknown): PromotionValidationNotice {
  const record = isRecord(payload) ? payload : {}
  const promotion = getFirstRecord(record, ['promotion']) ?? {}
  const validation = getFirstRecord(record, ['validation'])
  const summary = validation ? getFirstRecord(validation, ['summary']) ?? {} : {}
  const checker = validation ? getFirstRecord(validation, ['checker']) : null

  return {
    ok: booleanValue(record.ok),
    period: stringValue(record.period),
    promotion: {
      promoted: numberValue(getFirst(promotion, ['promoted'])) ?? 0,
      skipped: numberValue(getFirst(promotion, ['skipped'])) ?? 0,
      errors: collectErrors(getFirst(promotion, ['errors'])),
    },
    validation: validation
      ? {
        ok: booleanValue(validation.ok),
        stage: stringValue(validation.stage),
        summary: {
          exportableTransactions: numberValue(getFirst(summary, ['exportableTransactions'])) ?? 0,
          mergedTransfers: numberValue(getFirst(summary, ['mergedTransfers'])) ?? 0,
          blockers: numberValue(getFirst(summary, ['blockers'])) ?? 0,
          reviewItems: numberValue(getFirst(summary, ['reviewItems'])) ?? 0,
          previouslyExported: numberValue(getFirst(summary, ['previouslyExported'])) ?? 0,
          exportableInvestmentActivities: numberValue(getFirst(summary, ['exportableInvestmentActivities'])) ?? 0,
        },
        blockers: validationBlockers(getFirst(validation, ['blockers'])),
        checker: checker
          ? {
            status: stringValue(checker.status),
            mode: stringValue(checker.mode),
            message: stringValue(checker.message),
          }
          : null,
      }
      : null,
  }
}

function validationStageLabel(stage: string): string {
  if (stage === 'preflight') return '预检规则'
  if (stage === 'external') return '外部 Beancount'
  return stage || '未知'
}

export default function ImportRunPage() {
  const params = useParams<Record<string, string | string[]>>()
  const idParam = params.id
  const runId = Array.isArray(idParam) ? idParam[0] : idParam

  const [runInfo, setRunInfo] = useState<RunInfo | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<StagedRow[]>([])
  const [investmentActivities, setInvestmentActivities] = useState<InvestmentActivityRow[]>([])
  const [investmentPositions, setInvestmentPositions] = useState<InvestmentPositionRow[]>([])
  const [securityMappings, setSecurityMappings] = useState<SecurityMappingRow[]>([])
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [sourceAccounts, setSourceAccounts] = useState<SourceAccountMapping[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({})
  const [rowActions, setRowActions] = useState<Record<string, RowAction>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [investmentActions, setInvestmentActions] = useState<Record<string, InvestmentActivityAction>>({})
  const [investmentErrors, setInvestmentErrors] = useState<Record<string, string>>({})
  const [positionActions, setPositionActions] = useState<Record<string, InvestmentPositionAction>>({})
  const [positionErrors, setPositionErrors] = useState<Record<string, string>>({})
  const [securityCommodityDrafts, setSecurityCommodityDrafts] = useState<Record<string, string>>({})
  const [securityActions, setSecurityActions] = useState<Record<string, SecurityMappingAction>>({})
  const [securityErrors, setSecurityErrors] = useState<Record<string, string>>({})
  const [mappingActions, setMappingActions] = useState<Record<string, boolean>>({})
  const [mappingErrors, setMappingErrors] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState<RowStatusFilter>('attention')
  const [sourceAccountFilter, setSourceAccountFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [validatingPromotion, setValidatingPromotion] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [savingSuggestedSecurities, setSavingSuggestedSecurities] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<PromoteNotice | null>(null)
  const [validationNotice, setValidationNotice] = useState<PromotionValidationNotice | null>(null)
  const [validationPeriod, setValidationPeriod] = useState('')
  const [replayNotice, setReplayNotice] = useState<ReplayNotice | null>(null)

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    setAccountsError(null)

    try {
      const res = await fetch('/api/accounts')
      const payload = await readJson(res)

      if (!res.ok) {
        setAccountsError(responseError(res, payload, '账户加载'))
        return
      }

      setAccounts(extractAccounts(payload))
    } catch {
      setAccountsError('无法加载账户')
    } finally {
      setAccountsLoading(false)
    }
  }, [])

  const loadRun = useCallback(async (initial = false) => {
    if (!runId) {
      setError('缺少 import run id')
      setLoading(false)
      return
    }

    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const [runRes, stagedRes, sourceAccountsRes, investmentActivitiesRes, investmentPositionsRes, securitiesRes] = await Promise.all([
        fetch(`/api/import/runs/${encodeURIComponent(runId)}`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/staged`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/source-accounts`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/investment-activities`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/investment-positions`),
        fetch(`/api/import/runs/${encodeURIComponent(runId)}/securities`),
      ])
      const [runPayload, stagedPayload, sourceAccountsPayload, investmentActivitiesPayload, investmentPositionsPayload, securitiesPayload] = await Promise.all([
        readJson(runRes),
        readJson(stagedRes),
        readJson(sourceAccountsRes),
        readJson(investmentActivitiesRes),
        readJson(investmentPositionsRes),
        readJson(securitiesRes),
      ])

      if (!runRes.ok) {
        setError(responseError(runRes, runPayload, '导入批次摘要加载'))
        return
      }
      if (!stagedRes.ok) {
        setError(responseError(stagedRes, stagedPayload, '暂存记录加载'))
        return
      }
      if (!sourceAccountsRes.ok) {
        setError(responseError(sourceAccountsRes, sourceAccountsPayload, '来源账户映射加载'))
        return
      }
      if (!investmentActivitiesRes.ok) {
        setError(responseError(investmentActivitiesRes, investmentActivitiesPayload, '投资活动加载'))
        return
      }
      if (!investmentPositionsRes.ok) {
        setError(responseError(investmentPositionsRes, investmentPositionsPayload, '投资持仓加载'))
        return
      }
      if (!securitiesRes.ok) {
        setError(responseError(securitiesRes, securitiesPayload, '证券映射加载'))
        return
      }

      const nextRows = extractStagedRows(stagedPayload)
      setSourceAccounts(extractSourceAccounts(sourceAccountsPayload))
      setInvestmentActivities(extractInvestmentActivities(investmentActivitiesPayload))
      setInvestmentPositions(extractInvestmentPositions(investmentPositionsPayload))
      setSecurityMappings(extractSecurityMappings(securitiesPayload))
      setRunInfo(normalizeRun(runPayload, runId))
      setRows(nextRows)
      setRowErrors({})
      setInvestmentErrors({})
      setPositionErrors({})
      setSecurityErrors({})
      setMappingErrors({})
      setSummary(normalizeSummary([runPayload, stagedPayload], nextRows))
    } catch {
      setError('无法加载暂存导入审核数据')
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

  useEffect(() => {
    setSecurityCommodityDrafts(() => {
      const nextDrafts: Record<string, string> = {}
      securityMappings.forEach((security, index) => {
        nextDrafts[securityKey(security, index)] = securityCommodity(security) || securitySuggestedCommodity(security)
      })
      return nextDrafts
    })
  }, [securityMappings])

  const eligibleCount = useMemo(() => {
    if (summary && (summary.staged !== null || summary.ready !== null)) {
      return (summary.staged ?? 0) + (summary.ready ?? 0)
    }
    return rows.filter(row => ELIGIBLE_STATUSES.has(rowStatus(row).toLowerCase())).length
  }, [rows, summary])
  const inferredValidationPeriod = useMemo(() => {
    const eligibleRow = rows.find(row => ELIGIBLE_STATUSES.has(rowStatus(row).toLowerCase()))
    const posted = eligibleRow ? dateInputValue(getFirst(eligibleRow, ['posted', 'postedAt', 'posted_at', 'date'])) : ''
    return posted ? posted.slice(0, 7) : new Date().toISOString().slice(0, 7)
  }, [rows])

  useEffect(() => {
    setValidationPeriod(current => current || inferredValidationPeriod)
  }, [inferredValidationPeriod])

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
  const investmentActivityCounts = useMemo<InvestmentActivityCounts>(() => {
    const counts: InvestmentActivityCounts = {
      total: investmentActivities.length,
      blocked: 0,
      needsReview: 0,
      reviewed: 0,
      ignored: 0,
    }

    for (const activity of investmentActivities) {
      const status = activityStatus(activity)
      if (status === 'blocked') counts.blocked++
      else if (status === 'needs_review') counts.needsReview++
      else if (status === 'reviewed') counts.reviewed++
      else if (status === 'ignored') counts.ignored++
    }

    return counts
  }, [investmentActivities])
  const investmentPositionCounts = useMemo<InvestmentPositionCounts>(() => {
    const counts: InvestmentPositionCounts = {
      total: investmentPositions.length,
      blocked: 0,
      needsReview: 0,
      reviewed: 0,
      ignored: 0,
    }

    for (const position of investmentPositions) {
      const status = positionStatus(position)
      if (status === 'blocked') counts.blocked++
      else if (status === 'needs_review') counts.needsReview++
      else if (status === 'reviewed') counts.reviewed++
      else if (status === 'ignored') counts.ignored++
    }

    return counts
  }, [investmentPositions])
  const securityMappingCounts = useMemo<SecurityMappingCounts>(() => {
    const mapped = securityMappings.filter(security => securityMappingStatus(security) === 'mapped').length
    return {
      total: securityMappings.length,
      mapped,
      unmapped: securityMappings.length - mapped,
    }
  }, [securityMappings])
  const suggestedSecurityMappingCount = useMemo(
    () => securityMappings.filter(security => !securityCommodity(security) && securitySuggestedCommodity(security)).length,
    [securityMappings],
  )
  const errorCount = summary?.error ?? rows.filter(row => rowStatus(row).toLowerCase() === 'error').length
  const promoteBlockReason = useMemo(() => {
    if (unmappedSourceAccounts.length > 0) return `${unmappedSourceAccounts.length} 个来源账户未映射`
    if (errorCount > 0) return `${errorCount} 条记录需审核`
    if (eligibleCount === 0) return '没有可提升记录'
    return null
  }, [eligibleCount, errorCount, unmappedSourceAccounts.length])

  function updateSecurityCommodityDraft(key: string, value: string) {
    setSecurityCommodityDrafts(prev => ({
      ...prev,
      [key]: value,
    }))
  }

  function setSecurityActionState(key: string, action: SecurityMappingAction | null) {
    setSecurityActions(prev => {
      const next = { ...prev }
      if (action) next[key] = action
      else delete next[key]
      return next
    })
  }

  function setSecurityErrorState(key: string, message: string | null) {
    setSecurityErrors(prev => {
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }

  async function updateSecurityMapping(
    security: SecurityMappingRow,
    key: string,
    action: SecurityMappingAction,
    commodity: string | null,
  ) {
    if (!runId) return

    const id = securityId(security)
    if (!id) {
      setSecurityErrorState(key, '缺少 security id')
      return
    }

    setSecurityActionState(key, action)
    setSecurityErrorState(key, null)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(
        `/api/import/runs/${encodeURIComponent(runId)}/securities/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            beancountCommodity: commodity,
            actor: 'local',
            reason: 'security_mapping_update',
          }),
        },
      )
      const payload = await readJson(res)

      if (!res.ok) {
        setSecurityErrorState(key, responseError(res, payload, '证券映射更新'))
        return
      }

      await loadRun(false)
    } catch {
      setSecurityErrorState(key, '无法更新证券映射')
    } finally {
      setSecurityActionState(key, null)
    }
  }

  async function saveSuggestedSecurityMappings() {
    if (!runId) return

    const candidates = securityMappings
      .map((security, index) => ({
        security,
        key: securityKey(security, index),
        id: securityId(security),
        suggested: securitySuggestedCommodity(security),
      }))
      .filter((candidate): candidate is {
        security: SecurityMappingRow
        key: string
        id: string
        suggested: string
      } => !securityCommodity(candidate.security) && Boolean(candidate.id) && Boolean(candidate.suggested))

    if (candidates.length === 0) return

    setSavingSuggestedSecurities(true)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)
    setSecurityErrors({})
    setSecurityActions(prev => {
      const next = { ...prev }
      for (const candidate of candidates) next[candidate.key] = 'save'
      return next
    })

    try {
      const results = await Promise.all(candidates.map(async candidate => {
        const res = await fetch(
          `/api/import/runs/${encodeURIComponent(runId)}/securities/${encodeURIComponent(candidate.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              beancountCommodity: candidate.suggested,
              actor: 'local',
              reason: 'security_mapping_save_suggested',
            }),
          },
        )
        const payload = await readJson(res)
        return { ...candidate, res, payload }
      }))

      const failures = results.filter(result => !result.res.ok)
      if (failures.length > 0) {
        await loadRun(false)
        setSecurityErrors(prev => {
          const next = { ...prev }
          for (const failure of failures) {
            next[failure.key] = responseError(failure.res, failure.payload, '证券映射更新')
          }
          return next
        })
        setError(`${failures.length} 条建议证券映射保存失败`)
        return
      }

      await loadRun(false)
    } catch {
      setError('无法保存建议证券映射')
    } finally {
      setSavingSuggestedSecurities(false)
      setSecurityActions(prev => {
        const next = { ...prev }
        for (const candidate of candidates) delete next[candidate.key]
        return next
      })
    }
  }

  function setInvestmentActionState(key: string, action: InvestmentActivityAction | null) {
    setInvestmentActions(prev => {
      const next = { ...prev }
      if (action) next[key] = action
      else delete next[key]
      return next
    })
  }

  function setInvestmentErrorState(key: string, message: string | null) {
    setInvestmentErrors(prev => {
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }

  async function updateInvestmentActivity(
    activity: InvestmentActivityRow,
    key: string,
    action: InvestmentActivityAction,
    status: string,
  ) {
    if (!runId) return

    const id = activityId(activity)
    if (!id) {
      setInvestmentErrorState(key, '缺少 investment activity id')
      return
    }

    setInvestmentActionState(key, action)
    setInvestmentErrorState(key, null)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(
        `/api/import/runs/${encodeURIComponent(runId)}/investment-activities/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            actor: 'local',
            reason: `investment_activity_${status}`,
          }),
        },
      )
      const payload = await readJson(res)

      if (!res.ok) {
        setInvestmentErrorState(key, responseError(res, payload, '投资活动更新'))
        return
      }

      await loadRun(false)
    } catch {
      setInvestmentErrorState(key, '无法更新投资活动')
    } finally {
      setInvestmentActionState(key, null)
    }
  }

  function setPositionActionState(key: string, action: InvestmentPositionAction | null) {
    setPositionActions(prev => {
      const next = { ...prev }
      if (action) next[key] = action
      else delete next[key]
      return next
    })
  }

  function setPositionErrorState(key: string, message: string | null) {
    setPositionErrors(prev => {
      const next = { ...prev }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }

  async function updateInvestmentPosition(
    position: InvestmentPositionRow,
    key: string,
    action: InvestmentPositionAction,
    status: string,
  ) {
    if (!runId) return

    const id = positionId(position)
    if (!id) {
      setPositionErrorState(key, '缺少 investment position id')
      return
    }

    setPositionActionState(key, action)
    setPositionErrorState(key, null)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(
        `/api/import/runs/${encodeURIComponent(runId)}/investment-positions/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            actor: 'local',
            reason: `investment_position_${status}`,
          }),
        },
      )
      const payload = await readJson(res)

      if (!res.ok) {
        setPositionErrorState(key, responseError(res, payload, '投资持仓更新'))
        return
      }

      await loadRun(false)
    } catch {
      setPositionErrorState(key, '无法更新投资持仓')
    } finally {
      setPositionActionState(key, null)
    }
  }

  async function promoteRun() {
    if (!runId) return
    if (promoteBlockReason) {
      setError(`暂时无法提升：${promoteBlockReason}`)
      return
    }

    setPromoting(true)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(`/api/import/runs/${encodeURIComponent(runId)}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = await readJson(res)

      if (!res.ok) {
        setError(responseError(res, payload, '提升暂存记录'))
        return
      }

      setNotice(promoteNotice(payload))
      await loadRun(false)
    } catch {
      setError('无法提升暂存记录')
    } finally {
      setPromoting(false)
    }
  }

  async function validatePromotionRun() {
    if (!runId) return

    setValidatingPromotion(true)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(`/api/import/runs/${encodeURIComponent(runId)}/promote/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: validationPeriod || undefined }),
      })
      const payload = await readJson(res)

      if (!res.ok) {
        setError(responseError(res, payload, 'Beancount 预检'))
        return
      }

      setValidationNotice(promotionValidationNotice(payload))
    } catch {
      setError('无法运行 Beancount 预检')
    } finally {
      setValidatingPromotion(false)
    }
  }

  async function replayRun() {
    if (!runId) return

    setReplaying(true)
    setError(null)
    setNotice(null)
    setValidationNotice(null)
    setReplayNotice(null)

    try {
      const res = await fetch(`/api/import/runs/${encodeURIComponent(runId)}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'import_run_detail_replay' }),
      })
      const payload = await readJson(res)

      if (!res.ok) {
        setError(responseError(res, payload, '重放导入批次'))
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
      setError('无法重放导入批次')
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
      setRowErrorState(key, '缺少 staged row id')
      return
    }

    setRowActionState(key, action)
    setRowErrorState(key, null)
    setError(null)
    setNotice(null)
    setValidationNotice(null)

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
      setRowErrorState(key, `无法${label}暂存记录`)
    } finally {
      setRowActionState(key, null)
    }
  }

  async function saveRow(row: StagedRow, key: string) {
    const draft = drafts[key] ?? draftFromRow(row)

    await mutateStagedRow(row, key, 'save', '保存', {
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
    await mutateStagedRow(row, key, 'ignore', '忽略', { method: 'POST' }, '/ignore')
  }

  async function deleteRow(row: StagedRow, key: string) {
    await mutateStagedRow(row, key, 'delete', '删除', { method: 'DELETE' })
  }

  async function restoreRow(row: StagedRow, key: string) {
    await mutateStagedRow(row, key, 'restore', '恢复', { method: 'POST' }, '/restore')
  }

  async function resolvePendingRow(row: StagedRow, key: string, action: 'cancel_pending' | 'keep_pending') {
    await mutateStagedRow(
      row,
      key,
      action === 'cancel_pending' ? 'cancelPending' : 'keepPending',
      action === 'cancel_pending' ? '取消待处理' : '保留待处理',
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
    setValidationNotice(null)

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
          [sourceAccount.id]: responseError(res, payload, '来源账户映射更新'),
        }))
        return
      }

      await loadRun(false)
    } catch {
      setMappingErrors(prev => ({
        ...prev,
        [sourceAccount.id]: '无法更新来源账户映射',
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
          <h1 className="text-xl font-bold">暂存导入审核</h1>
          <p className="mt-1 text-sm text-slate-500">
            审核暂存记录，再将符合条件的交易送入 Beancount 准备流程。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/import"
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            返回导入
          </Link>
          <button
            onClick={() => loadRun(false)}
            disabled={loading || refreshing || promoting}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60"
          >
            {refreshing ? '刷新中...' : '刷新'}
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
              已提升 {notice.promoted} 条交易。
            </span>
            {notice.skipped > 0 && (
              <span className="text-xs opacity-75">
                {notice.skipped} 条已导入或已跳过。
              </span>
            )}
            {notice.errors.length > 0 && (
              <span>{notice.errors.length} 条失败，请查看详情。</span>
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
              仍有 {errorCount} 条记录存在校验错误。{' '}
              <button
                onClick={() => setStatusFilter('error')}
                className="underline hover:no-underline"
              >
                查看错误
              </button>
            </p>
          )}
          {notice.errors.length === 0 && unmappedSourceAccounts.length > 0 && (
            <p className="mt-2 text-xs">
              仍有 {unmappedSourceAccounts.length} 个来源账户未映射，请先完成映射。
            </p>
          )}
          {notice.errors.length > 0 && eligibleCount > 0 && (
            <p className="mt-2 text-xs">
              仍有 {eligibleCount} 条记录可提升，修正错误后可再次提升。
            </p>
          )}
        </div>
      )}

      {validationNotice && (
        <div className={`rounded-md border px-3 py-2 text-sm ${
          validationNotice.ok
            ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
            : 'border-amber-800 bg-amber-900/30 text-amber-200'
        }`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              {validationNotice.ok ? 'Beancount 预检通过' : 'Beancount 预检未通过'}。
            </span>
            <span className="text-xs opacity-80">月份 {validationNotice.period || validationPeriod}</span>
            <span className="text-xs opacity-80">
              dry-run 提升 {validationNotice.promotion.promoted} 条，跳过 {validationNotice.promotion.skipped} 条
            </span>
          </div>
          {validationNotice.validation && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-90">
              <span>阶段：{validationStageLabel(validationNotice.validation.stage)}</span>
              <span>可导出交易：{validationNotice.validation.summary.exportableTransactions}</span>
              <span>合并转账：{validationNotice.validation.summary.mergedTransfers}</span>
              <span>投资活动：{validationNotice.validation.summary.exportableInvestmentActivities}</span>
              <span>blocker：{validationNotice.validation.summary.blockers}</span>
              <span>review：{validationNotice.validation.summary.reviewItems}</span>
              {validationNotice.validation.summary.previouslyExported > 0 && (
                <span>已导出跳过：{validationNotice.validation.summary.previouslyExported}</span>
              )}
              {validationNotice.validation.checker && (
                <span>
                  checker：{stateLabel(validationNotice.validation.checker.status)}
                  （{validationNotice.validation.checker.mode}）
                </span>
              )}
            </div>
          )}
          {validationNotice.validation?.checker?.message && (
            <p className="mt-2 text-xs opacity-90">{validationNotice.validation.checker.message}</p>
          )}
          {validationNotice.promotion.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {validationNotice.promotion.errors.slice(0, 5).map((message, index) => (
                <li key={`promotion-validation-error-${index}`}>{message}</li>
              ))}
            </ul>
          )}
          {validationNotice.validation && validationNotice.validation.blockers.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {validationNotice.validation.blockers.slice(0, 5).map((message, index) => (
                <li key={`promotion-validation-blocker-${index}`}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {replayNotice && (
        <div className="rounded-md border border-blue-800 bg-blue-900/30 px-3 py-2 text-sm text-blue-100">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              已将 {replayNotice.rawReplayed} 条原始记录重放到新导入批次。
            </span>
            <span className="text-xs text-blue-200/80">
              已创建 {replayNotice.stagedReplayed} 条暂存记录。
            </span>
            <Link href={replayNotice.reviewUrl} className="text-xs font-medium underline hover:no-underline">
              打开重放批次
            </Link>
          </div>
          <div className="mt-1 font-mono text-xs text-blue-200/80">{replayNotice.importRunId}</div>
        </div>
      )}

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-5">
        {loading ? (
          <p className="text-sm text-slate-500">正在加载导入批次...</p>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase text-slate-500">批次</span>
                <span className="font-mono text-sm text-slate-300">{runInfo?.id ?? runId}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(runInfo?.status ?? 'unknown')}`}>
                  {stateLabel(runInfo?.status ?? 'unknown')}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {runInfo?.filename && <span>文件：{runInfo.filename}</span>}
                {runInfo?.source && <span>来源：{runInfo.source}</span>}
                {runInfo?.created && <span>创建时间：{runInfo.created}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-300">
                <span>预检月份</span>
                <input
                  type="month"
                  value={validationPeriod}
                  onChange={event => setValidationPeriod(event.target.value)}
                  disabled={loading || refreshing || promoting || validatingPromotion || replaying}
                  className="w-32 bg-transparent text-slate-100 outline-none disabled:opacity-60"
                />
              </label>
              <button
                onClick={validatePromotionRun}
                disabled={loading || refreshing || promoting || validatingPromotion || replaying || !runId}
                className="self-start rounded-md border border-amber-700 bg-amber-950/50 px-4 py-2 text-sm font-medium text-amber-100 hover:bg-amber-900/60 disabled:opacity-60 md:self-auto"
              >
                {validatingPromotion ? '预检中...' : 'Beancount 预检'}
              </button>
              <button
                onClick={replayRun}
                disabled={loading || refreshing || promoting || validatingPromotion || replaying || !runId}
                className="self-start rounded-md border border-blue-800 bg-blue-950/60 px-4 py-2 text-sm font-medium text-blue-100 hover:bg-blue-900/70 disabled:opacity-60 md:self-auto"
              >
                {replaying ? '重放中...' : '重放批次'}
              </button>
              <button
                onClick={promoteRun}
                disabled={loading || refreshing || promoting || validatingPromotion || replaying || !runId || Boolean(promoteBlockReason)}
                className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60 md:self-auto"
              >
                {promoting ? '提升中...' : `提升可用记录${eligibleCount ? ` (${eligibleCount})` : ''}`}
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
              <h2 className="text-sm font-semibold text-slate-100">来源账户映射</h2>
              <p className="mt-1 text-sm text-slate-400">
                {unmappedSourceAccounts.length > 0
                  ? `${unmappedSourceAccounts.length} 个来源账户需映射`
                  : '全部来源账户已映射'}
              </p>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-300">
              {sourceAccounts.length} 个来源账户
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
                      {sourceAccount.fintrackAccountId ? '已映射' : '未映射'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <select
                      value={sourceAccount.fintrackAccountId ?? ''}
                      onChange={event => updateSourceAccountMapping(sourceAccount, event.target.value)}
                      disabled={busy || accountsLoading}
                      className="h-9 w-full rounded border border-slate-600 bg-slate-900/70 px-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                    >
                      <option value="">{accountsLoading ? '账户加载中...' : '未映射账户'}</option>
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
              <p className="text-xs text-slate-400">{SUMMARY_LABELS[key]}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-100">
                {summary[key] ?? '-'}
              </p>
            </div>
          ))}
        </div>
      )}

      {securityMappingCounts.total > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-slate-700 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-300">证券映射</h2>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{securityMappingCounts.total} 个证券</span>
                <span>{securityMappingCounts.mapped} 已映射</span>
                <span>{securityMappingCounts.unmapped} 未映射</span>
                {suggestedSecurityMappingCount > 0 && <span>{suggestedSecurityMappingCount} 条建议</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {suggestedSecurityMappingCount > 0 && (
                <button
                  onClick={saveSuggestedSecurityMappings}
                  disabled={savingSuggestedSecurities || refreshing}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  {savingSuggestedSecurities ? '保存建议中...' : `保存建议 (${suggestedSecurityMappingCount})`}
                </button>
              )}
              <span className={`rounded-full border px-2 py-1 text-xs ${
                securityMappingCounts.unmapped > 0
                  ? 'border-amber-800 bg-amber-900/30 text-amber-200'
                  : 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
              }`}>
                {securityMappingCounts.unmapped > 0 ? '需映射' : '已映射'}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[120px_230px_230px_190px_220px_minmax(220px,1fr)_170px] gap-3 border-b border-slate-700 px-4 py-2 text-xs text-slate-500">
                <span>状态</span>
                <span>来源证券</span>
                <span>工具</span>
                <span>建议</span>
                <span>Beancount 商品</span>
                <span>活动</span>
                <span>操作</span>
              </div>
              {securityMappings.map((security, index) => {
                const key = securityKey(security, index)
                const status = securityMappingStatus(security)
                const busyAction = securityActions[key]
                const draft = securityCommodityDrafts[key] ?? ''
                const suggested = securitySuggestedCommodity(security)

                return (
                  <div
                    key={key}
                    className="grid grid-cols-[120px_230px_230px_190px_220px_minmax(220px,1fr)_170px] items-start gap-3 border-b border-slate-700 px-4 py-2 text-sm last:border-b-0"
                  >
                    <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs ${statusClass(status === 'mapped' ? 'reviewed' : 'needs_review')}`}>
                      <span className="truncate">{stateLabel(status)}</span>
                    </span>
                    <span>
                      <span className="block truncate text-slate-100">{securityDisplaySymbol(security)}</span>
                      <span className="mt-1 block truncate text-[11px] text-slate-500">{securityName(security)}</span>
                    </span>
                    <span className="truncate">{securityInstrumentLabel(security)}</span>
                    <span>
                      {suggested ? (
                        <button
                          onClick={() => updateSecurityCommodityDraft(key, suggested)}
                          disabled={Boolean(busyAction)}
                          className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                        >
                          {suggested}
                        </button>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </span>
                    <span>
                      <input
                        value={draft}
                        onChange={event => updateSecurityCommodityDraft(key, event.target.value)}
                        disabled={Boolean(busyAction)}
                        placeholder={suggested || 'AAPL'}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Beancount 商品"
                      />
                    </span>
                    <span className="text-slate-400">{securityActivitySummary(security)}</span>
                    <span className="space-y-1">
                      <span className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => updateSecurityMapping(security, key, 'save', draft.trim() || null)}
                          disabled={Boolean(busyAction)}
                          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                        >
                          {busyAction === 'save' ? securityMappingActionLabel(busyAction) : '保存'}
                        </button>
                        {securityCommodity(security) && (
                          <button
                            onClick={() => updateSecurityMapping(security, key, 'clear', null)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'clear' ? securityMappingActionLabel(busyAction) : '清除'}
                          </button>
                        )}
                      </span>
                      {securityErrors[key] && <span className="block text-xs text-red-200">{securityErrors[key]}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {investmentPositionCounts.total > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-slate-700 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-300">投资持仓</h2>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{investmentPositionCounts.total} 总计</span>
                <span>{investmentPositionCounts.blocked} 已阻止</span>
                <span>{investmentPositionCounts.needsReview} 需审核</span>
                <span>{investmentPositionCounts.reviewed} 已审核</span>
                <span>{investmentPositionCounts.ignored} 已忽略</span>
              </div>
            </div>
            <span className="rounded-full border border-amber-800 bg-amber-900/30 px-2 py-1 text-xs text-amber-200">
              持仓快照
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1320px]">
              <div className="grid grid-cols-[120px_230px_170px_130px_130px_130px_minmax(260px,1fr)_210px] gap-3 border-b border-slate-700 px-4 py-2 text-xs text-slate-500">
                <span>状态</span>
                <span>证券</span>
                <span>账户</span>
                <span>截至</span>
                <span>数量</span>
                <span>价值</span>
                <span>校验</span>
                <span>操作</span>
              </div>
              {investmentPositions.map((position, index) => {
                const key = positionKey(position, index)
                const status = positionStatus(position)
                const busyAction = positionActions[key]
                const validationErrors = positionValidationErrors(position)
                const account = stringValue(
                  getFirst(position, ['accountName', 'account_name']),
                  getFirst(position, ['sourceAccountName', 'source_account_name']),
                ) || '-'
                const asOfDate = dateInputValue(getFirst(position, ['asOfDate', 'as_of_date'])) || '-'
                const quantity = stringValue(getFirst(position, ['quantity'])) || '-'
                const marketValue = stringValue(getFirst(position, ['marketValue', 'market_value'])) || '-'
                const price = stringValue(getFirst(position, ['price']))
                const currency = stringValue(getFirst(position, ['currency']))
                const valueLabel = [marketValue, currency].filter(Boolean).join(' ')

                return (
                  <div
                    key={key}
                    className="grid grid-cols-[120px_230px_170px_130px_130px_130px_minmax(260px,1fr)_210px] items-start gap-3 border-b border-slate-700 px-4 py-2 text-sm last:border-b-0"
                  >
                    <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}>
                      <span className="truncate">{stateLabel(status)}</span>
                    </span>
                    <span>
                      <span className="block truncate text-slate-100">{positionSecurityLabel(position)}</span>
                      <span className="mt-1 block truncate text-[11px] text-slate-500">
                        {stringValue(getFirst(position, ['securityName', 'security_name'])) || '-'}
                      </span>
                    </span>
                    <span className="truncate">{account}</span>
                    <span className="tabular-nums">{asOfDate}</span>
                    <span className="tabular-nums">{quantity}</span>
                    <span>
                      <span className="block tabular-nums">{valueLabel || '-'}</span>
                      {price && <span className="mt-1 block tabular-nums text-[11px] text-slate-500">@ {price}</span>}
                    </span>
                    <span className={validationErrors === '-' ? 'text-slate-500' : 'text-red-200'}>
                      {validationErrors}
                    </span>
                    <span className="space-y-1">
                      <span className="flex flex-wrap gap-1.5">
                        {status !== 'reviewed' && (
                          <button
                            onClick={() => updateInvestmentPosition(position, key, 'review', 'reviewed')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                          >
                            {busyAction === 'review' ? investmentPositionActionLabel(busyAction) : '标记已审核'}
                          </button>
                        )}
                        {status !== 'ignored' && (
                          <button
                            onClick={() => updateInvestmentPosition(position, key, 'ignore', 'ignored')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'ignore' ? investmentPositionActionLabel(busyAction) : '忽略'}
                          </button>
                        )}
                        {status !== 'blocked' && (
                          <button
                            onClick={() => updateInvestmentPosition(position, key, 'block', 'blocked')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-amber-800 bg-amber-950/50 px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/70 disabled:opacity-60"
                          >
                            {busyAction === 'block' ? investmentPositionActionLabel(busyAction) : '阻止'}
                          </button>
                        )}
                      </span>
                      {positionErrors[key] && <span className="block text-xs text-red-200">{positionErrors[key]}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {investmentActivityCounts.total > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="flex flex-col gap-3 border-b border-slate-700 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-300">投资活动</h2>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>{investmentActivityCounts.total} 总计</span>
                <span>{investmentActivityCounts.blocked} 已阻止</span>
                <span>{investmentActivityCounts.needsReview} 需审核</span>
                <span>{investmentActivityCounts.reviewed} 已审核</span>
                <span>{investmentActivityCounts.ignored} 已忽略</span>
              </div>
            </div>
            <span className="rounded-full border border-amber-800 bg-amber-900/30 px-2 py-1 text-xs text-amber-200">
              Fidelity 暂存
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[1520px]">
              <div className="grid grid-cols-[120px_170px_230px_170px_130px_120px_160px_160px_minmax(260px,1fr)_210px] gap-3 border-b border-slate-700 px-4 py-2 text-xs text-slate-500">
                <span>状态</span>
                <span>活动</span>
                <span>证券</span>
                <span>账户</span>
                <span>交易日</span>
                <span>数量</span>
                <span>价格 / 金额</span>
                <span>期权</span>
                <span>校验</span>
                <span>操作</span>
              </div>
              {investmentActivities.map((activity, index) => {
                const key = activityKey(activity, index)
                const status = activityStatus(activity)
                const busyAction = investmentActions[key]
                const validationErrors = activityValidationErrors(activity)
                const account = stringValue(
                  getFirst(activity, ['accountName', 'account_name']),
                  getFirst(activity, ['sourceAccountName', 'source_account_name']),
                ) || '-'
                const tradeDate = dateInputValue(getFirst(activity, ['tradeDate', 'trade_date'])) || '-'
                const quantity = stringValue(getFirst(activity, ['quantity'])) || '-'
                const price = stringValue(getFirst(activity, ['price'])) || '-'
                const amount = stringValue(getFirst(activity, ['amount'])) || '-'
                const commission = stringValue(getFirst(activity, ['commission']))
                const fees = stringValue(getFirst(activity, ['fees']))
                const feeText = [commission ? `佣金 ${commission}` : '', fees ? `费用 ${fees}` : '']
                  .filter(Boolean)
                  .join(' / ')

                return (
                  <div
                    key={key}
                    className="grid grid-cols-[120px_170px_230px_170px_130px_120px_160px_160px_minmax(260px,1fr)_210px] items-start gap-3 border-b border-slate-700 px-4 py-2 text-sm last:border-b-0"
                  >
                    <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}>
                      <span className="truncate">{stateLabel(status)}</span>
                    </span>
                    <span>
                      <span className="block truncate text-slate-100">{activityLabel(activity)}</span>
                      <span className="mt-1 block truncate text-[11px] text-slate-500">
                        {activityDescription(activity)}
                      </span>
                    </span>
                    <span>
                      <span className="block truncate text-slate-100">{activitySecurityLabel(activity)}</span>
                      <span className="mt-1 block truncate text-[11px] text-slate-500">
                        {stringValue(getFirst(activity, ['securityName', 'security_name'])) || '-'}
                      </span>
                    </span>
                    <span className="truncate">{account}</span>
                    <span className="tabular-nums">{tradeDate}</span>
                    <span className="tabular-nums">{quantity}</span>
                    <span>
                      <span className="block tabular-nums">{price}</span>
                      <span className="mt-1 block tabular-nums text-[11px] text-slate-500">{amount}</span>
                    </span>
                    <span>
                      <span className="block truncate">{activityOptionLabel(activity)}</span>
                      {feeText && <span className="mt-1 block truncate text-[11px] text-slate-500">{feeText}</span>}
                    </span>
                    <span className={validationErrors === '-' ? 'text-slate-500' : 'text-red-200'}>
                      {validationErrors}
                    </span>
                    <span className="space-y-1">
                      <span className="flex flex-wrap gap-1.5">
                        {status !== 'reviewed' && (
                          <button
                            onClick={() => updateInvestmentActivity(activity, key, 'review', 'reviewed')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                          >
                            {busyAction === 'review' ? investmentActivityActionLabel(busyAction) : '标记已审核'}
                          </button>
                        )}
                        {status !== 'ignored' && (
                          <button
                            onClick={() => updateInvestmentActivity(activity, key, 'ignore', 'ignored')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'ignore' ? investmentActivityActionLabel(busyAction) : '忽略'}
                          </button>
                        )}
                        {status !== 'blocked' && (
                          <button
                            onClick={() => updateInvestmentActivity(activity, key, 'block', 'blocked')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-amber-800 bg-amber-950/50 px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/70 disabled:opacity-60"
                          >
                            {busyAction === 'block' ? investmentActivityActionLabel(busyAction) : '阻止'}
                          </button>
                        )}
                      </span>
                      {investmentErrors[key] && <span className="block text-xs text-red-200">{investmentErrors[key]}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-700 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-300">Ledger 准备记录</h2>
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
              <option value="all">全部来源账户</option>
              {sourceAccounts.map(sourceAccount => (
                <option key={sourceAccount.id} value={sourceAccount.id}>
                  {sourceAccountLabel(sourceAccount)}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">{displayedRows.length}/{rows.length} 条</span>
          </div>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">正在加载暂存记录...</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">此导入批次没有返回暂存记录。</p>
        ) : displayedRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">没有符合当前筛选的记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[2050px]">
              <div className="grid grid-cols-[100px_220px_130px_130px_minmax(260px,1fr)_180px_220px_190px_90px_minmax(220px,1fr)_190px] gap-3 border-b border-slate-700 px-4 py-2 text-xs text-slate-500">
                <span>状态</span>
                <span>账户</span>
                <span>日期</span>
                <span>金额</span>
                <span>描述</span>
                <span>Ledger 账户</span>
                <span>备注</span>
                <span>标签</span>
                <span>待处理</span>
                <span>校验</span>
                <span>操作</span>
              </div>
              {displayedRows.map((row, index) => {
                const key = rowKey(row, index)
                const status = rowStatus(row)
                const lifecycleState = rowLifecycleState(row)
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
                      <span className={`inline-flex max-w-full rounded-full border px-2 py-0.5 text-xs ${statusClass(lifecycleState)}`}>
                        <span className="truncate">{stateLabel(lifecycleState)}</span>
                      </span>
                      {status !== lifecycleState && (
                        <span className="mt-1 block truncate text-[11px] text-slate-500">{stateLabel(status)}</span>
                      )}
                    </span>
                    <span className="space-y-1">
                      <select
                        value={draft.accountId}
                        onChange={event => updateDraft(key, { accountId: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                      >
                        <option value="">{accountsLoading ? '账户加载中...' : '未匹配账户'}</option>
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
                        <span className="block truncate text-[11px] text-slate-500">来源：{sourceAccount}</span>
                      )}
                    </span>
                    <span>
                      <input
                        type="date"
                        value={draft.posted}
                        onChange={event => updateDraft(key, { posted: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="日期"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.amount}
                        onChange={event => updateDraft(key, { amount: event.target.value })}
                        disabled={disabled}
                        className={`${COMPACT_FIELD_CLASS} tabular-nums`}
                        aria-label="金额"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.description}
                        onChange={event => updateDraft(key, { description: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="描述"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.category}
                        onChange={event => updateDraft(key, { category: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="Ledger 账户"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.notes}
                        onChange={event => updateDraft(key, { notes: event.target.value })}
                        disabled={disabled}
                        className={COMPACT_FIELD_CLASS}
                        aria-label="备注"
                      />
                    </span>
                    <span>
                      <input
                        value={draft.tags}
                        onChange={event => updateDraft(key, { tags: event.target.value })}
                        disabled={disabled}
                        placeholder="标签1, 标签2"
                        className={COMPACT_FIELD_CLASS}
                        aria-label="标签"
                      />
                    </span>
                    <span className="flex h-8 items-center">
                      <input
                        type="checkbox"
                        checked={draft.pending}
                        onChange={event => updateDraft(key, { pending: event.target.checked })}
                        disabled={disabled}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="待处理"
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
                          {busyAction === 'restore' ? actionLabel : '恢复'}
                        </button>
                      ) : locked ? (
                        <span className="text-xs text-slate-500">已锁定</span>
                      ) : expiredPending ? (
                        <span className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => resolvePendingRow(row, key, 'cancel_pending')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-red-900 bg-red-950/50 px-2 py-1 text-xs text-red-200 hover:bg-red-900/70 disabled:opacity-60"
                          >
                            {busyAction === 'cancelPending' ? actionLabel : '取消待处理'}
                          </button>
                          <button
                            onClick={() => resolvePendingRow(row, key, 'keep_pending')}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'keepPending' ? actionLabel : '保留待处理'}
                          </button>
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => saveRow(row, key)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-60"
                          >
                            {busyAction === 'save' ? actionLabel : '保存'}
                          </button>
                          <button
                            onClick={() => ignoreRow(row, key)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                          >
                            {busyAction === 'ignore' ? actionLabel : '忽略'}
                          </button>
                          <button
                            onClick={() => deleteRow(row, key)}
                            disabled={Boolean(busyAction)}
                            className="rounded-md border border-red-900 bg-red-950/50 px-2 py-1 text-xs text-red-200 hover:bg-red-900/70 disabled:opacity-60"
                          >
                            {busyAction === 'delete' ? actionLabel : '删除'}
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
