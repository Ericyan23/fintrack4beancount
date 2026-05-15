import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface InvestmentActivityDbRow {
  id: string
  status: string
  importRunId: string | null
  rawItemId: string | null
  stagedTransactionId: string | null
  stagedStatus: string | null
  sourceAccountId: string | null
  sourceAccountName: string | null
  accountId: string | null
  accountName: string | null
  securityId: string | null
  sourceSymbol: string | null
  securityName: string | null
  beancountCommodity: string | null
  externalId: string | null
  sourceItemKey: string | null
  tradeDate: number | null
  settlementDate: string | null
  activityType: string
  instrumentType: string
  positionEffect: string
  optionType: string | null
  quantity: string | null
  price: string | null
  amount: string | null
  currency: string | null
  commission: string | null
  fees: string | null
  accruedInterest: string | null
  cashBalance: string | null
  action: string
  description: string | null
  validationErrors: string | null
  normalizerVersion: string | null
  updatedAt: number
}

interface InvestmentActivityRow extends Omit<InvestmentActivityDbRow, 'validationErrors'> {
  validationErrors: string[]
}

function importRunExists(id: string): boolean {
  return Boolean(sqlite.prepare(`
    SELECT 1
    FROM import_runs
    WHERE id = ?
  `).get(id))
}

function parseValidationErrors(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function loadInvestmentActivities(importRunId: string): InvestmentActivityRow[] {
  const rows = sqlite.prepare(`
    SELECT
      ia.id,
      ia.status,
      ia.import_run_id AS importRunId,
      ia.raw_item_id AS rawItemId,
      ia.staged_transaction_id AS stagedTransactionId,
      st.status AS stagedStatus,
      ia.source_account_id AS sourceAccountId,
      source_accounts.name AS sourceAccountName,
      ia.account_id AS accountId,
      accounts.name AS accountName,
      ia.security_id AS securityId,
      securities.source_symbol AS sourceSymbol,
      securities.name AS securityName,
      securities.beancount_commodity AS beancountCommodity,
      ia.external_id AS externalId,
      ia.source_item_key AS sourceItemKey,
      ia.trade_date AS tradeDate,
      ia.settlement_date AS settlementDate,
      ia.activity_type AS activityType,
      ia.instrument_type AS instrumentType,
      ia.position_effect AS positionEffect,
      ia.option_type AS optionType,
      ia.quantity,
      ia.price,
      ia.amount,
      ia.currency,
      ia.commission,
      ia.fees,
      ia.accrued_interest AS accruedInterest,
      ia.cash_balance AS cashBalance,
      ia.action,
      ia.description,
      ia.validation_errors AS validationErrors,
      ia.normalizer_version AS normalizerVersion,
      ia.updated_at AS updatedAt
    FROM investment_activities ia
    LEFT JOIN securities
      ON securities.id = ia.security_id
    LEFT JOIN staged_transactions st
      ON st.id = ia.staged_transaction_id
    LEFT JOIN source_accounts
      ON source_accounts.id = ia.source_account_id
    LEFT JOIN accounts
      ON accounts.id = ia.account_id
    WHERE ia.import_run_id = ?
    ORDER BY
      COALESCE(ia.trade_date, 0) ASC,
      ia.created_at ASC,
      ia.id ASC
  `).all(importRunId) as InvestmentActivityDbRow[]

  return rows.map(row => ({
    ...row,
    validationErrors: parseValidationErrors(row.validationErrors),
  }))
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params

  if (!importRunExists(id)) {
    return NextResponse.json({ error: 'Import run not found' }, { status: 404 })
  }

  return NextResponse.json({ rows: loadInvestmentActivities(id) })
}
