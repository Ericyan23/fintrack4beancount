import { NextRequest, NextResponse } from 'next/server'
import { loadReports } from '@/lib/reports'
import { parseTransactionFilters } from '@/lib/transactions/query'
import { getDateRangeForPreset } from '@/lib/dateRanges'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const filters = parseTransactionFilters(req.nextUrl.searchParams)
  const rangePreset = req.nextUrl.searchParams.get('range')
  const defaultRange = getDateRangeForPreset('last_6_months')!
  const payload = loadReports({
    ...filters,
    startDate: filters.startDate ?? (rangePreset === 'all_time' ? undefined : defaultRange.startDate),
    endDate: filters.endDate ?? (rangePreset === 'all_time' ? undefined : defaultRange.endDate),
    status: filters.status ?? 'posted',
  })

  return NextResponse.json(payload)
}
