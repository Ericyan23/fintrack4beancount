import { sqlite } from '@/lib/db'
import {
  normalizeCsvTransactions,
  type CsvImportMapping,
  type CsvNormalizedTransaction,
} from '@/lib/ingest/csv'

export type CsvPreviewMapping = CsvImportMapping

export interface CsvPreviewRow {
  rowNumber: number
  date: string
  amount: string
  description: string
  account: string
  category: string
  status: string
  error?: string
}

export interface CsvPreviewResult {
  columns: string[]
  mapping: CsvImportMapping
  rows: CsvPreviewRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

interface AccountRow {
  id: string
  name: string
}

interface AccountLookup {
  byId: Map<string, AccountRow>
  byName: Map<string, AccountRow>
}

function lookupAccounts(): AccountLookup {
  const rows = sqlite.prepare('SELECT id, name FROM accounts').all() as AccountRow[]
  return {
    byId: new Map(rows.map(row => [row.id, row])),
    byName: new Map(rows.map(row => [row.name.trim().toLowerCase(), row])),
  }
}

function resolveAccount(row: CsvNormalizedTransaction, defaultAccountId: string | undefined, lookup: AccountLookup): AccountRow | null {
  if (defaultAccountId) return lookup.byId.get(defaultAccountId) ?? null
  const accountName = row.accountName.trim()
  if (!accountName) return null
  return lookup.byId.get(accountName) ?? lookup.byName.get(accountName.toLowerCase()) ?? null
}

function previewError(row: CsvNormalizedTransaction, account: AccountRow | null): string | undefined {
  if (row.posted === null) return 'Invalid date'
  if (row.amount === null) return 'Invalid amount'
  if (!row.description) return 'Missing description'
  if (!account) return 'Unable to match account'
  return undefined
}

export function previewTransactionsCsv(
  csvText: string,
  mappingInput?: CsvImportMapping,
  defaultAccountId?: string,
  defaultLedgerAccount?: string,
): CsvPreviewResult {
  const lookup = lookupAccounts()
  const defaultAccount = defaultAccountId ? lookup.byId.get(defaultAccountId) ?? null : null
  const normalized = normalizeCsvTransactions(csvText, {
    mapping: mappingInput,
    defaultAccountName: defaultAccount?.name,
    defaultExternalAccountId: defaultAccount?.id,
  })

  let validRows = 0
  let errorRows = 0
  const rows = normalized.rows.map(row => {
    const account = resolveAccount(row, defaultAccountId, lookup)
    const error = previewError(row, account)
    const category = row.category ?? defaultLedgerAccount ?? ''
    if (error) errorRows++
    else validRows++

    return {
      rowNumber: row.rowNumber,
      date: row.date,
      amount: row.amount ?? '',
      description: row.description,
      account: row.accountName || account?.name || '',
      category,
      status: row.status,
      error,
    }
  })

  return {
    columns: normalized.columns,
    mapping: normalized.mapping,
    rows: rows.slice(0, 50),
    totalRows: normalized.totalRows,
    validRows,
    errorRows,
  }
}
