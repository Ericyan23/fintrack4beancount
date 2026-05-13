import type { Account } from '@/lib/db/schema'

export type AccountType = 'depository' | 'credit' | 'investment' | 'loan'

export const ACCOUNT_TYPES: AccountType[] = [
  'depository',
  'credit',
  'investment',
  'loan',
]

const CREDIT_KEYWORDS =
  /visa|mastercard|amex|american express|credit|discover|cash reward|cash rewards|sapphire|freedom|platinum|gold card|world elite|aadvantage|strata|hilton|hyatt/i
const DEPOSITORY_KEYWORDS =
  /checking|savings|safe balance|safebalance|cash management|depository|banking/i
const INVESTMENT_KEYWORDS = /invest|brokerage|401k|ira|roth|fidelity|schwab brokerage/i
const LOAN_KEYWORDS = /loan|mortgage|auto loan|student loan/i

export function detectAccountType(name: string, orgName = ''): AccountType {
  const text = `${name} ${orgName}`.trim()
  if (LOAN_KEYWORDS.test(text)) return 'loan'
  if (INVESTMENT_KEYWORDS.test(text)) return 'investment'
  if (CREDIT_KEYWORDS.test(text)) return 'credit'
  if (/\bcard\b/i.test(text) && !DEPOSITORY_KEYWORDS.test(text)) return 'credit'
  return 'depository'
}

export function effectiveAccountType(
  account: Pick<Account, 'accountType' | 'accountTypeOverride'>,
): AccountType {
  return (account.accountTypeOverride || account.accountType) as AccountType
}

export function isLiabilityAccount(
  account: Pick<Account, 'accountType' | 'accountTypeOverride'>,
): boolean {
  const type = effectiveAccountType(account)
  return type === 'credit' || type === 'loan'
}

export function inferInstitutionName(name: string): string | null {
  const normalized = name.trim()
  if (!normalized) return null

  const parentheticalInstitution = normalized.match(/\(([^()]+)\)\s*$/)
  if (parentheticalInstitution?.[1] && !/^\d{4}$/.test(parentheticalInstitution[1])) {
    return parentheticalInstitution[1].trim()
  }

  const prefix = normalized.split(/[-–—:|]/)[0]?.trim()
  return prefix && prefix.length < normalized.length ? prefix : null
}

export function accountInstitution(
  account: Pick<Account, 'name' | 'orgName' | 'orgDomain'>,
): string {
  return (
    account.orgName?.trim()
    || inferInstitutionName(account.name)
    || account.orgDomain?.trim()
    || 'Unknown institution'
  )
}

export function accountLast4(account: Pick<Account, 'name'>): string | null {
  const trailingParen = account.name.match(/\((\d{4})\)\s*$/)
  if (trailingParen) return trailingParen[1]

  const hiddenSuffix = account.name.match(/\.\.\.(\d{4})\s*$/)
  if (hiddenSuffix) return hiddenSuffix[1]

  const trailingDash = account.name.match(/[-\s](\d{4})\s*$/)
  return trailingDash?.[1] ?? null
}

export function accountDisplayName(account: Pick<Account, 'name' | 'orgName' | 'orgDomain'>): string {
  const raw = account.name
  const normalized = raw
    .replace(/[®™℠]/g, '')
    .replace(/\s*\(\d{4}\)\s*$/g, '')
    .replace(/\s*-\s*\d{4}\s*$/g, '')
    .replace(/\s*\.\.\.\d{4}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized
}

export function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case 'credit':
      return 'Credit Card'
    case 'loan':
      return 'Loan'
    case 'investment':
      return 'Investment'
    case 'depository':
      return 'Depository'
  }
}
