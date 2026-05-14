import { sqlite } from '@/lib/db'
import {
  accountStateOn,
  defaultBeancountRoot,
  loadLedgerSnapshot,
  type LedgerSnapshot,
} from '@/lib/export/beancount-ledger'

export interface CategoryImpact {
  transactions: number
  suggestions: number
  rules: number
}

export type CategoryBeancountStatus =
  | 'open'
  | 'missing'
  | 'not_yet_open'
  | 'closed'
  | 'not_applicable'
  | 'unavailable'

export interface CategoryRow extends CategoryImpact {
  name: string
  is_default: number
  usage_count: number
  is_required: number
  is_virtual: number
  beancount_status: CategoryBeancountStatus
  beancount_open_date: string | null
  beancount_close_date: string | null
  beancount_error: string | null
}

const REQUIRED_CATEGORIES = new Set(['Other', 'Uncategorized'])

export function isRequiredCategory(name: string): boolean {
  return REQUIRED_CATEGORIES.has(name)
}

export function loadCategories(): string[] {
  return (sqlite.prepare('SELECT name FROM categories ORDER BY name').all() as { name: string }[])
    .map(r => r.name)
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function isBeancountCategory(name: string): boolean {
  return (
    name.startsWith('Assets:')
    || name.startsWith('Liabilities:')
    || name.startsWith('Expenses:')
    || name.startsWith('Income:')
    || name.startsWith('Equity:')
  )
}

function ledgerStatusForCategory(
  name: string,
  snapshot: LedgerSnapshot | null,
  date: string,
  error: string | null,
): Pick<CategoryRow, 'beancount_status' | 'beancount_open_date' | 'beancount_close_date' | 'beancount_error'> {
  if (!isBeancountCategory(name)) {
    return {
      beancount_status: 'not_applicable',
      beancount_open_date: null,
      beancount_close_date: null,
      beancount_error: null,
    }
  }

  if (!snapshot) {
    return {
      beancount_status: 'unavailable',
      beancount_open_date: null,
      beancount_close_date: null,
      beancount_error: error,
    }
  }

  const state = accountStateOn(snapshot, name, date)
  if (state.ok) {
    return {
      beancount_status: 'open',
      beancount_open_date: state.state.openDate,
      beancount_close_date: state.state.closeDate,
      beancount_error: null,
    }
  }

  return {
    beancount_status: state.reason === 'missing' ? 'missing' : state.reason,
    beancount_open_date: state.state?.openDate ?? null,
    beancount_close_date: state.state?.closeDate ?? null,
    beancount_error: null,
  }
}

function loadLedgerForCategoryStatus(): { snapshot: LedgerSnapshot | null; error: string | null } {
  try {
    return { snapshot: loadLedgerSnapshot(defaultBeancountRoot()), error: null }
  } catch (err) {
    return { snapshot: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export function loadCategoriesWithStats(): CategoryRow[] {
  const rows = sqlite.prepare(`
    SELECT
      c.name,
      c.is_default,
      (SELECT COUNT(*) FROM transactions t WHERE (t.ledger_account = c.name OR t.category = c.name) AND t.status != 'cancelled') AS transactions,
      (SELECT COUNT(*) FROM transactions s WHERE (s.suggested_ledger_account = c.name OR s.suggested_cat = c.name) AND s.status != 'cancelled') AS suggestions,
      (SELECT COUNT(*) FROM rules r WHERE r.category = c.name) AS rules
    FROM categories c
    ORDER BY c.name
  `).all() as Array<Omit<
    CategoryRow,
    | 'usage_count'
    | 'is_required'
    | 'is_virtual'
    | 'beancount_status'
    | 'beancount_open_date'
    | 'beancount_close_date'
    | 'beancount_error'
  >>

  const ledger = loadLedgerForCategoryStatus()
  const statusDate = currentDate()

  const result: CategoryRow[] = rows.map(row => ({
    ...row,
    usage_count: row.transactions,
    is_required: isRequiredCategory(row.name) ? 1 : 0,
    is_virtual: 0,
    ...ledgerStatusForCategory(row.name, ledger.snapshot, statusDate, ledger.error),
  }))

  const uncategorized = getCategoryImpact('Uncategorized')
  if (!result.some(row => row.name === 'Uncategorized')) {
    result.unshift({
      name: 'Uncategorized',
      is_default: 1,
      usage_count: uncategorized.transactions,
      transactions: uncategorized.transactions,
      suggestions: uncategorized.suggestions,
      rules: uncategorized.rules,
      is_required: 1,
      is_virtual: 1,
      beancount_status: 'not_applicable',
      beancount_open_date: null,
      beancount_close_date: null,
      beancount_error: null,
    })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export function getCategoryImpact(name: string): CategoryImpact {
  if (name === 'Uncategorized') {
    const row = sqlite.prepare(`
      SELECT
        COUNT(CASE WHEN (ledger_account IS NULL OR ledger_account = '') AND status != 'cancelled' THEN 1 END) as transactions,
        0 as suggestions,
        0 as rules
      FROM transactions
    `).get() as CategoryImpact
    return row
  }

  return sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM transactions WHERE (ledger_account = ? OR category = ?) AND status != 'cancelled') as transactions,
      (SELECT COUNT(*) FROM transactions WHERE (suggested_ledger_account = ? OR suggested_cat = ?) AND status != 'cancelled') as suggestions,
      (SELECT COUNT(*) FROM rules WHERE category = ?) as rules
  `).get(name, name, name, name, name) as CategoryImpact
}

function validateName(name: string): string | null {
  if (!name.trim()) return 'Category name is required'
  if (name.includes('\n') || name.includes('\r')) return 'Category name cannot contain line breaks'
  if (name.length > 80) return 'Category name is too long'
  return null
}

function categoryExists(name: string): boolean {
  return Boolean(sqlite.prepare('SELECT 1 FROM categories WHERE name = ?').get(name))
}

export function addCategory(name: string): { error?: string } {
  const err = validateName(name)
  if (err) return { error: err }
  if (name === 'Uncategorized') return { error: 'Uncategorized is a system virtual category and cannot be created manually' }
  if (categoryExists(name)) return { error: `Category "${name}" already exists` }

  sqlite.prepare('INSERT INTO categories (name, is_default) VALUES (?, 0)').run(name)
  return {}
}

export function deleteCategory(name: string): { error?: string } {
  if (isRequiredCategory(name)) return { error: `${name} is a system-reserved category and cannot be deleted` }
  if (!categoryExists(name)) return { error: `Category "${name}" does not exist` }
  const impact = getCategoryImpact(name)
  if (impact.transactions > 0) return { error: `${impact.transactions} transactions use this category; merge it first` }
  if (impact.suggestions > 0) return { error: `${impact.suggestions} AI suggestions use this category; merge it first` }
  if (impact.rules > 0) return { error: `${impact.rules} rules use this category; merge it first` }
  sqlite.prepare('DELETE FROM categories WHERE name = ?').run(name)
  return {}
}

export function renameCategory(from: string, to: string): { error?: string } {
  if (isRequiredCategory(from)) return { error: `${from} is a system-reserved category and cannot be renamed` }
  const err = validateName(to)
  if (err) return { error: err }
  if (isRequiredCategory(to)) return { error: `${to} is a system-reserved category and cannot be used as a rename target` }
  if (!categoryExists(from)) return { error: `Category "${from}" does not exist` }
  if (from === to) return {}
  if (categoryExists(to)) return { error: `Category "${to}" already exists. Use merge if you want to combine them` }

  sqlite.transaction(() => {
    sqlite.prepare('INSERT OR IGNORE INTO categories (name, is_default) VALUES (?, 0)').run(to)
    sqlite.prepare(`UPDATE transactions SET category = ? WHERE category = ?`).run(to, from)
    sqlite.prepare(`UPDATE transactions SET suggested_cat = ? WHERE suggested_cat = ?`).run(to, from)
    sqlite.prepare(`UPDATE transactions SET ledger_account = ? WHERE ledger_account = ?`).run(to, from)
    sqlite.prepare(`UPDATE transactions SET suggested_ledger_account = ? WHERE suggested_ledger_account = ?`).run(to, from)
    sqlite.prepare(`UPDATE rules SET category = ? WHERE category = ?`).run(to, from)
    sqlite.prepare('DELETE FROM categories WHERE name = ?').run(from)
  })()
  return {}
}

export function mergeCategories(source: string, target: string): { count: number; error?: string } {
  if (isRequiredCategory(source)) return { count: 0, error: `${source} is a system-reserved category and cannot be merged` }
  if (target === 'Uncategorized') return { count: 0, error: 'Cannot merge into Uncategorized; use a specific category or Other' }
  if (!categoryExists(source)) return { count: 0, error: `Source category "${source}" does not exist` }
  if (!categoryExists(target)) return { count: 0, error: `Target category "${target}" does not exist` }

  let count = 0
  sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE transactions SET category = ? WHERE category = ?`).run(target, source)
    count = result.changes
    sqlite.prepare(`UPDATE transactions SET suggested_cat = ? WHERE suggested_cat = ?`).run(target, source)
    sqlite.prepare(`UPDATE transactions SET ledger_account = ? WHERE ledger_account = ?`).run(target, source)
    sqlite.prepare(`UPDATE transactions SET suggested_ledger_account = ? WHERE suggested_ledger_account = ?`).run(target, source)
    sqlite.prepare(`UPDATE rules SET category = ? WHERE category = ?`).run(target, source)
    sqlite.prepare('DELETE FROM categories WHERE name = ?').run(source)
  })()
  return { count }
}
