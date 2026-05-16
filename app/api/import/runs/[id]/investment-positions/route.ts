import { NextRequest, NextResponse } from 'next/server'
import { sqlite } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface InvestmentPositionDbRow {
  id: string
  status: string
  importRunId: string | null
  rawItemId: string | null
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
  asOfDate: string
  quantity: string
  marketValue: string | null
  price: string | null
  currency: string | null
  validationErrors: string | null
  normalizerVersion: string | null
  updatedAt: number
}

interface InvestmentPositionRow extends Omit<InvestmentPositionDbRow, 'validationErrors'> {
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

function loadInvestmentPositions(importRunId: string): InvestmentPositionRow[] {
  const rows = sqlite.prepare(`
    SELECT
      p.id,
      p.status,
      p.import_run_id AS importRunId,
      p.raw_item_id AS rawItemId,
      p.source_account_id AS sourceAccountId,
      source_accounts.name AS sourceAccountName,
      p.account_id AS accountId,
      accounts.name AS accountName,
      p.security_id AS securityId,
      securities.source_symbol AS sourceSymbol,
      securities.name AS securityName,
      securities.beancount_commodity AS beancountCommodity,
      p.external_id AS externalId,
      p.source_item_key AS sourceItemKey,
      p.as_of_date AS asOfDate,
      p.quantity,
      p.market_value AS marketValue,
      p.price,
      p.currency,
      p.validation_errors AS validationErrors,
      p.normalizer_version AS normalizerVersion,
      p.updated_at AS updatedAt
    FROM investment_positions p
    LEFT JOIN securities
      ON securities.id = p.security_id
    LEFT JOIN source_accounts
      ON source_accounts.id = p.source_account_id
    LEFT JOIN accounts
      ON accounts.id = p.account_id
    WHERE p.import_run_id = ?
    ORDER BY
      p.as_of_date ASC,
      securities.source_symbol ASC,
      p.created_at ASC,
      p.id ASC
  `).all(importRunId) as InvestmentPositionDbRow[]

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

  return NextResponse.json({ rows: loadInvestmentPositions(id) })
}
