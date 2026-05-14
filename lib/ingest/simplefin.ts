import { detectAccountType } from '@/lib/accounts'
import { buildSourceItemKey } from '@/lib/ingest/identity'
import type {
  IngestionJsonObject,
  NormalizedAccount,
  NormalizedBalance,
  NormalizedTransaction,
} from '@/lib/ingest/types'

export const SIMPLEFIN_NORMALIZER_VERSION = 'simplefin-v1'

export interface SimpleFinOrgPayload extends IngestionJsonObject {
  domain?: string
  name?: string
}

export interface SimpleFinTransactionPayload extends IngestionJsonObject {
  id?: string
  posted?: number
  'transacted-at'?: number
  amount?: string
  description?: string
  pending?: boolean
}

export interface SimpleFinAccountPayload extends IngestionJsonObject {
  id?: string
  name?: string
  currency?: string
  balance?: string
  'balance-date'?: number
  org?: SimpleFinOrgPayload
  transactions?: SimpleFinTransactionPayload[]
}

export interface SimpleFinPayloadError extends IngestionJsonObject {
  code: string
  message: string
  accountId?: string
  transactionId?: string
}

export interface SimpleFinPayload extends IngestionJsonObject {
  accounts?: SimpleFinAccountPayload[]
  errors?: SimpleFinPayloadError[]
  errlist?: Array<{
    code?: string
    msg?: string
    message?: string
  }>
}

export interface SimpleFinNormalizationOptions {
  sourceConnectionId: string
  normalizerVersion?: string
}

export interface SimpleFinNormalizationResult {
  accounts: NormalizedAccount[]
  balances: NormalizedBalance[]
  transactions: NormalizedTransaction[]
  errors: SimpleFinPayloadError[]
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function decimalString(value: unknown): string | null {
  const text = stringValue(value)
  return text && /^[+-]?(?:\d+|\d*\.\d+)$/.test(text) ? text : null
}

function unixSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.floor(value)
}

