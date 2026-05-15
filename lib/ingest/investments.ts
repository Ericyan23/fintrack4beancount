import { createHash, randomUUID } from 'crypto'
import { sqlite } from '@/lib/db'
import type { CsvInvestmentActivity } from '@/lib/ingest/csv'
import { stableStringify } from '@/lib/ingest/identity'

interface RecordInvestmentActivityInput {
  importRunId: string
  rawItemId: string
  stagedTransactionId: string
  sourceConnectionId: string
  sourceAccountId: string | null
  accountId: string | null
  externalId: string | null
  sourceItemKey: string | null
  tradeDate: number | null
  amount: string | null
  currency: string | null
  normalizerVersion: string
  validationErrors: string[]
  activity: CsvInvestmentActivity
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function hashIdentity(value: unknown, length = 24): string {
  return createHash('sha256')
    .update(stableStringify(value))
    .digest('hex')
    .slice(0, length)
}

function securitySourceSymbol(activity: CsvInvestmentActivity): string | null {
  return activity.contractSymbol ?? activity.symbol ?? activity.underlyingSymbol ?? null
}

function securityId(sourceConnectionId: string, sourceSymbol: string): string {
  return `security:${hashIdentity({ sourceConnectionId, sourceSymbol })}`
}

function investmentActivityId(input: RecordInvestmentActivityInput): string {
  if (input.sourceConnectionId && input.sourceItemKey) {
    return `investment-activity:${hashIdentity({
      sourceConnectionId: input.sourceConnectionId,
      sourceItemKey: input.sourceItemKey,
    })}`
  }
  return randomUUID()
}

function ensureSecurity(input: RecordInvestmentActivityInput, timestamp: number): string | null {
  const sourceSymbol = securitySourceSymbol(input.activity)
  if (!sourceSymbol) return null

  const id = securityId(input.sourceConnectionId, sourceSymbol)
  sqlite.prepare(`
    INSERT INTO securities (
      id,
      source_connection_id,
      source_symbol,
      name,
      instrument_type,
      underlying_symbol,
      contract_symbol,
      option_type,
      expiration_date,
      strike_price,
      beancount_commodity,
      raw_payload,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(source_connection_id, source_symbol) DO UPDATE SET
      name = COALESCE(excluded.name, securities.name),
      instrument_type = excluded.instrument_type,
      underlying_symbol = COALESCE(excluded.underlying_symbol, securities.underlying_symbol),
      contract_symbol = COALESCE(excluded.contract_symbol, securities.contract_symbol),
      option_type = COALESCE(excluded.option_type, securities.option_type),
      expiration_date = COALESCE(excluded.expiration_date, securities.expiration_date),
      strike_price = COALESCE(excluded.strike_price, securities.strike_price),
      raw_payload = excluded.raw_payload,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.sourceConnectionId,
    sourceSymbol,
    input.activity.securityDescription,
    input.activity.instrumentType,
    input.activity.underlyingSymbol,
    input.activity.contractSymbol,
    input.activity.optionType,
    input.activity.expirationDate,
    input.activity.strikePrice,
    JSON.stringify(input.activity),
    timestamp,
    timestamp,
  )

  const row = sqlite.prepare(`
    SELECT id
    FROM securities
    WHERE source_connection_id = ?
      AND source_symbol = ?
  `).get(input.sourceConnectionId, sourceSymbol) as { id: string } | undefined

  return row?.id ?? id
}

export function recordInvestmentActivity(input: RecordInvestmentActivityInput): string {
  const timestamp = nowSeconds()
  const securityId = ensureSecurity(input, timestamp)
  const id = investmentActivityId(input)

  sqlite.prepare(`
    INSERT INTO investment_activities (
      id,
      import_run_id,
      raw_item_id,
      staged_transaction_id,
      source_connection_id,
      source_account_id,
      account_id,
      security_id,
      external_id,
      source_item_key,
      trade_date,
      settlement_date,
      activity_type,
      instrument_type,
      position_effect,
      option_type,
      quantity,
      price,
      amount,
      currency,
      commission,
      fees,
      accrued_interest,
      cash_balance,
      action,
      description,
      status,
      validation_errors,
      normalized_payload,
      normalizer_version,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'blocked', ?, ?, ?, ?, ?)
    ON CONFLICT(source_connection_id, source_item_key) DO UPDATE SET
      staged_transaction_id = excluded.staged_transaction_id,
      raw_item_id = excluded.raw_item_id,
      import_run_id = excluded.import_run_id,
      security_id = COALESCE(excluded.security_id, investment_activities.security_id),
      validation_errors = excluded.validation_errors,
      normalized_payload = excluded.normalized_payload,
      normalizer_version = excluded.normalizer_version,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.importRunId,
    input.rawItemId,
    input.stagedTransactionId,
    input.sourceConnectionId,
    input.sourceAccountId,
    input.accountId,
    securityId,
    input.externalId,
    input.sourceItemKey,
    input.tradeDate,
    input.activity.settlementDate,
    input.activity.activityType,
    input.activity.instrumentType,
    input.activity.positionEffect,
    input.activity.optionType,
    input.activity.quantity,
    input.activity.price,
    input.amount,
    input.currency,
    input.activity.commission,
    input.activity.fees,
    input.activity.accruedInterest,
    input.activity.cashBalance,
    input.activity.action,
    input.activity.securityDescription,
    JSON.stringify(input.validationErrors),
    JSON.stringify(input.activity),
    input.normalizerVersion,
    timestamp,
    timestamp,
  )

  return id
}
