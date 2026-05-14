import { createHash } from 'crypto'
import { sqlite } from '@/lib/db'
import {
  buildSimpleFinSourceAccountId,
  normalizeSimpleFinPayload,
  SIMPLEFIN_NORMALIZER_VERSION,
  simpleFinUnixDate,
  type SimpleFinAccountPayload,
  type SimpleFinPayload,
  type SimpleFinPayloadError,
  type SimpleFinTransactionPayload,
} from '@/lib/ingest/simplefin'
import { stableStringify } from '@/lib/ingest/identity'
import {
  createImportRun,
  ensureSource,
  ensureSourceAccount,
  ensureSourceConnection,
  finishImportRun,
  insertRawImportItem,
  insertStagedTransaction,
} from '@/lib/ingest/store'
import type { IngestionJsonObject, NormalizedTransaction } from '@/lib/ingest/types'

export interface StageSimpleFinPayloadOptions {
  sourceConnectionId: string
  sourceConnectionName?: string
  sourceName?: string
  normalizerVersion?: string
  config?: IngestionJsonObject | null
}

export interface StageSimpleFinPayloadResult {
  importRunId: string
  accounts: number
  balances: number
  transactions: number
  errors: number
  validationErrors: number
  rawInserted: number
  staged: number
  merged: number
  duplicates: number
}

function dateToUnixSeconds(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

function normalizedPayload(transaction: NormalizedTransaction): IngestionJsonObject {
  return {
    sourceConnectionId: transaction.sourceConnectionId,
    sourceAccountId: transaction.sourceAccountId,
    accountId: transaction.accountId ?? null,
    externalId: transaction.externalId ?? null,
    sourceItemKey: transaction.sourceItemKey,
    date: transaction.date,
    transactedAt: transaction.transactedAt ?? null,
    amount: transaction.amount,
    currency: transaction.currency ?? null,
    description: transaction.description,
    pending: transaction.pending ?? false,
    status: transaction.status ?? null,
    rawPayload: transaction.rawPayload,
  }
}

function errorSummary(errors: SimpleFinPayloadError[]): string | null {
  if (errors.length === 0) return null
  return `${errors.length} SimpleFIN normalization error(s)`
}

function requiredValidationErrors(transaction: NormalizedTransaction, accountId: string | null): string[] {
  const errors: string[] = []
  if (!accountId) errors.push('Missing required field: account_id')
  if (!transaction.sourceConnectionId) errors.push('Missing required field: source_connection_id')
  if (!transaction.sourceAccountId) errors.push('Missing required field: source_account_id')
  if (!transaction.sourceItemKey) errors.push('Missing required field: source_item_key')
  if (!transaction.date) errors.push('Missing required field: posted')
  if (!transaction.amount) errors.push('Missing required field: amount')
  if (!transaction.description) errors.push('Missing required field: description')
  return errors
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeSimpleFinConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSimpleFinConfigValue)
  if (!isRecord(value)) return value

  const sanitized: IngestionJsonObject = {}
  for (const [key, item] of Object.entries(value)) {
    if (/access[_-]?url|authorization|password|secret|token|auth/i.test(key)) {
      sanitized[key] = '[redacted]'
    } else {
      sanitized[key] = sanitizeSimpleFinConfigValue(item)
    }
  }
  return sanitized
}

function sanitizeSimpleFinConfig(config: IngestionJsonObject | null | undefined): IngestionJsonObject | null {
  if (!config) return null
  return sanitizeSimpleFinConfigValue(config) as IngestionJsonObject
}

function invalidRawSourceItemKey(rawPayload: IngestionJsonObject): string {
  const digest = createHash('sha256')
    .update(stableStringify(rawPayload))
    .digest('hex')
    .slice(0, 32)
  return `simplefin-invalid:${digest}`
}

function transactionObjectSet(transactions: NormalizedTransaction[]): WeakSet<object> {
  const seen = new WeakSet<object>()
  for (const transaction of transactions) {
    const rawTransaction = transaction.rawPayload.transaction
    if (isRecord(rawTransaction)) seen.add(rawTransaction)
  }
  return seen
}

