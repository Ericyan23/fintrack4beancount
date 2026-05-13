import fs from 'fs'
import path from 'path'

export interface DefaultClassificationRule {
  pattern: string
  category: string
  priority: number
}

export const REVIEW_EXPENSE_CATEGORY = 'Expenses:Review'
export const REVIEW_INCOME_CATEGORY = 'Income:Review'
export const REVIEW_EQUITY_CATEGORY = 'Equity:Review'

export const REVIEW_CATEGORY_NAMES = [
  REVIEW_EXPENSE_CATEGORY,
  REVIEW_INCOME_CATEGORY,
  REVIEW_EQUITY_CATEGORY,
]

export function expenseReviewCategoryForAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) return null
  return amount < 0 ? REVIEW_EXPENSE_CATEGORY : null
}

export function reviewCategoryForAmount(amount: number): string | null {
  if (!Number.isFinite(amount) || amount === 0) return null
  return amount > 0 ? REVIEW_INCOME_CATEGORY : REVIEW_EXPENSE_CATEGORY
}

const BEANCOUNT_CATEGORY_FALLBACKS = [
  'Equity:Gift',
  'Income:Salary',
  'Income:Rewards:Cashback',
  'Income:Investment:Dividends',
  'Income:Investment:Interest',
  'Income:Investment:CapitalGain',
  'Expenses:Travel:Flight',
  'Expenses:Transport:Train',
  'Expenses:Transport:Taxi',
  'Expenses:Transport:RentalCar',
  'Expenses:Fees:CreditCard',
  'Expenses:Fees:Financial',
  'Expenses:Fees:Government',
  'Expenses:Food:Groceries',
  'Expenses:Food:Restaurants',
  'Expenses:Entertainment:Game',
  'Expenses:Entertainment:Subscriptions',
  'Expenses:Shopping:Household',
  'Expenses:Shopping:Merchandise',
  'Expenses:Health:Pharmacy',
  'Expenses:Travel:Hotel',
  'Expenses:Transport:Gas',
  'Expenses:Transport:Maintenance',
  'Expenses:Education:Tuition',
  'Expenses:Education:Fees',
  'Expenses:Education:BooksSoftware',
  'Expenses:Home:Rent',
  'Expenses:Home:Furniture',
  'Expenses:Home:Internet',
  'Expenses:Home:Phone',
  'Expenses:Home:Utilities',
  'Expenses:Shopping:Electronics',
  'Expenses:Shopping:Clothing',
  'Expenses:Entertainment:Movie',
  'Expenses:Entertainment:Activities',
  'Expenses:Legal',
  'Expenses:Health:Medical',
  'Expenses:Transport:Parking',
  'Expenses:Travel:Activities',
  'Expenses:Misc:Postage',
  'Expenses:Personal:Pets',
  'Expenses:Personal:Care',
  'Expenses:Personal:Services',
  'Expenses:MS:MO',
  'Expenses:Home:Improvement',
  'Expenses:Home:Storage',
  'Expenses:Shopping:Gifts',
  'Expenses:MS:Other',
  'Expenses:Health:Insurance',
  'Expenses:Health:Fitness',
  'Expenses:Business:OfficeSupplies',
]

export const INTERNAL_CATEGORY_NAMES = [
  'Transfer:CreditCardPayment',
  'Transfer:Internal',
  'Transfer:Investment',
  'Transfer:Wallet',
]

export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  'Entertainment:Games': 'Expenses:Entertainment:Game',
  'Entertainment:Movies': 'Expenses:Entertainment:Movie',
  'Entertainment:Subscriptions': 'Expenses:Entertainment:Subscriptions',
  'Finance:Investment': 'Transfer:Investment',
  'Finance:Transfer': 'Transfer:Internal',
  'Food:Coffee': 'Expenses:Food:Restaurants',
  'Food:Groceries': 'Expenses:Food:Groceries',
  'Food:Restaurants': 'Expenses:Food:Restaurants',
  'Health:Fitness': 'Expenses:Health:Fitness',
  'Health:Medical': 'Expenses:Health:Medical',
  'Health:Pharmacy': 'Expenses:Health:Pharmacy',
  'Housing:Insurance': 'Expenses:Health:Insurance',
  'Housing:Rent': 'Expenses:Home:Rent',
  'Housing:Utilities': 'Expenses:Home:Utilities',
  'Income:Paycheck': 'Income:Salary',
  'Income:Refund': 'Income:Rewards:Cashback',
  'Shopping:Clothing': 'Expenses:Shopping:Clothing',
  'Shopping:Electronics': 'Expenses:Shopping:Electronics',
  'Shopping:Online': 'Expenses:Shopping:Merchandise',
  'Transaction:Payment': 'Transfer:CreditCardPayment',
  'Transport:Gas': 'Expenses:Transport:Gas',
  'Transport:Parking': 'Expenses:Transport:Parking',
  'Transport:Rideshare': 'Expenses:Transport:Taxi',
  'Transport:Train': 'Expenses:Transport:Train',
  'Transport:Transit': 'Expenses:Transport:Train',
  'Travel:Flight': 'Expenses:Travel:Flight',
  'Travel:Hotel': 'Expenses:Travel:Hotel',
}

