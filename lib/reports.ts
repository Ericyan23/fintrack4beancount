import { sqlite } from '@/lib/db'
import { buildTransactionWhere, type TransactionFilters } from '@/lib/transactions/query'

export interface SummaryReport {
  income: number
  spending: number
  net: number
  transactionCount: number
}

export interface PeriodReportRow {
  period: string
  startDate: string
  endDate: string
  income: number
  spending: number
  net: number
  transactionCount: number
}

export interface BreakdownRow {
  label: string
  amount: number
  transactionCount: number
  accountId?: string
  category?: string
  categoryGroup?: string
  search?: string
}

export interface ReportsPayload {
  summary: SummaryReport
  cashFlow: PeriodReportRow[]
  spending: {
    byCategoryGroup: BreakdownRow[]
    byCategory: BreakdownRow[]
    byAccount: BreakdownRow[]
    byMerchant: BreakdownRow[]
  }
  income: {
    byCategoryGroup: BreakdownRow[]
    byCategory: BreakdownRow[]
    byAccount: BreakdownRow[]
    byMerchant: BreakdownRow[]
  }
}

type SummaryRow = {
  income: number | null
  spending: number | null
  net: number | null
  transactionCount: number
}

type PeriodRow = SummaryRow & {
  period: string
  startDate: string
  endDate: string
}

type RawBreakdownRow = {
  label: string | null
  totalAmount: number | null
  transactionCount: number
  accountId?: string | null
  category?: string | null
  categoryGroup?: string | null
  search?: string | null
}

function money(value: number | null): number {
  return Math.round((value ?? 0) * 100) / 100
}

function monthEnd(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Date(year, month, 0).toISOString().slice(0, 10)
}

function normalizeBreakdownRows(rows: RawBreakdownRow[]): BreakdownRow[] {
  return rows.map(row => ({
    label: row.label ?? 'Uncategorized',
    amount: money(row.totalAmount),
    transactionCount: row.transactionCount,
    accountId: row.accountId ?? undefined,
    category: row.category ?? undefined,
    categoryGroup: row.categoryGroup ?? undefined,
    search: row.search ?? undefined,
  }))
}

function runBreakdown(
  filters: TransactionFilters,
  type: 'spending' | 'income',
  selectSql: string,
  groupBySql: string,
  limit = 12,
): BreakdownRow[] {
  const { where, params } = buildTransactionWhere({ ...filters, type }, { defaultStatus: 'posted' })
  const amountExpr = type === 'spending' ? 'ABS(CAST(t.amount AS REAL))' : 'CAST(t.amount AS REAL)'
  const rows = sqlite.prepare(`
    SELECT
      ${selectSql},
      ROUND(SUM(${amountExpr}), 2) AS totalAmount,
      COUNT(*) AS transactionCount
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE ${where}
    GROUP BY ${groupBySql}
    HAVING totalAmount > 0
    ORDER BY totalAmount DESC
    LIMIT ?
  `).all(...params, limit) as RawBreakdownRow[]

  return normalizeBreakdownRows(rows)
}

