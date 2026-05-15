import { randomUUID } from 'crypto'
import { sqlite } from '@/lib/db'
import type { IngestionJsonObject } from '@/lib/ingest/types'

export interface ManualTransactionInput {
  accountId: string
  posted?: number
  postedDate?: string
  amount: string
  description: string
  ledgerAccount?: string | null
  notes?: string | null
  tags?: string[] | null
  actor?: string | null
  createReason?: string | null
}

export interface ManualTransaction {
  id: string
  accountId: string
  sourceConnectionId: string | null
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string | null
  importRunId: string | null
  rawItemId: string | null
  normalizerVersion: string | null
  source: string
  posted: number
  transactedAt: number | null
  amount: string
  description: string
  pending: boolean
  status: string
  category: string | null
  suggestedCat: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  suggestedLedgerAccount: string | null
  classifier: string | null
  confidence: number | null
  suggestedAt: number | null
  notes: string | null
  tags: string[]
  createdAt: number
  updatedAt: number | null
  updatedBy: string | null
}

export interface ManualTransactionCreateResult {
  transaction: ManualTransaction
  auditLogId: number
}

interface AccountRow {
  id: string
}

interface TransactionRow {
  id: string
  accountId: string
  sourceConnectionId: string | null
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string | null
  importRunId: string | null
  rawItemId: string | null
  normalizerVersion: string | null
  source: string
  posted: number
  transactedAt: number | null
  amount: string
  description: string
  pending: number
  status: string
  category: string | null
  suggestedCat: string | null
  ledgerAccount: string | null
  reviewStatus: string | null
  suggestedLedgerAccount: string | null
  classifier: string | null
  confidence: number | null
  suggestedAt: number | null
  notes: string | null
  tags: string | null
  createdAt: number
  updatedAt: number | null
  updatedBy: string | null
}

export class ManualTransactionValidationError extends Error {
  validationErrors: string[]
  status = 400

