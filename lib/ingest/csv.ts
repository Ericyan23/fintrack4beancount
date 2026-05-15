import { parseCsv, rowsToObjects } from '@/lib/csv'
import { buildSourceItemKey, type SourceItemKeyInput } from '@/lib/ingest/identity'
import type { IngestionJsonObject } from '@/lib/ingest/types'

export type CsvImportField =
  | 'date'
  | 'amount'
  | 'description'
  | 'account'
  | 'category'
  | 'notes'
  | 'tags'
  | 'status'
  | 'externalId'

export type CsvImportMapping = Partial<Record<CsvImportField, string>>
export type CsvTransactionStatus = 'posted' | 'pending' | 'cancelled'
export type CsvParserProfileId = 'fidelity-brokerage-csv'
export type CsvInvestmentActivityType =
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'cash_transfer'
  | 'other'

export interface CsvParserProfile {
  id: CsvParserProfileId
  name: string
  sourceName: string
  normalizerVersion: string
  mapping: CsvImportMapping
  blocksCashPromotion: boolean
}

export interface CsvInvestmentActivity extends IngestionJsonObject {
  profileId: CsvParserProfileId
  activityType: CsvInvestmentActivityType
  action: string
  symbol: string | null
  securityDescription: string | null
  securityType: string | null
  price: string | null
  quantity: string | null
  commission: string | null
  fees: string | null
  accruedInterest: string | null
  cashBalance: string | null
  settlementDate: string | null
}

export interface CsvNormalizerOptions {
  mapping?: CsvImportMapping
  parserProfileId?: string | null
  defaultAccountName?: string
  defaultExternalAccountId?: string
  sourceAccountId?: string
  /**
   * Backward-compatible alias while existing CSV import UI still speaks in account names.
   * New ingestion callers should prefer defaultAccountName plus a resolved sourceAccountId.
   */
  defaultAccount?: string
}

export interface CsvRawRowPayload extends IngestionJsonObject {
  rowNumber: number
  columns: string[]
  values: string[]
  row: Record<string, string>
}

export interface CsvNormalizedTransaction extends IngestionJsonObject {
  rowNumber: number
  posted: number | null
  date: string
  amount: string | null
  description: string
  accountName: string
  externalAccountId: string
  sourceAccountId: string | null
  pending: boolean
  status: CsvTransactionStatus
  category: string | null
  notes: string | null
  tags: string[]
  externalId: string | null
  sourceItemKey: string | null
  sourceItemIdentityInput: SourceItemKeyInput | null
  parserProfileId: CsvParserProfileId | null
  investmentActivity: CsvInvestmentActivity | null
  rawPayload: CsvRawRowPayload
  validationErrors: string[]
}

export interface CsvNormalizationResult {
  columns: string[]
  mapping: CsvImportMapping
  parserProfile: CsvParserProfile | null
  rows: CsvNormalizedTransaction[]
  totalRows: number
  validRows: number
  errorRows: number
}

export const CSV_PARSER_PROFILES: CsvParserProfile[] = [
  {
    id: 'fidelity-brokerage-csv',
    name: 'Fidelity Brokerage CSV',
    sourceName: 'Fidelity Brokerage CSV',
    normalizerVersion: 'fidelity-brokerage-csv-v1',
    mapping: {
      date: 'Run Date',
      amount: 'Amount ($)',
      description: 'Action',
    },
    blocksCashPromotion: true,
  },
]

const FIELD_MATCHERS: Record<CsvImportField, string[]> = {
  date: ['date', 'posted', 'transactiondate', 'transaction date', 'rundate', 'run date', 'transdate', 'trans date', 'postdate', 'post date', 'posteddate', 'posted date'],
  amount: ['amount', 'value'],
  description: ['description', 'name', 'merchant', 'payee', 'memo', 'action'],
  account: ['account', 'accountname', 'account name'],
  category: ['category'],
  notes: ['notes', 'note'],
  tags: ['tags', 'tag'],
  status: ['status', 'state'],
  externalId: ['id', 'transactionid', 'transaction id', 'externalid', 'external id'],
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '') // strip trailing currency notation like ($) or (USD)
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactHeader(header: string): string {
  return normalizeHeader(header).replace(/\s+/g, '')
}

