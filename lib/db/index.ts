import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import path from 'path'
import fs from 'fs'
import * as schema from './schema'
import { detectAccountType } from '../accounts'
import {
  DEFAULT_CLASSIFICATION_RULES,
  LEGACY_CATEGORY_MAP,
  loadDefaultCategoryNames,
} from '../classify/defaults'

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'fintrack.db')

const dbDir = path.dirname(DB_PATH)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

// Singleton to avoid multiple connections in Next.js dev HMR
declare global {
  // eslint-disable-next-line no-var
  var __sqlite: Database.Database | undefined
}

const sqlite: Database.Database =
  global.__sqlite ??
  (() => {
    const db = new Database(DB_PATH)
    db.pragma('busy_timeout = 5000')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        balance TEXT NOT NULL,
        balance_date INTEGER NOT NULL,
        conn_id TEXT NOT NULL,
        org_name TEXT,
        org_domain TEXT,
        account_type TEXT NOT NULL DEFAULT 'depository',
        account_type_override TEXT,
        beancount_account TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        source TEXT NOT NULL DEFAULT 'simplefin',
        posted INTEGER NOT NULL,
        transacted_at INTEGER,
        amount TEXT NOT NULL,
        description TEXT NOT NULL,
        pending INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        suggested_cat TEXT,
        notes TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transfer_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        outflow_transaction_id TEXT NOT NULL REFERENCES transactions(id),
        inflow_transaction_id TEXT NOT NULL REFERENCES transactions(id),
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'suggested',
        confidence INTEGER NOT NULL,
        date_delta_days INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS transfer_matches_pair_idx
      ON transfer_matches(outflow_transaction_id, inflow_transaction_id);

      CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        synced_at INTEGER NOT NULL,
        new_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS net_worth_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_at INTEGER NOT NULL,
        assets TEXT NOT NULL,
        liabilities TEXT NOT NULL,
        net_worth TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS balance_assertions (
        id TEXT PRIMARY KEY,
        fintrack_account_id TEXT REFERENCES accounts(id),
        beancount_account TEXT NOT NULL,
        assertion_date TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        source_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'draft',
        note TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS balance_assertions_date_idx
      ON balance_assertions(assertion_date);
    `)
    return db
  })()

if (process.env.NODE_ENV !== 'production') {
  global.__sqlite = sqlite
}

// Migrations — run after singleton is resolved so they execute even on HMR reuse
function addColumnIfMissing(sql: string): void {
  try {
    sqlite.exec(sql)
  } catch {
    // column already exists
  }
}

try {
  sqlite.exec(`ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'`)
  sqlite.exec(`UPDATE transactions SET status = 'pending' WHERE pending = 1`)
} catch { /* column already exists */ }

addColumnIfMissing(`ALTER TABLE accounts ADD COLUMN org_name TEXT`)
addColumnIfMissing(`ALTER TABLE accounts ADD COLUMN org_domain TEXT`)
addColumnIfMissing(`ALTER TABLE accounts ADD COLUMN account_type_override TEXT`)
addColumnIfMissing(`ALTER TABLE accounts ADD COLUMN beancount_account TEXT`)

function ensurePerformanceIndexes(): void {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS transactions_posted_idx
    ON transactions(posted DESC);

    CREATE INDEX IF NOT EXISTS transactions_status_posted_idx
    ON transactions(status, posted DESC);

    CREATE INDEX IF NOT EXISTS transactions_account_posted_idx
    ON transactions(account_id, posted DESC);

    CREATE INDEX IF NOT EXISTS transactions_account_status_posted_idx
    ON transactions(account_id, status, posted DESC);

    CREATE INDEX IF NOT EXISTS transactions_category_status_idx
    ON transactions(category, status);

    CREATE INDEX IF NOT EXISTS transactions_suggested_status_idx
    ON transactions(suggested_cat, status);

    CREATE INDEX IF NOT EXISTS transactions_pending_cleanup_idx
    ON transactions(account_id, status, created_at);

    CREATE INDEX IF NOT EXISTS transfer_matches_status_idx
    ON transfer_matches(status);

    CREATE INDEX IF NOT EXISTS transfer_matches_outflow_idx
    ON transfer_matches(outflow_transaction_id);

    CREATE INDEX IF NOT EXISTS transfer_matches_inflow_idx
    ON transfer_matches(inflow_transaction_id);

    CREATE INDEX IF NOT EXISTS sync_log_synced_at_idx
    ON sync_log(synced_at DESC);

    CREATE INDEX IF NOT EXISTS net_worth_snapshots_snapshot_idx
    ON net_worth_snapshots(snapshot_at DESC);

    CREATE INDEX IF NOT EXISTS rules_priority_idx
    ON rules(priority DESC);

    CREATE INDEX IF NOT EXISTS rules_category_idx
    ON rules(category);
  `)
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS transfer_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outflow_transaction_id TEXT NOT NULL REFERENCES transactions(id),
    inflow_transaction_id TEXT NOT NULL REFERENCES transactions(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'suggested',
    confidence INTEGER NOT NULL,
    date_delta_days INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS transfer_matches_pair_idx
  ON transfer_matches(outflow_transaction_id, inflow_transaction_id);
`)

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS balance_assertions (
    id TEXT PRIMARY KEY,
    fintrack_account_id TEXT REFERENCES accounts(id),
    beancount_account TEXT NOT NULL,
    assertion_date TEXT NOT NULL,
    amount TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    source_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft',
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS balance_assertions_date_idx
  ON balance_assertions(assertion_date);
`)

ensurePerformanceIndexes()

const accountTypeRows = sqlite.prepare(`
  SELECT id, name, org_name AS orgName, account_type AS accountType,
         account_type_override AS accountTypeOverride
  FROM accounts
`).all() as Array<{
  id: string
  name: string
  orgName: string | null
  accountType: string
  accountTypeOverride: string | null
}>
const updateAccountType = sqlite.prepare('UPDATE accounts SET account_type = ? WHERE id = ?')
for (const account of accountTypeRows) {
  const detected = detectAccountType(account.name, account.orgName ?? '')
  const effective = account.accountTypeOverride || detected
  if (account.accountType !== effective) {
    updateAccountType.run(effective, account.id)
  }
}

// Categories table migration
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    is_default INTEGER NOT NULL DEFAULT 0
  )
`)

// Seed default categories (idempotent)
const DEFAULT_CATEGORY_NAMES = loadDefaultCategoryNames()
const seedStmt = sqlite.prepare('INSERT OR IGNORE INTO categories (name, is_default) VALUES (?, 1)')
for (const name of DEFAULT_CATEGORY_NAMES) seedStmt.run(name)

const legacyCategoryTargets = new Set(Object.values(LEGACY_CATEGORY_MAP))
for (const name of legacyCategoryTargets) seedStmt.run(name)

const updateTransactionCategory = sqlite.prepare('UPDATE transactions SET category = ? WHERE category = ?')
const updateTransactionSuggestion = sqlite.prepare('UPDATE transactions SET suggested_cat = ? WHERE suggested_cat = ?')
const updateRuleCategory = sqlite.prepare('UPDATE rules SET category = ? WHERE category = ?')
const deleteUnusedCategory = sqlite.prepare(`
  DELETE FROM categories
  WHERE name = ?
    AND NOT EXISTS (SELECT 1 FROM transactions WHERE category = ? OR suggested_cat = ?)
    AND NOT EXISTS (SELECT 1 FROM rules WHERE category = ?)
`)
for (const [legacyName, targetName] of Object.entries(LEGACY_CATEGORY_MAP)) {
  updateTransactionCategory.run(targetName, legacyName)
  updateTransactionSuggestion.run(targetName, legacyName)
  updateRuleCategory.run(targetName, legacyName)
  deleteUnusedCategory.run(legacyName, legacyName, legacyName, legacyName)
}

// Migrate custom categories from old settings JSON blob (one-time)
const oldCustomRaw = sqlite.prepare(`SELECT value FROM settings WHERE key = 'user_categories'`).get() as { value: string } | undefined
if (oldCustomRaw) {
  try {
    const custom = JSON.parse(oldCustomRaw.value) as string[]
    const customStmt = sqlite.prepare('INSERT OR IGNORE INTO categories (name, is_default) VALUES (?, 0)')
    for (const name of custom) customStmt.run(name)
  } catch { /* malformed JSON, skip */ }
  sqlite.prepare(`DELETE FROM settings WHERE key = 'user_categories'`).run()
}

const ruleExists = sqlite.prepare('SELECT 1 FROM rules WHERE pattern = ? AND category = ?')
const seedRule = sqlite.prepare(`
  INSERT INTO rules (pattern, category, priority, created_at)
  VALUES (?, ?, ?, ?)
`)
for (const rule of DEFAULT_CLASSIFICATION_RULES) {
  if (ruleExists.get(rule.pattern, rule.category)) continue
  seedRule.run(rule.pattern, rule.category, rule.priority, Math.floor(Date.now() / 1000))
}

const deleteUnsafeRule = sqlite.prepare('DELETE FROM rules WHERE pattern = ? AND category = ?')
for (const pattern of ['\\bpayment\\b', 'payment']) {
  deleteUnsafeRule.run(pattern, 'Transfer:CreditCardPayment')
}

export const db = drizzle(sqlite, { schema })

export function getSetting(key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export { sqlite }