const OPEN_CATEGORY_RE = /^(?:\d{4}-\d{2}-\d{2}\s+)?open\s+((?:Expenses|Income|Equity):[A-Za-z0-9:_-]+)\b/

function beancountRoot(): string {
  return process.env.BEANCOUNT_ROOT ?? path.resolve(process.cwd(), '..', 'beancount')
}

function collectBeanFiles(dir: string, depth = 0): string[] {
  if (depth > 3 || !fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectBeanFiles(fullPath, depth + 1))
    } else if (entry.isFile() && entry.name.endsWith('.bean')) {
      files.push(fullPath)
    }
  }
  return files
}

export function loadBeancountCategoryNames(): string[] {
  const root = beancountRoot()
  const rootsToScan = [
    path.join(root, 'accounts'),
    path.join(root, 'book', 'subledgers'),
  ]
  const names = new Set<string>()

  for (const file of rootsToScan.flatMap(dir => collectBeanFiles(dir))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(OPEN_CATEGORY_RE)
      if (match) names.add(match[1])
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

export function loadDefaultCategoryNames(): string[] {
  const beancountCategories = loadBeancountCategoryNames()
  const source = beancountCategories.length > 0 ? beancountCategories : BEANCOUNT_CATEGORY_FALLBACKS
  return Array.from(new Set([...source, ...REVIEW_CATEGORY_NAMES, ...INTERNAL_CATEGORY_NAMES, 'Other']))
    .sort((a, b) => a.localeCompare(b))
}

export const DEFAULT_CLASSIFICATION_RULES: DefaultClassificationRule[] = [
  { pattern: '(PAYROLL|DIRECT DEP|SALARY)', category: 'Income:Salary', priority: 80 },
  { pattern: '(INTEREST|DIVIDEND)', category: 'Income:Investment:Interest', priority: 70 },
  { pattern: '(CASHBACK|REWARD|STATEMENT CREDIT)', category: 'Income:Rewards:Cashback', priority: 70 },
  { pattern: '(CREDIT CARD PAYMENT|AUTOPAY|EPAYMENT)', category: 'Transfer:CreditCardPayment', priority: 85 },
  { pattern: '(TRANSFER|ACH|ZELLE|VENMO|PAYPAL)', category: 'Transfer:Internal', priority: 60 },
  { pattern: '(AIRLINE|FLIGHT|AIRWAYS)', category: 'Expenses:Travel:Flight', priority: 60 },
  { pattern: '(HOTEL|LODGE|RESORT)', category: 'Expenses:Travel:Hotel', priority: 60 },
  { pattern: '(RESTAURANT|CAFE|COFFEE|EATS)', category: 'Expenses:Food:Restaurants', priority: 60 },
  { pattern: '(GROCERY|MARKET|SUPERMARKET)', category: 'Expenses:Food:Groceries', priority: 60 },
  { pattern: '(PHARMACY|MEDICAL|CLINIC)', category: 'Expenses:Health:Medical', priority: 60 },
  { pattern: '(RIDESHARE|TAXI|TRANSIT|TRAIN)', category: 'Expenses:Transport:Taxi', priority: 60 },
  { pattern: '(FUEL|GAS STATION)', category: 'Expenses:Transport:Gas', priority: 60 },
  { pattern: '(INTERNET|MOBILE|PHONE|UTILITY)', category: 'Expenses:Home:Utilities', priority: 60 },
  { pattern: '(SUBSCRIPTION|STREAMING|SOFTWARE)', category: 'Expenses:Entertainment:Subscriptions', priority: 60 },
  { pattern: '(ANNUAL FEE|SERVICE FEE|WIRE FEE)', category: 'Expenses:Fees:Financial', priority: 60 },
]