export function getCsvParserProfile(profileId: string | null | undefined): CsvParserProfile | null {
  if (!profileId) return null
  return CSV_PARSER_PROFILES.find(profile => profile.id === profileId) ?? null
}

export function detectCsvParserProfile(columns: string[]): CsvParserProfile | null {
  const compactColumns = new Set(columns.map(compactHeader))
  const hasFidelityShape =
    compactColumns.has('rundate')
    && compactColumns.has('action')
    && compactColumns.has('amount')
    && compactColumns.has('settlementdate')
    && compactColumns.has('cashbalance')

  return hasFidelityShape ? getCsvParserProfile('fidelity-brokerage-csv') : null
}

export function detectCsvMapping(columns: string[], parserProfileId?: string | null): CsvImportMapping {
  const parserProfile = getCsvParserProfile(parserProfileId) ?? detectCsvParserProfile(columns)
  const mapping: CsvImportMapping = {}

  if (parserProfile) {
    Object.assign(mapping, parserProfile.mapping)
  }

  for (const field of Object.keys(FIELD_MATCHERS) as CsvImportField[]) {
    if (mapping[field]) continue
    const match = columns.find(column => {
      const normalized = normalizeHeader(column)
      const compact = compactHeader(column)
      return FIELD_MATCHERS[field].some(candidate => normalized === candidate || compact === candidate)
    })
    if (match) mapping[field] = match
  }

  return mapping
}

function cell(row: Record<string, string>, column?: string): string {
  return column ? (row[column] ?? '').trim() : ''
}

function normalizeAmount(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parenthesizedNegative = /^\(.*\)$/.test(trimmed)
  const unsignedText = parenthesizedNegative
    ? trimmed.slice(1, -1)
    : trimmed
  const cleaned = unsignedText.replace(/[,$\s]/g, '')
  if (!/^[+-]?(?:\d+|\d*\.\d+)$/.test(cleaned)) return null

  const explicitNegative = cleaned.startsWith('-')
  const explicitPositive = cleaned.startsWith('+')
  const unsignedAmount = explicitNegative || explicitPositive ? cleaned.slice(1) : cleaned
  const [rawWhole, fraction] = unsignedAmount.split('.')
  const whole = (rawWhole || '0').replace(/^0+(?=\d)/, '')
  const normalized = fraction === undefined ? whole : `${whole}.${fraction}`

  return parenthesizedNegative || explicitNegative ? `-${normalized}` : normalized
}

function parseDate(value: string): number | null {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed / 1000)
}

function normalizeStatus(value: string): CsvTransactionStatus {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'pending') return 'pending'
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled'
  return 'posted'
}

function splitTags(value: string): string[] {
  return value
    .split(/[|;]/)
    .map(tag => tag.trim())
    .filter(Boolean)
}

function fidelityActivityType(action: string): CsvInvestmentActivityType {
  const normalized = action.toUpperCase()
  if (/\bBOUGHT\b|\bBUY\b/.test(normalized)) return 'buy'
  if (/\bSOLD\b|\bSELL\b/.test(normalized)) return 'sell'
  if (/DIVIDEND|DIV/.test(normalized)) return 'dividend'
  if (/INTEREST/.test(normalized)) return 'interest'
  if (/FEE|COMMISSION/.test(normalized)) return 'fee'
  if (/TRANSFER|DIRECT DEPOSIT|EFT|ACH|CASH/.test(normalized)) return 'cash_transfer'
  return 'other'
}

function optionalCell(row: Record<string, string>, column: string): string | null {
  return cell(row, column) || null
}

function fidelityInvestmentActivity(
  row: Record<string, string>,
  parserProfile: CsvParserProfile | null,
): CsvInvestmentActivity | null {
  if (parserProfile?.id !== 'fidelity-brokerage-csv') return null

  const action = cell(row, 'Action')
  return {
    profileId: parserProfile.id,
    activityType: fidelityActivityType(action),
    action,
    symbol: optionalCell(row, 'Symbol'),
    securityDescription: optionalCell(row, 'Description'),
    securityType: optionalCell(row, 'Type'),
    price: normalizeAmount(cell(row, 'Price ($)')),
    quantity: optionalCell(row, 'Quantity'),
    commission: normalizeAmount(cell(row, 'Commission ($)')),
    fees: normalizeAmount(cell(row, 'Fees ($)')),
    accruedInterest: normalizeAmount(cell(row, 'Accrued Interest ($)')),
    cashBalance: normalizeAmount(cell(row, 'Cash Balance ($)')),
    settlementDate: optionalCell(row, 'Settlement Date'),
  }
}

