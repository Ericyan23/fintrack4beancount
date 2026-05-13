export type DateRangePreset =
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_3_months'
  | 'last_6_months'
  | 'last_12_months'
  | 'ytd'
  | 'last_year'
  | 'all_time'
  | 'custom'

export interface DateRange {
  startDate: string
  endDate: string
}

export interface DateRangeOption {
  value: DateRangePreset
  label: string
}

export const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_3_months', label: 'Last 3 months' },
  { value: 'last_6_months', label: 'Last 6 months' },
  { value: 'last_12_months', label: 'Last 12 months' },
  { value: 'ytd', label: 'YTD' },
  { value: 'last_year', label: 'Last year' },
  { value: 'all_time', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function getDateRangeForPreset(
  preset: DateRangePreset,
  today = new Date(),
): DateRange | null {
  const thisMonthStart = startOfMonth(today)

  switch (preset) {
    case 'this_month':
      return { startDate: toLocalDateString(thisMonthStart), endDate: toLocalDateString(today) }
    case 'last_month': {
      const previousMonth = addMonths(thisMonthStart, -1)
      return {
        startDate: toLocalDateString(previousMonth),
        endDate: toLocalDateString(endOfMonth(previousMonth)),
      }
    }
    case 'last_30_days':
      return { startDate: toLocalDateString(addDays(today, -29)), endDate: toLocalDateString(today) }
    case 'last_3_months':
      return { startDate: toLocalDateString(addMonths(thisMonthStart, -2)), endDate: toLocalDateString(today) }
    case 'last_6_months':
      return { startDate: toLocalDateString(addMonths(thisMonthStart, -5)), endDate: toLocalDateString(today) }
    case 'last_12_months':
      return { startDate: toLocalDateString(addMonths(thisMonthStart, -11)), endDate: toLocalDateString(today) }
    case 'ytd':
      return { startDate: `${today.getFullYear()}-01-01`, endDate: toLocalDateString(today) }
    case 'last_year':
      return {
        startDate: `${today.getFullYear() - 1}-01-01`,
        endDate: `${today.getFullYear() - 1}-12-31`,
      }
    case 'all_time':
    case 'custom':
      return null
  }
}

export function formatDateRangeLabel(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return 'All time'
  if (!startDate) return `Through ${endDate}`
  if (!endDate) return `After ${startDate}`
  return `${startDate} - ${endDate}`
}
