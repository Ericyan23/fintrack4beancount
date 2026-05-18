import { createHash, randomUUID } from 'crypto'
import { sqlite } from '@/lib/db'
import type { CsvInvestmentActivity, CsvInvestmentPosition } from '@/lib/ingest/csv'
import { stableStringify } from '@/lib/ingest/identity'
import type { InvestmentActivityStatus, InvestmentPositionStatus } from '@/lib/ingest/types'

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

interface RecordInvestmentPositionInput {
  importRunId: string
  rawItemId: string
  sourceConnectionId: string
  sourceAccountId: string | null
  accountId: string | null
  externalId: string | null
  sourceItemKey: string | null
  normalizerVersion: string
  validationErrors: string[]
  position: CsvInvestmentPosition
}

export interface InvestmentActivityAuditMetadata {
  actor?: string | null
  reason?: string | null
}

export interface UpdateInvestmentActivityStatusInput {
  importRunId: string
  investmentActivityId: string
  status: InvestmentActivityStatus
  audit?: InvestmentActivityAuditMetadata
}

export interface UpdateInvestmentPositionStatusInput {
  importRunId: string
  investmentPositionId: string
  status: InvestmentPositionStatus
  audit?: InvestmentActivityAuditMetadata
}

export interface InvestmentActivityStatusResult {
  id: string
  status: InvestmentActivityStatus
  updatedAt: number
}

export interface InvestmentPositionStatusResult {
  id: string
  status: InvestmentPositionStatus
  updatedAt: number
}

interface InvestmentActivityStatusRow {
  id: string
  importRunId: string | null
  status: InvestmentActivityStatus
  sourceConnectionId: string | null
  sourceAccountId: string | null
  rawItemId: string | null
  stagedTransactionId: string | null
  sourceItemKey: string | null
  updatedAt: number
}

interface InvestmentPositionStatusRow {
  id: string
  importRunId: string | null
  status: InvestmentPositionStatus
  sourceConnectionId: string | null
  sourceAccountId: string | null
  rawItemId: string | null
  sourceItemKey: string | null
  updatedAt: number
}

export class InvestmentActivityNotFoundError extends Error {
  constructor(importRunId: string, investmentActivityId: string) {
    super(`Investment activity not found: ${investmentActivityId} in import run ${importRunId}`)
    this.name = 'InvestmentActivityNotFoundError'
  }
}

export class InvestmentPositionNotFoundError extends Error {
  constructor(importRunId: string, investmentPositionId: string) {
    super(`Investment position not found: ${investmentPositionId} in import run ${importRunId}`)
    this.name = 'InvestmentPositionNotFoundError'
  }
}

export class InvestmentActivityInvalidInputError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'InvestmentActivityInvalidInputError'
  }
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

interface SecurityFacts {
  sourceSymbol: string
  name: string | null
  instrumentType: string
  underlyingSymbol: string | null
  contractSymbol: string | null
  optionType: string | null
  expirationDate: string | null
  strikePrice: string | null
  rawPayload: unknown
}

function securityId(sourceConnectionId: string, sourceSymbol: string): string {
  return `security:${hashIdentity({ sourceConnectionId, sourceSymbol })}`
}

function securitySourceSymbol(activity: CsvInvestmentActivity): string | null {
  return activity.contractSymbol ?? activity.symbol ?? activity.underlyingSymbol ?? null
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

function investmentPositionId(input: RecordInvestmentPositionInput): string {
  if (input.sourceConnectionId && input.sourceItemKey) {
    return `investment-position:${hashIdentity({
      sourceConnectionId: input.sourceConnectionId,
      sourceItemKey: input.sourceItemKey,
    })}`
  }
  return randomUUID()
}

function ensureSecurityFacts(
  sourceConnectionId: string,
  facts: SecurityFacts,
  timestamp: number,
): string {
  const id = securityId(sourceConnectionId, facts.sourceSymbol)
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
    sourceConnectionId,
    facts.sourceSymbol,
    facts.name,
    facts.instrumentType,
    facts.underlyingSymbol,
    facts.contractSymbol,
    facts.optionType,
    facts.expirationDate,
    facts.strikePrice,
    JSON.stringify(facts.rawPayload),
    timestamp,
    timestamp,
  )

  const row = sqlite.prepare(`
    SELECT id
    FROM securities
    WHERE source_connection_id = ?
      AND source_symbol = ?
  `).get(sourceConnectionId, facts.sourceSymbol) as { id: string } | undefined

  return row?.id ?? id
}

function ensureSecurity(input: RecordInvestmentActivityInput, timestamp: number): string | null {
  const sourceSymbol = securitySourceSymbol(input.activity)
  if (!sourceSymbol) return null

  return ensureSecurityFacts(input.sourceConnectionId, {
    sourceSymbol,
    name: input.activity.securityDescription,
    instrumentType: input.activity.instrumentType,
    underlyingSymbol: input.activity.underlyingSymbol,
    contractSymbol: input.activity.contractSymbol,
    optionType: input.activity.optionType,
    expirationDate: input.activity.expirationDate,
    strikePrice: input.activity.strikePrice,
    rawPayload: input.activity,
  }, timestamp)
}