export function buildCsvSourceItemKey(
  row: Pick<CsvNormalizedTransaction, 'sourceAccountId' | 'externalId' | 'date' | 'amount' | 'description'>,
  sourceAccountId = row.sourceAccountId,
): string | null {
  if (!sourceAccountId || row.amount === null || !row.date || !row.description) return null

  return buildSourceItemKey({
    sourceAccountId,
    externalId: row.externalId,
    date: row.date,
    amount: row.amount,
    description: row.description,
  })
}

export function normalizeCsvTransactions(
  csvText: string,
  options: CsvNormalizerOptions = {},
): CsvNormalizationResult {
  // Strip UTF-8 BOM and leading blank lines (common in Excel/Fidelity/Schwab exports)
  const cleaned = csvText.replace(/^﻿/, '').replace(/^[\r\n]+/, '')
  const parsed = parseCsv(cleaned)
  const columns = parsed[0] ?? []
  const objects = rowsToObjects(parsed)
  const bodyRows = parsed.slice(1).filter(row => row.some(cellValue => cellValue.trim() !== ''))
  const parserProfile = getCsvParserProfile(options.parserProfileId) ?? detectCsvParserProfile(columns)
  const mapping = { ...detectCsvMapping(columns, parserProfile?.id), ...options.mapping }

  let validRows = 0
  let errorRows = 0
  const rows = objects.flatMap((row, index) => {
    const rowNumber = index + 2
    const rawPayload: CsvRawRowPayload = {
      rowNumber,
      columns,
      values: bodyRows[index] ?? [],
      row,
    }
    const dateText = cell(row, mapping.date)
    const amountText = cell(row, mapping.amount)
    const description = cell(row, mapping.description)

    // Skip footer/disclaimer rows (e.g. Fidelity legal text at end of file)
    if (!amountText && !description) return []

    const posted = parseDate(dateText)
    const amount = normalizeAmount(amountText)
    const accountName = cell(row, mapping.account) || options.defaultAccountName || options.defaultAccount || ''
    const externalAccountId = options.defaultExternalAccountId || accountName
    const sourceAccountId = options.sourceAccountId ?? null
    const status = normalizeStatus(cell(row, mapping.status))
    const category = cell(row, mapping.category) || null
    const notes = cell(row, mapping.notes) || null
    const tags = splitTags(cell(row, mapping.tags))
    const externalId = cell(row, mapping.externalId) || null
    const investmentActivity = fidelityInvestmentActivity(row, parserProfile)
    const validationErrors: string[] = []

    if (posted === null) validationErrors.push('Invalid date')
    if (amount === null) validationErrors.push('Invalid amount')
    if (!description) validationErrors.push('Missing description')
    if (!accountName) validationErrors.push('Missing account')

    const sourceItemIdentityInput =
      posted === null || amount === null || !description || !sourceAccountId
        ? null
        : {
            sourceAccountId,
            externalId,
            date: dateText,
            amount,
            description,
          }
    const sourceItemKey = sourceItemIdentityInput
      ? buildCsvSourceItemKey({
          sourceAccountId,
          externalId,
          date: dateText,
          amount,
          description,
        })
      : null

    if (validationErrors.length === 0) validRows++
    else errorRows++

    return [{
      rowNumber,
      posted,
      date: dateText,
      amount,
      description,
      accountName,
      externalAccountId,
      sourceAccountId,
      pending: status === 'pending',
      status,
      category,
      notes,
      tags,
      externalId,
      sourceItemKey,
      sourceItemIdentityInput,
      parserProfileId: parserProfile?.id ?? null,
      investmentActivity,
      rawPayload,
      validationErrors,
    }]
  })

  return {
    columns,
    mapping,
    parserProfile,
    rows,
    totalRows: rows.length,
    validRows,
    errorRows,
  }
}
