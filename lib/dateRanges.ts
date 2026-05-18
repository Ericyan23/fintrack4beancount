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
  { value: 'this_month', label: '本月' },
  { value: 'last_month', label: '上月' },
  { value: 'last_30_days', label: '最近 30 天' },
  { value: 'last_3_months', label: '最近 3 个月' },
  { value: 'last_6_months', label: '最近 6 个月' },
  { value: 'last_12_months', label: '最近 12 个月' },
  { value: 'ytd', label: '今年至今' },
  { value: 'last_year', label: '去年' },
  { value: 'all_time', label: '全部时间' },
  { value: 'custom', label: '自定义' },
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
  if (!startDate && !endDate) return '全部时间'
  if (!startDate) return `截至 ${endDate}`
  if (!endDate) return `${startDate} 之后`
  return `${startDate} - ${endDate}`
}