function ensurePositionSecurity(input: RecordInvestmentPositionInput, timestamp: number): string | null {
  if (!input.position.symbol) return null

  return ensureSecurityFacts(input.sourceConnectionId, {
    sourceSymbol: input.position.symbol,
    name: input.position.securityDescription,
    instrumentType: input.position.instrumentType,
    underlyingSymbol: null,
    contractSymbol: input.position.instrumentType === 'option' ? input.position.symbol : null,
    optionType: null,
    expirationDate: null,
    strikePrice: null,
    rawPayload: input.position,
  }, timestamp)
}

const insertAuditLog = sqlite.prepare(`
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
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function auditActor(audit: InvestmentActivityAuditMetadata | undefined): string {
  const trimmed = audit?.actor?.trim()
  return trimmed || 'local'
}

function auditReason(
  audit: InvestmentActivityAuditMetadata | undefined,
  fallback: string,
): string {
  const trimmed = audit?.reason?.trim()
  return trimmed || fallback
}

function investmentActivityStatusAction(status: InvestmentActivityStatus): string {
  if (status === 'reviewed') return 'investment_activity_review'
  if (status === 'ignored') return 'investment_activity_ignore'
  return 'investment_activity_status_update'
}

function investmentPositionStatusAction(status: InvestmentPositionStatus): string {
  if (status === 'reviewed') return 'investment_position_review'
  if (status === 'ignored') return 'investment_position_ignore'
  return 'investment_position_status_update'
}

function selectInvestmentActivityStatusRow(
  importRunId: string,
  investmentActivityId: string,
): InvestmentActivityStatusRow | null {
  const row = sqlite.prepare(`
    SELECT id,
           import_run_id AS importRunId,
           status,
           source_connection_id AS sourceConnectionId,
           source_account_id AS sourceAccountId,
           raw_item_id AS rawItemId,
           staged_transaction_id AS stagedTransactionId,
           source_item_key AS sourceItemKey,
           updated_at AS updatedAt
    FROM investment_activities
    WHERE id = ?
      AND import_run_id = ?
  `).get(investmentActivityId, importRunId) as InvestmentActivityStatusRow | undefined

  return row ?? null
}

function selectInvestmentPositionStatusRow(
  importRunId: string,
  investmentPositionId: string,
): InvestmentPositionStatusRow | null {
  const row = sqlite.prepare(`
    SELECT id,
           import_run_id AS importRunId,
           status,
           source_connection_id AS sourceConnectionId,
           source_account_id AS sourceAccountId,
           raw_item_id AS rawItemId,
           source_item_key AS sourceItemKey,
           updated_at AS updatedAt
    FROM investment_positions
    WHERE id = ?
      AND import_run_id = ?
  `).get(investmentPositionId, importRunId) as InvestmentPositionStatusRow | undefined

  return row ?? null
}

function recordInvestmentActivityStatusAudit(input: {
  beforeRow: InvestmentActivityStatusRow
  afterRow: InvestmentActivityStatusRow
  audit?: InvestmentActivityAuditMetadata
  timestamp: number
}): void {
  if (input.beforeRow.status === input.afterRow.status) return

  const action = investmentActivityStatusAction(input.afterRow.status)
  insertAuditLog.run(
    'investment_activity',
    input.beforeRow.id,
    action,
    auditActor(input.audit),
    auditReason(input.audit, action),
    JSON.stringify({ investmentActivity: { status: input.beforeRow.status } }),
    JSON.stringify({ investmentActivity: { status: input.afterRow.status } }),
    JSON.stringify({
      importRunId: input.beforeRow.importRunId,
      sourceConnectionId: input.beforeRow.sourceConnectionId,
      sourceAccountId: input.beforeRow.sourceAccountId,
      rawItemId: input.beforeRow.rawItemId,
      stagedTransactionId: input.beforeRow.stagedTransactionId,
      sourceItemKey: input.beforeRow.sourceItemKey,
      fields: ['status'],
    }),
    input.timestamp,
  )
}

function recordInvestmentPositionStatusAudit(input: {
  beforeRow: InvestmentPositionStatusRow
  afterRow: InvestmentPositionStatusRow
  audit?: InvestmentActivityAuditMetadata
  timestamp: number
}): void {
  if (input.beforeRow.status === input.afterRow.status) return

  const action = investmentPositionStatusAction(input.afterRow.status)
  insertAuditLog.run(
    'investment_position',
    input.beforeRow.id,
    action,
    auditActor(input.audit),
    auditReason(input.audit, action),
    JSON.stringify({ investmentPosition: { status: input.beforeRow.status } }),
    JSON.stringify({ investmentPosition: { status: input.afterRow.status } }),
    JSON.stringify({
      importRunId: input.beforeRow.importRunId,
      sourceConnectionId: input.beforeRow.sourceConnectionId,
      sourceAccountId: input.beforeRow.sourceAccountId,
      rawItemId: input.beforeRow.rawItemId,
      sourceItemKey: input.beforeRow.sourceItemKey,
      fields: ['status'],
    }),
    input.timestamp,
  )
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
      source_account_id = excluded.source_account_id,
      staged_transaction_id = excluded.staged_transaction_id,
      raw_item_id = excluded.raw_item_id,
      import_run_id = excluded.import_run_id,
      account_id = excluded.account_id,
      security_id = COALESCE(excluded.security_id, investment_activities.security_id),
      external_id = excluded.external_id,
      trade_date = excluded.trade_date,
      settlement_date = excluded.settlement_date,
      quantity = excluded.quantity,
      price = excluded.price,
      amount = excluded.amount,
      currency = excluded.currency,
      commission = excluded.commission,
      fees = excluded.fees,
      accrued_interest = excluded.accrued_interest,
      cash_balance = excluded.cash_balance,
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

export function recordInvestmentPosition(input: RecordInvestmentPositionInput): string {
  const timestamp = nowSeconds()
  const securityId = ensurePositionSecurity(input, timestamp)
  const id = investmentPositionId(input)

  sqlite.prepare(`
    INSERT INTO investment_positions (
      id,
      source_connection_id,
      source_account_id,
      import_run_id,
      raw_item_id,
      account_id,
      security_id,
      external_id,
      source_item_key,
      as_of_date,
      quantity,
      market_value,
      price,
      currency,
      status,
      validation_errors,
      raw_payload,
      normalizer_version,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?, ?, ?)
    ON CONFLICT(source_connection_id, source_item_key) DO UPDATE SET
      source_account_id = excluded.source_account_id,
      import_run_id = excluded.import_run_id,
      raw_item_id = excluded.raw_item_id,
      account_id = excluded.account_id,
      security_id = COALESCE(excluded.security_id, investment_positions.security_id),
      external_id = excluded.external_id,
      as_of_date = excluded.as_of_date,
      quantity = excluded.quantity,
      market_value = excluded.market_value,
      price = excluded.price,
      currency = excluded.currency,
      validation_errors = excluded.validation_errors,
      raw_payload = excluded.raw_payload,
      normalizer_version = excluded.normalizer_version,
      updated_at = excluded.updated_at
  `).run(
    id,
    input.sourceConnectionId,
    input.sourceAccountId,
    input.importRunId,
    input.rawItemId,
    input.accountId,
    securityId,
    input.externalId,
    input.sourceItemKey,
    input.position.asOfDate,
    input.position.quantity,
    input.position.marketValue,
    input.position.price,
    input.position.currency,
    JSON.stringify(input.validationErrors),
    JSON.stringify(input.position),
    input.normalizerVersion,
    timestamp,
    timestamp,
  )

  return id
}

export function updateInvestmentActivityStatus(
  input: UpdateInvestmentActivityStatusInput,
): InvestmentActivityStatusResult {
  if (!['blocked', 'needs_review', 'reviewed', 'ignored'].includes(input.status)) {
    throw new InvestmentActivityInvalidInputError(`Unsupported investment activity status: ${input.status}`)
  }

  return sqlite.transaction(() => {
    const row = selectInvestmentActivityStatusRow(input.importRunId, input.investmentActivityId)
    if (!row) {
      throw new InvestmentActivityNotFoundError(input.importRunId, input.investmentActivityId)
    }

    const updatedAt = nowSeconds()
    sqlite.prepare(`
      UPDATE investment_activities
      SET status = ?,
          updated_at = ?
      WHERE id = ?
        AND import_run_id = ?
    `).run(input.status, updatedAt, input.investmentActivityId, input.importRunId)

    const afterRow = selectInvestmentActivityStatusRow(input.importRunId, input.investmentActivityId)
    if (afterRow) {
      recordInvestmentActivityStatusAudit({
        beforeRow: row,
        afterRow,
        audit: input.audit,
        timestamp: updatedAt,
      })
    }

    return {
      id: row.id,
      status: input.status,
      updatedAt,
    }
  })()
}

export function updateInvestmentPositionStatus(
  input: UpdateInvestmentPositionStatusInput,
): InvestmentPositionStatusResult {
  if (!['blocked', 'needs_review', 'reviewed', 'ignored'].includes(input.status)) {
    throw new InvestmentActivityInvalidInputError(`Unsupported investment position status: ${input.status}`)
  }

  return sqlite.transaction(() => {
    const row = selectInvestmentPositionStatusRow(input.importRunId, input.investmentPositionId)
    if (!row) {
      throw new InvestmentPositionNotFoundError(input.importRunId, input.investmentPositionId)
    }

    const updatedAt = nowSeconds()
    sqlite.prepare(`
      UPDATE investment_positions
      SET status = ?,
          updated_at = ?
      WHERE id = ?
        AND import_run_id = ?
    `).run(input.status, updatedAt, input.investmentPositionId, input.importRunId)

    const afterRow = selectInvestmentPositionStatusRow(input.importRunId, input.investmentPositionId)
    if (afterRow) {
      recordInvestmentPositionStatusAudit({
        beforeRow: row,
        afterRow,
        audit: input.audit,
        timestamp: updatedAt,
      })
    }

    return {
      id: row.id,
      status: input.status,
      updatedAt,
    }
  })()
}
