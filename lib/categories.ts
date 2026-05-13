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
      (SELECT COUNT(*) FROM transactions t WHERE t.category = c.name AND t.status != 'cancelled') AS transactions,
      (SELECT COUNT(*) FROM transactions s WHERE s.suggested_cat = c.name AND s.status != 'cancelled') AS suggestions,
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
        COUNT(CASE WHEN (category IS NULL OR category = '') AND status != 'cancelled' THEN 1 END) as transactions,
        0 as suggestions,
        0 as rules
      FROM transactions
    `).get() as CategoryImpact
    return row
  }

  return sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM transactions WHERE category = ? AND status != 'cancelled') as transactions,
      (SELECT COUNT(*) FROM transactions WHERE suggested_cat = ? AND status != 'cancelled') as suggestions,
      (SELECT COUNT(*) FROM rules WHERE category = ?) as rules
  `).get(name, name, name) as CategoryImpact
}

function validateName(name: string): string | null {
  if (!name.trim()) return '分类名称不能为空'
  if (name.includes('\n') || name.includes('\r')) return '分类名称不能包含换行'
  if (name.length > 80) return '分类名称过长'
  return null
}

function categoryExists(name: string): boolean {
  return Boolean(sqlite.prepare('SELECT 1 FROM categories WHERE name = ?').get(name))
}

export function addCategory(name: string): { error?: string } {
  const err = validateName(name)
  if (err) return { error: err }
  if (name === 'Uncategorized') return { error: 'Uncategorized 是系统虚拟分类，不能手动创建' }
  if (categoryExists(name)) return { error: `分类 "${name}" 已存在` }

  sqlite.prepare('INSERT INTO categories (name, is_default) VALUES (?, 0)').run(name)
  return {}
}

export function deleteCategory(name: string): { error?: string } {
  if (isRequiredCategory(name)) return { error: `${name} 是系统保留分类，不能删除` }
  if (!categoryExists(name)) return { error: `分类 "${name}" 不存在` }
  const impact = getCategoryImpact(name)
  if (impact.transactions > 0) return { error: `${impact.transactions} 条交易正在使用此分类，无法删除；请先合并` }
  if (impact.suggestions > 0) return { error: `${impact.suggestions} 条 AI 建议正在使用此分类，无法删除；请先合并` }
  if (impact.rules > 0) return { error: `${impact.rules} 条规则正在使用此分类，无法删除；请先合并` }
  sqlite.prepare('DELETE FROM categories WHERE name = ?').run(name)
  return {}
}

export function renameCategory(from: string, to: string): { error?: string } {
  if (isRequiredCategory(from)) return { error: `${from} 是系统保留分类，不能改名` }
  const err = validateName(to)
  if (err) return { error: err }
  if (isRequiredCategory(to)) return { error: `${to} 是系统保留分类，不能作为改名目标` }
  if (!categoryExists(from)) return { error: `分类 "${from}" 不存在` }
  if (from === to) return {}
  if (categoryExists(to)) return { error: `分类 "${to}" 已存在，如需合并请使用合并功能` }

  sqlite.transaction(() => {
    sqlite.prepare('INSERT OR IGNORE INTO categories (name, is_default) VALUES (?, 0)').run(to)
    sqlite.prepare(`UPDATE transactions SET category = ? WHERE category = ?`).run(to, from)
    sqlite.prepare(`UPDATE transactions SET suggested_cat = ? WHERE suggested_cat = ?`).run(to, from)
    sqlite.prepare(`UPDATE rules SET category = ? WHERE category = ?`).run(to, from)
    sqlite.prepare('DELETE FROM categories WHERE name = ?').run(from)
  })()
  return {}
}

export function mergeCategories(source: string, target: string): { count: number; error?: string } {
  if (isRequiredCategory(source)) return { count: 0, error: `${source} 是系统保留分类，不能合并` }
  if (target === 'Uncategorized') return { count: 0, error: '不能合并到 Uncategorized；请使用具体分类或 Other' }
  if (!categoryExists(source)) return { count: 0, error: `源分类 "${source}" 不存在` }
  if (!categoryExists(target)) return { count: 0, error: `目标分类 "${target}" 不存在` }

  let count = 0
  sqlite.transaction(() => {
    const result = sqlite.prepare(`UPDATE transactions SET category = ? WHERE category = ?`).run(target, source)
    count = result.changes
    sqlite.prepare(`UPDATE transactions SET suggested_cat = ? WHERE suggested_cat = ?`).run(target, source)
    sqlite.prepare(`UPDATE rules SET category = ? WHERE category = ?`).run(target, source)
    sqlite.prepare('DELETE FROM categories WHERE name = ?').run(source)
  })()
  return { count }
}