export function loadReports(filters: TransactionFilters): ReportsPayload {
  const { where, params } = buildTransactionWhere(filters, { defaultStatus: 'posted' })
  const nonTransferCategory = `(t.category IS NULL OR t.category NOT LIKE 'Transfer:%')`

  const summaryRow = sqlite.prepare(`
    SELECT
      ROUND(SUM(CASE WHEN ${nonTransferCategory} AND CAST(t.amount AS REAL) > 0 THEN CAST(t.amount AS REAL) ELSE 0 END), 2) AS income,
      ROUND(SUM(CASE WHEN ${nonTransferCategory} AND CAST(t.amount AS REAL) < 0 THEN ABS(CAST(t.amount AS REAL)) ELSE 0 END), 2) AS spending,
      ROUND(SUM(CASE WHEN ${nonTransferCategory} THEN CAST(t.amount AS REAL) ELSE 0 END), 2) AS net,
      COUNT(*) AS transactionCount
    FROM transactions t
    WHERE ${where}
  `).get(...params) as SummaryRow

  const cashFlowRows = sqlite.prepare(`
    SELECT
      strftime('%Y-%m', datetime(t.posted, 'unixepoch')) AS period,
      date(t.posted, 'unixepoch', 'start of month') AS startDate,
      ROUND(SUM(CASE WHEN ${nonTransferCategory} AND CAST(t.amount AS REAL) > 0 THEN CAST(t.amount AS REAL) ELSE 0 END), 2) AS income,
      ROUND(SUM(CASE WHEN ${nonTransferCategory} AND CAST(t.amount AS REAL) < 0 THEN ABS(CAST(t.amount AS REAL)) ELSE 0 END), 2) AS spending,
      ROUND(SUM(CASE WHEN ${nonTransferCategory} THEN CAST(t.amount AS REAL) ELSE 0 END), 2) AS net,
      COUNT(*) AS transactionCount
    FROM transactions t
    WHERE ${where}
    GROUP BY period
    ORDER BY period ASC
  `).all(...params) as Array<Omit<PeriodRow, 'endDate'>>

  const cashFlow = cashFlowRows.map(row => ({
    period: row.period,
    startDate: row.startDate,
    endDate: monthEnd(row.period),
    income: money(row.income),
    spending: money(row.spending),
    net: money(row.net),
    transactionCount: row.transactionCount,
  }))

  const categoryGroupExpr = `
    CASE
      WHEN t.category IS NULL OR t.category = '' THEN 'Uncategorized'
      WHEN t.category LIKE 'Expenses:%' OR t.category LIKE 'Income:%' OR t.category LIKE 'Equity:%' THEN
        CASE
          WHEN instr(substr(t.category, instr(t.category, ':') + 1), ':') > 0
            THEN substr(
              substr(t.category, instr(t.category, ':') + 1),
              1,
              instr(substr(t.category, instr(t.category, ':') + 1), ':') - 1
            )
          ELSE substr(t.category, instr(t.category, ':') + 1)
        END
      WHEN instr(t.category, ':') > 0 THEN substr(t.category, 1, instr(t.category, ':') - 1)
      ELSE t.category
    END
  `
  const categoryGroupSelect = `
    ${categoryGroupExpr} AS label,
    ${categoryGroupExpr} AS categoryGroup
  `
  const categoryGroupBy = categoryGroupExpr

  const categorySelect = `
    COALESCE(NULLIF(t.category, ''), 'Uncategorized') AS label,
    COALESCE(NULLIF(t.category, ''), 'Uncategorized') AS category
  `
  const accountSelect = `
    COALESCE(a.name, t.account_id) AS label,
    t.account_id AS accountId
  `
  const merchantSelect = `
    trim(replace(replace(upper(t.description), char(10), ' '), char(13), ' ')) AS label,
    t.description AS search
  `

  return {
    summary: {
      income: money(summaryRow.income),
      spending: money(summaryRow.spending),
      net: money(summaryRow.net),
      transactionCount: summaryRow.transactionCount,
    },
    cashFlow,
    spending: {
      byCategoryGroup: runBreakdown(filters, 'spending', categoryGroupSelect, categoryGroupBy),
      byCategory: runBreakdown(filters, 'spending', categorySelect, 'COALESCE(NULLIF(t.category, \'\'), \'Uncategorized\')'),
      byAccount: runBreakdown(filters, 'spending', accountSelect, 't.account_id'),
      byMerchant: runBreakdown(filters, 'spending', merchantSelect, 'label'),
    },
    income: {
      byCategoryGroup: runBreakdown(filters, 'income', categoryGroupSelect, categoryGroupBy),
      byCategory: runBreakdown(filters, 'income', categorySelect, 'COALESCE(NULLIF(t.category, \'\'), \'Uncategorized\')'),
      byAccount: runBreakdown(filters, 'income', accountSelect, 't.account_id'),
      byMerchant: runBreakdown(filters, 'income', merchantSelect, 'label'),
    },
  }
}