function transactionAmount(value: unknown): string | null {
  return typeof value === 'string' && /^[+-]?(?:\d+|\d*\.\d+)$/.test(value.trim()) ? value.trim() : null
}

function transactionDescription(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function invalidTransactionValidationErrors(
  account: SimpleFinAccountPayload,
  transaction: SimpleFinTransactionPayload,
  sourceAccountId: string | null,
): string[] {
  const errors: string[] = []
  if (!sourceAccountId) errors.push('Missing required field: source_account_id')
  errors.push('Missing required field: source_item_key')
  if (!transaction.id) errors.push('Missing required field: external_id')
  if (!simpleFinUnixDate(transaction.posted) && !simpleFinUnixDate(transaction['transacted-at'])) {
    errors.push('Missing required field: posted')
  }
  if (!transactionAmount(transaction.amount)) errors.push('Missing required field: amount')
  if (!transactionDescription(transaction.description)) errors.push('Missing required field: description')
  if (!account.id) errors.push('Missing required field: source account external id')
  return errors
}

function dateToRawUnixSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

function findExistingAccountId(externalAccountId: string): string | null {
  const row = sqlite.prepare(`
    SELECT id
    FROM accounts
    WHERE id = ?
    LIMIT 1
  `).get(externalAccountId) as { id: string } | undefined

  return row?.id ?? null
}

function findExistingSimpleFinTransaction(accountId: string | null, externalId: string | null): string | null {
  if (!accountId || !externalId) return null

  const row = sqlite.prepare(`
    SELECT id
    FROM transactions
    WHERE account_id = ?
      AND source = 'simplefin'
      AND (id = ? OR external_id = ?)
    LIMIT 1
  `).get(accountId, externalId, externalId) as { id: string } | undefined

  return row?.id ?? null
}

export function stageSimpleFinPayload(
  payload: SimpleFinPayload,
  options: StageSimpleFinPayloadOptions,
): StageSimpleFinPayloadResult {
  const source = ensureSource({
    id: 'simplefin',
    kind: 'simplefin',
    name: options.sourceName ?? 'SimpleFIN',
  })
  const connection = ensureSourceConnection({
    id: options.sourceConnectionId,
    sourceId: source.id,
    name: options.sourceConnectionName ?? 'SimpleFIN Connection',
    config: sanitizeSimpleFinConfig(options.config),
  })
  const run = createImportRun({
    sourceConnectionId: connection.id,
  })
  const normalized = normalizeSimpleFinPayload(payload, {
    sourceConnectionId: connection.id,
    normalizerVersion: options.normalizerVersion ?? SIMPLEFIN_NORMALIZER_VERSION,
  })

  const sourceAccountsById = new Map(
    normalized.accounts.map(account => {
      const sourceAccount = ensureSourceAccount({
        id: account.sourceAccountId,
        sourceConnectionId: connection.id,
        fintrackAccountId: findExistingAccountId(account.externalAccountId),
        externalAccountId: account.externalAccountId,
        name: account.name,
        currency: account.currency ?? null,
        rawPayload: account.rawPayload ?? null,
      })

      return [sourceAccount.id, sourceAccount]
    }),
  )

  let rawInserted = 0
  let staged = 0
  let merged = 0
  let duplicates = 0
  let validationErrors = 0
  const normalizedTransactionObjects = transactionObjectSet(normalized.transactions)

  for (const account of payload.accounts ?? []) {
    const externalAccountId = typeof account.id === 'string' && account.id.trim() ? account.id.trim() : null
    const sourceAccountId = externalAccountId
      ? buildSimpleFinSourceAccountId(connection.id, externalAccountId)
      : null
    const sourceAccount = sourceAccountId ? sourceAccountsById.get(sourceAccountId) ?? null : null

    for (const transaction of account.transactions ?? []) {
      if (normalizedTransactionObjects.has(transaction)) continue

      const rawPayload: IngestionJsonObject = {
        accountId: externalAccountId,
        transaction,
      }
      const rowValidationErrors = invalidTransactionValidationErrors(account, transaction, sourceAccountId)
      const raw = insertRawImportItem({
        importRunId: run.id,
        sourceAccountId: sourceAccount?.id ?? sourceAccountId,
        externalId: transaction.id ?? null,
        sourceItemKey: invalidRawSourceItemKey(rawPayload),
        rawPayload,
        status: 'error',
      })

      if (raw.status === 'duplicate') {
        duplicates++
        continue
      }

      rawInserted++
      validationErrors += rowValidationErrors.length
      insertStagedTransaction({
        importRunId: run.id,
        rawItemId: raw.item.id,
        sourceConnectionId: connection.id,
        sourceAccountId: sourceAccount?.id ?? sourceAccountId,
        accountId: sourceAccount?.fintrackAccountId ?? null,
        externalId: transaction.id ?? null,
        sourceItemKey: null,
        posted: dateToRawUnixSeconds(transaction.posted) ?? dateToRawUnixSeconds(transaction['transacted-at']),
        transactedAt: dateToRawUnixSeconds(transaction['transacted-at']),
        amount: transactionAmount(transaction.amount),
        currency: typeof account.currency === 'string' ? account.currency : null,
        description: transactionDescription(transaction.description),
        pending: transaction.pending ?? false,
        status: 'error',
        normalizedPayload: {
          rawPayload,
          invalid: true,
        },
        validationErrors: rowValidationErrors,
        normalizerVersion: options.normalizerVersion ?? SIMPLEFIN_NORMALIZER_VERSION,
      })
    }
  }

  for (const transaction of normalized.transactions) {
    const sourceAccount = sourceAccountsById.get(transaction.sourceAccountId) ?? null
    const accountId = sourceAccount?.fintrackAccountId ?? transaction.accountId ?? null
    const existingTransactionId = findExistingSimpleFinTransaction(accountId, transaction.externalId ?? null)
    const rowValidationErrors = requiredValidationErrors(transaction, accountId)
    const raw = insertRawImportItem({
      importRunId: run.id,
      sourceAccountId: sourceAccount?.id ?? transaction.sourceAccountId,
      externalId: transaction.externalId ?? null,
      sourceItemKey: transaction.sourceItemKey,
      rawPayload: transaction.rawPayload,
      status: rowValidationErrors.length > 0 ? 'error' : 'staged',
    })

    if (raw.status === 'duplicate') {
      duplicates++
      continue
    }

    rawInserted++
    validationErrors += rowValidationErrors.length
    insertStagedTransaction({
      importRunId: run.id,
      rawItemId: raw.item.id,
      sourceConnectionId: connection.id,
      sourceAccountId: sourceAccount?.id ?? transaction.sourceAccountId,
      accountId,
      transactionId: existingTransactionId,
      externalId: transaction.externalId ?? null,
      sourceItemKey: transaction.sourceItemKey,
      posted: dateToUnixSeconds(transaction.date),
      transactedAt: dateToUnixSeconds(transaction.transactedAt),
      amount: transaction.amount,
      currency: transaction.currency ?? null,
      description: transaction.description,
      pending: transaction.pending ?? false,
      status: existingTransactionId ? 'merged' : rowValidationErrors.length > 0 ? 'error' : 'staged',
      normalizedPayload: normalizedPayload(transaction),
      validationErrors: rowValidationErrors,
      normalizerVersion: transaction.normalizerVersion ?? SIMPLEFIN_NORMALIZER_VERSION,
    })
    if (existingTransactionId) merged++
    else if (rowValidationErrors.length === 0) staged++
  }

  finishImportRun({
    id: run.id,
    status: 'completed',
    error: errorSummary(normalized.errors) ?? (
      validationErrors > 0 ? `${validationErrors} staged validation error(s)` : null
    ),
  })

  return {
    importRunId: run.id,
    accounts: normalized.accounts.length,
    balances: normalized.balances.length,
    transactions: normalized.transactions.length,
    errors: normalized.errors.length,
    validationErrors,
    rawInserted,
    staged,
    merged,
    duplicates,
  }
}