export function simpleFinUnixDate(value: unknown): string | null {
  const seconds = unixSeconds(value)
  if (seconds === null) return null
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

export function buildSimpleFinSourceAccountId(
  sourceConnectionId: string,
  externalAccountId: string,
): string {
  const connectionPart = stringValue(sourceConnectionId)
  if (!connectionPart) {
    throw new Error('SimpleFIN normalization requires a stable sourceConnectionId')
  }
  return `simplefin:${encodeURIComponent(connectionPart)}:account:${encodeURIComponent(externalAccountId)}`
}

function normalizeProviderErrors(payload: SimpleFinPayload): SimpleFinPayloadError[] {
  const errors: SimpleFinPayloadError[] = []

  for (const error of payload.errors ?? []) {
    errors.push({
      code: stringValue(error.code) ?? 'simplefin_error',
      message: stringValue(error.message) ?? 'SimpleFIN returned an error',
    })
  }

  for (const error of payload.errlist ?? []) {
    errors.push({
      code: stringValue(error.code) ?? 'simplefin_error',
      message: stringValue(error.message) ?? stringValue(error.msg) ?? 'SimpleFIN returned an error',
    })
  }

  return errors
}

function normalizeTransaction(
  account: SimpleFinAccountPayload,
  transaction: SimpleFinTransactionPayload,
  options: Required<Pick<SimpleFinNormalizationOptions, 'normalizerVersion'>> & {
    sourceConnectionId: string
  },
  errors: SimpleFinPayloadError[],
): NormalizedTransaction | null {
  const externalAccountId = stringValue(account.id)
  if (!externalAccountId) {
    errors.push({
      code: 'invalid_account',
      message: 'SimpleFIN account is missing id',
    })
    return null
  }

  const sourceAccountId = buildSimpleFinSourceAccountId(options.sourceConnectionId, externalAccountId)
  const postedDate = simpleFinUnixDate(transaction.posted)
  const transactedAt = simpleFinUnixDate(transaction['transacted-at'])
  const date = postedDate ?? transactedAt
  const amount = decimalString(transaction.amount)
  const description = stringValue(transaction.description)
  const externalId = stringValue(transaction.id)
  const rawPayload: IngestionJsonObject = {
    accountId: externalAccountId,
    transaction,
  }

  if (!date) {
    errors.push({
      code: 'invalid_transaction_date',
      message: 'SimpleFIN transaction is missing posted or transacted date',
      accountId: externalAccountId,
      transactionId: externalId ?? undefined,
    })
  }
  if (amount === null) {
    errors.push({
      code: 'invalid_transaction_amount',
      message: 'SimpleFIN transaction amount is missing or invalid',
      accountId: externalAccountId,
      transactionId: externalId ?? undefined,
    })
  }
  if (!description) {
    errors.push({
      code: 'invalid_transaction_description',
      message: 'SimpleFIN transaction description is missing',
      accountId: externalAccountId,
      transactionId: externalId ?? undefined,
    })
  }
  if (!externalId) {
    errors.push({
      code: 'invalid_transaction_id',
      message: 'SimpleFIN transaction is missing provider id',
      accountId: externalAccountId,
    })
  }

  if (!date || amount === null || !description || !externalId) return null

  return {
    sourceConnectionId: options.sourceConnectionId,
    sourceAccountId,
    externalId,
    sourceItemKey: buildSourceItemKey({
      sourceAccountId,
      externalId,
      date,
      amount,
      description,
      rawPayload,
    }),
    date,
    transactedAt,
    amount,
    currency: stringValue(account.currency) ?? undefined,
    description,
    pending: transaction.pending === true || postedDate === null,
    status: transaction.pending === true || postedDate === null ? 'pending' : 'posted',
    rawPayload,
    normalizerVersion: options.normalizerVersion,
  }
}

export function normalizeSimpleFinPayload(
  payload: SimpleFinPayload,
  options: SimpleFinNormalizationOptions,
): SimpleFinNormalizationResult {
  const normalizerVersion = options.normalizerVersion ?? SIMPLEFIN_NORMALIZER_VERSION
  const sourceConnectionId = stringValue(options.sourceConnectionId)
  if (!sourceConnectionId) {
    throw new Error('SimpleFIN normalization requires a stable sourceConnectionId')
  }
  const errors = normalizeProviderErrors(payload)
  const accounts: NormalizedAccount[] = []
  const balances: NormalizedBalance[] = []
  const transactions: NormalizedTransaction[] = []

  for (const account of payload.accounts ?? []) {
    const externalAccountId = stringValue(account.id)
    const name = stringValue(account.name)

    if (!externalAccountId) {
      errors.push({
        code: 'invalid_account',
        message: 'SimpleFIN account is missing id',
      })
      continue
    }
    if (!name) {
      errors.push({
        code: 'invalid_account_name',
        message: 'SimpleFIN account is missing name',
        accountId: externalAccountId,
      })
      continue
    }

    const sourceAccountId = buildSimpleFinSourceAccountId(sourceConnectionId, externalAccountId)
    const balanceDate = simpleFinUnixDate(account['balance-date'])
    const balanceAmount = decimalString(account.balance)
    const balance =
      balanceDate && balanceAmount !== null
        ? {
            sourceAccountId,
            externalAccountId,
            date: balanceDate,
            amount: balanceAmount,
            currency: stringValue(account.currency) ?? undefined,
            rawPayload: account,
          }
        : undefined

    if (!balance) {
      errors.push({
        code: 'invalid_account_balance',
        message: 'SimpleFIN account balance or balance date is missing or invalid',
        accountId: externalAccountId,
      })
    } else {
      balances.push(balance)
    }

    accounts.push({
      sourceConnectionId,
      sourceAccountId,
      externalAccountId,
      name,
      currency: stringValue(account.currency) ?? undefined,
      accountType: detectAccountType(name, stringValue(account.org?.name) ?? ''),
      balance,
      rawPayload: account,
    })

    for (const transaction of account.transactions ?? []) {
      const normalized = normalizeTransaction(
        account,
        transaction,
        { sourceConnectionId, normalizerVersion },
        errors,
      )
      if (normalized) transactions.push(normalized)
    }
  }

  return {
    accounts,
    balances,
    transactions,
    errors,
  }
}