  constructor(validationErrors: string[]) {
    super(validationErrors.join(', ') || 'Invalid manual transaction')
    this.name = 'ManualTransactionValidationError'
    this.validationErrors = validationErrors
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function actorLabel(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? 'local'
}

function parsePosted(input: Pick<ManualTransactionInput, 'posted' | 'postedDate'>): number | null {
  if (typeof input.posted === 'number' && Number.isFinite(input.posted)) {
    const posted = Math.floor(input.posted)
    return posted > 0 ? posted : null
  }

  const value = normalizeOptionalText(input.postedDate)
  if (!value) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
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

function normalizeAmount(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parenthesizedNegative = /^\(.*\)$/.test(trimmed)
  const unsignedText = parenthesizedNegative ? trimmed.slice(1, -1) : trimmed
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

function normalizeTags(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return []

  const tags: string[] = []
  const seen = new Set<string>()
  for (const tag of value) {
    if (typeof tag !== 'string') continue
    const trimmed = tag.trim()
    if (!trimmed || seen.has(trimmed)) continue
    tags.push(trimmed)
    seen.add(trimmed)
  }
  return tags
}

function parseJsonStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function selectAccount(id: string): AccountRow | null {
  const row = sqlite.prepare(`
    SELECT id
    FROM accounts
    WHERE id = ?
  `).get(id) as AccountRow | undefined

  return row ?? null
}

function mapTransaction(row: TransactionRow): ManualTransaction {
  return {
    ...row,
    pending: Boolean(row.pending),
    tags: parseJsonStringArray(row.tags),
  }
}

function selectTransaction(id: string): ManualTransaction {
  const row = sqlite.prepare(`
    SELECT
      id,
      account_id AS accountId,
      source_connection_id AS sourceConnectionId,
      source_account_id AS sourceAccountId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      import_run_id AS importRunId,
      raw_item_id AS rawItemId,
      normalizer_version AS normalizerVersion,
      source,
      posted,
      transacted_at AS transactedAt,
      amount,
      description,
      pending,
      status,
      category,
      suggested_cat AS suggestedCat,
      ledger_account AS ledgerAccount,
      review_status AS reviewStatus,
      suggested_ledger_account AS suggestedLedgerAccount,
      classifier,
      confidence,
      suggested_at AS suggestedAt,
      notes,
      tags,
      created_at AS createdAt,
      updated_at AS updatedAt,
      updated_by AS updatedBy
    FROM transactions
    WHERE id = ?
  `).get(id) as TransactionRow | undefined

  if (!row) {
    throw new Error(`Manual transaction was not created: ${id}`)
  }

  return mapTransaction(row)
}

function transactionSnapshot(row: ManualTransaction): IngestionJsonObject {
  return {
    id: row.id,
    accountId: row.accountId,
    sourceConnectionId: row.sourceConnectionId,
    sourceAccountId: row.sourceAccountId,
    externalId: row.externalId,
    source: row.source,
    importRunId: row.importRunId,
    rawItemId: row.rawItemId,
    normalizerVersion: row.normalizerVersion,
    sourceItemKey: row.sourceItemKey,
    posted: row.posted,
    transactedAt: row.transactedAt,
    amount: row.amount,
    description: row.description,
    pending: row.pending,
    status: row.status,
    category: row.category,
    suggestedCat: row.suggestedCat,
    ledgerAccount: row.ledgerAccount,
    reviewStatus: row.reviewStatus,
    suggestedLedgerAccount: row.suggestedLedgerAccount,
    classifier: row.classifier,
    confidence: row.confidence,
    suggestedAt: row.suggestedAt,
    notes: row.notes,
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

export function createManualTransaction(input: ManualTransactionInput): ManualTransactionCreateResult {
  const accountId = normalizeOptionalText(input.accountId)
  const posted = parsePosted(input)
  const amount = normalizeAmount(input.amount)
  const description = normalizeOptionalText(input.description)
  const ledgerAccount = normalizeOptionalText(input.ledgerAccount)
  const notes = normalizeOptionalText(input.notes)
  const tags = normalizeTags(input.tags)
  const actor = actorLabel(input.actor)
  const reason = normalizeOptionalText(input.createReason) ?? 'transaction_manual_create'

  const validationErrors: string[] = []
  if (!accountId) validationErrors.push('accountId is required')
  if (!posted) validationErrors.push('postedDate must be a valid YYYY-MM-DD date')
  if (!amount) validationErrors.push('amount must be a decimal string')
  if (!description) validationErrors.push('description is required')
  if (accountId && !selectAccount(accountId)) validationErrors.push('accountId was not found')

  if (validationErrors.length > 0 || !accountId || !posted || !amount || !description) {
    throw new ManualTransactionValidationError(validationErrors)
  }

  const id = randomUUID()
  const sourceItemKey = `manual:${id}`
  const timestamp = Math.floor(Date.now() / 1000)
  const reviewStatus = ledgerAccount ? 'reviewed' : 'needs_review'
  let auditLogId = 0

  const transaction = sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO transactions (
        id,
        account_id,
        source_connection_id,
        source_account_id,
        external_id,
        source_item_key,
        import_run_id,
        raw_item_id,
        normalizer_version,
        source,
        posted,
        transacted_at,
        amount,
        description,
        pending,
        status,
        category,
        suggested_cat,
        ledger_account,
        review_status,
        suggested_ledger_account,
        classifier,
        confidence,
        suggested_at,
        notes,
        tags,
        created_at,
        updated_at,
        updated_by
      )
      VALUES (?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, 0, 'posted', ?, NULL, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?)
    `).run(
      id,
      accountId,
      sourceItemKey,
      'manual',
      posted,
      posted,
      amount,
      description,
      ledgerAccount,
      ledgerAccount,
      reviewStatus,
      'manual_create',
      notes,
      JSON.stringify(tags),
      timestamp,
      timestamp,
      actor,
    )

    const created = selectTransaction(id)
    const afterValues = { transaction: transactionSnapshot(created) }
    const metadata = {
      source: 'manual',
      sourceItemKey,
      accountId,
    }

    const auditResult = sqlite.prepare(`
      INSERT INTO audit_log (
        entity_type,
        entity_id,
        action,
        actor,
        reason,
        before_values,
        after_values,
        metadata,
        created_at
      )
      VALUES ('transaction', ?, 'transaction_manual_create', ?, ?, '{}', ?, ?, ?)
    `).run(
      id,
      actor,
      reason,
      JSON.stringify(afterValues),
      JSON.stringify(metadata),
      timestamp,
    )
    auditLogId = Number(auditResult.lastInsertRowid)

    return created
  })()

  return { transaction, auditLogId }
}
