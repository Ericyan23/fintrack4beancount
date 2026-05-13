import { createHash } from 'crypto'
import { parseCsv, rowsToObjects } from '@/lib/csv'
import { sqlite } from '@/lib/db'
import { reviewCategoryForAmount } from '@/lib/classify/defaults'

export type ImportField =
  | 'date'
  | 'amount'
  | 'description'
  | 'account'
  | 'category'
  | 'notes'
  | 'tags'
  | 'status'
  | 'externalId'

export type ImportMapping = Partial<Record<ImportField, string>>

export interface ImportPreviewRow {
  rowNumber: number
  date: string
  amount: string
  description: string
  account: string
  category: string
  status: string
  error?: string
}

export interface ImportPreviewResult {
  columns: string[]
  mapping: ImportMapping
  rows: ImportPreviewRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: Array<{ rowNumber: number; error: string }>
}

interface AccountLookup {
  byId: Map<string, string>
  byName: Map<string, string>
}

const FIELD_MATCHERS: Record<ImportField, string[]> = {
  date: ['date', 'posted', 'transactiondate', 'transaction date'],
  amount: ['amount', 'value'],
  description: ['description', 'name', 'merchant', 'payee', 'memo'],
  account: ['account', 'accountname', 'account name'],
  category: ['category'],
  notes: ['notes', 'note'],
  tags: ['tags', 'tag'],
  status: ['status', 'state'],
  externalId: ['id', 'transactionid', 'transaction id', 'externalid', 'external id'],
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ')
}

function compactHeader(header: string): string {
  return normalizeHeader(header).replace(/\s+/g, '')
}

export function detectMapping(columns: string[]): ImportMapping {
  const mapping: ImportMapping = {}

  for (const field of Object.keys(FIELD_MATCHERS) as ImportField[]) {
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

function parseAmount(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const negative = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[,$\s()]/g, '')
  const parsed = Number.parseFloat(cleaned)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

function parseDate(value: string): number | null {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed / 1000)
}

function normalizeStatus(value: string): 'posted' | 'pending' | 'cancelled' {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'pending') return 'pending'
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled'
  return 'posted'
}

function lookupAccounts(): AccountLookup {
  const rows = sqlite.prepare('SELECT id, name FROM accounts').all() as Array<{ id: string; name: string }>
  return {
    byId: new Map(rows.map(row => [row.id, row.name])),
    byName: new Map(rows.map(row => [row.name.trim().toLowerCase(), row.id])),
  }
}

function resolveAccount(value: string, defaultAccountId: string | undefined, lookup: AccountLookup): string | null {
  if (defaultAccountId) return lookup.byId.has(defaultAccountId) ? defaultAccountId : null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (lookup.byId.has(trimmed)) return trimmed
  return lookup.byName.get(trimmed.toLowerCase()) ?? null
}

function buildSyntheticId(accountId: string, posted: number, amount: number, description: string, externalId: string): string {
  if (externalId) return `csv:${externalId}`
  const hash = createHash('sha256')
    .update(`${accountId}|${posted}|${amount.toFixed(2)}|${description}`)
    .digest('hex')
    .slice(0, 32)
  return `csv:${hash}`
}

export function previewTransactionsCsv(
  csvText: string,
  mappingInput?: ImportMapping,
  defaultAccountId?: string,
): ImportPreviewResult {
  const parsed = parseCsv(csvText)
  const columns = parsed[0] ?? []
  const objects = rowsToObjects(parsed)
  const mapping = { ...detectMapping(columns), ...mappingInput }
  const lookup = lookupAccounts()

  let validRows = 0
  let errorRows = 0
  const rows = objects.slice(0, 50).map((row, index) => {
    const amountText = cell(row, mapping.amount)
    const dateText = cell(row, mapping.date)
    const description = cell(row, mapping.description)
    const accountText = cell(row, mapping.account)
    const category = cell(row, mapping.category)
    const status = normalizeStatus(cell(row, mapping.status))
    const amount = parseAmount(amountText)
    const posted = parseDate(dateText)
    const accountId = resolveAccount(accountText, defaultAccountId, lookup)

    let error: string | undefined
    if (!posted) error = 'Invalid date'
    else if (amount === null) error = 'Invalid amount'
    else if (!description) error = 'Missing description'
    else if (!accountId) error = 'Unable to match account'

    if (error) errorRows++
    else validRows++

    return {
      rowNumber: index + 2,
      date: dateText,
      amount: amountText,
      description,
      account: accountText || (defaultAccountId ? lookup.byId.get(defaultAccountId) ?? defaultAccountId : ''),
      category,
      status,
      error,
    }
  })

  // Count rows beyond the preview for summary accuracy.
  for (const row of objects.slice(50)) {
    const amount = parseAmount(cell(row, mapping.amount))
    const posted = parseDate(cell(row, mapping.date))
    const description = cell(row, mapping.description)
    const accountId = resolveAccount(cell(row, mapping.account), defaultAccountId, lookup)
    if (!posted || amount === null || !description || !accountId) errorRows++
    else validRows++
  }

  return {
    columns,
    mapping,
    rows,
    totalRows: objects.length,
    validRows,
    errorRows,
  }
}

export function importTransactionsCsv(
  csvText: string,
  mappingInput: ImportMapping,
  defaultAccountId?: string,
): ImportResult {
  const parsed = parseCsv(csvText)
  const objects = rowsToObjects(parsed)
  const mapping = { ...detectMapping(parsed[0] ?? []), ...mappingInput }
  const lookup = lookupAccounts()
  const now = Math.floor(Date.now() / 1000)
  const errors: ImportResult['errors'] = []
  let imported = 0
  let skipped = 0

  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, source, posted, transacted_at, amount, description, pending, status,
       category, suggested_cat, notes, tags, created_at)
    VALUES (?, ?, 'csv', ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `)

  const tx = sqlite.transaction(() => {
    objects.forEach((row, index) => {
      const rowNumber = index + 2
      const amount = parseAmount(cell(row, mapping.amount))
      const posted = parseDate(cell(row, mapping.date))
      const description = cell(row, mapping.description)
      const accountId = resolveAccount(cell(row, mapping.account), defaultAccountId, lookup)
      const status = normalizeStatus(cell(row, mapping.status))

      if (!posted) {
        errors.push({ rowNumber, error: 'Invalid date' })
        return
      }
      if (amount === null) {
        errors.push({ rowNumber, error: 'Invalid amount' })
        return
      }
      if (!description) {
        errors.push({ rowNumber, error: 'Missing description' })
        return
      }
      if (!accountId) {
        errors.push({ rowNumber, error: 'Unable to match account' })
        return
      }

      const tags = cell(row, mapping.tags)
        .split(/[|;]/)
        .map(tag => tag.trim())
        .filter(Boolean)
      const id = buildSyntheticId(accountId, posted, amount, description, cell(row, mapping.externalId))
      const category =
        cell(row, mapping.category) ||
        reviewCategoryForAmount(amount) ||
        null
      const result = insert.run(
        id,
        accountId,
        posted,
        amount.toFixed(2),
        description,
        status === 'pending' ? 1 : 0,
        status,
        status === 'posted' ? category : cell(row, mapping.category) || null,
        cell(row, mapping.notes) || null,
        JSON.stringify(tags),
        now,
      )

      if (result.changes > 0) imported++
      else skipped++
    })
  })

  tx()
  return { imported, skipped, errors }
}
