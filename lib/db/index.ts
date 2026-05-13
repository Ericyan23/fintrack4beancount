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
function sqlIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`)
  }
  return `"${name}"`
}

function columnExists(tableName: string, columnName: string): boolean {
  const table = sqlIdentifier(tableName)
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === columnName)
}

function addColumnIfMissing(tableName: string, columnName: string, columnSql: string): boolean {
  if (columnExists(tableName, columnName)) return false
  sqlite.exec(`ALTER TABLE ${sqlIdentifier(tableName)} ADD COLUMN ${columnSql}`)
  return true
}

if (addColumnIfMissing('transactions', 'status', `status TEXT NOT NULL DEFAULT 'posted'`)) {
  sqlite.exec(`UPDATE transactions SET status = 'pending' WHERE pending = 1`)
}

addColumnIfMissing('accounts', 'org_name', `org_name TEXT`)
addColumnIfMissing('accounts', 'org_domain', `org_domain TEXT`)
addColumnIfMissing('accounts', 'account_type_override', `account_type_override TEXT`)
addColumnIfMissing('accounts', 'beancount_account', `beancount_account TEXT`)

function backfillLegacyIngestionSources(): void {
  const timestamp = Math.floor(Date.now() / 1000)
  const insertSource = sqlite.prepare(`
    INSERT OR IGNORE INTO sources
      (id, kind, name, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, 'active', NULL, ?, ?)
  `)

  sqlite.transaction(() => {
    insertSource.run('simplefin', 'simplefin', 'SimpleFIN', timestamp, timestamp)
    insertSource.run('csv', 'csv', 'CSV Import', timestamp, timestamp)

    sqlite.prepare(`
      INSERT OR IGNORE INTO sources
        (id, kind, name, status, metadata, created_at, updated_at)
      SELECT DISTINCT source, 'legacy', source, 'active', NULL, ?, ?
      FROM transactions
      WHERE source IS NOT NULL
        AND source != ''
        AND source NOT IN ('simplefin', 'csv')
    `).run(timestamp, timestamp)

    sqlite.prepare(`
      INSERT OR IGNORE INTO source_connections
        (id, source_id, name, status, config, created_at, updated_at)
      VALUES ('legacy:csv', 'csv', 'Legacy CSV Imports', 'active', NULL, ?, ?)
    `).run(timestamp, timestamp)

    sqlite.prepare(`
      INSERT OR IGNORE INTO source_connections
        (id, source_id, name, status, config, created_at, updated_at)
      SELECT DISTINCT
        'legacy:simplefin:' || conn_id,
        'simplefin',
        CASE
          WHEN org_name IS NOT NULL AND org_name != '' THEN org_name
          ELSE conn_id
        END,
        'active',
        NULL,
        ?,
        ?
      FROM accounts
      WHERE conn_id IS NOT NULL
        AND conn_id != ''
    `).run(timestamp, timestamp)

    sqlite.prepare(`
      INSERT OR IGNORE INTO source_accounts
        (id, source_connection_id, fintrack_account_id, external_account_id,
         name, currency, status, raw_payload, created_at, updated_at)
      SELECT
        'legacy:simplefin:' || conn_id || ':' || id,
        'legacy:simplefin:' || conn_id,
        id,
        id,
        name,
        currency,
        'active',
        NULL,
        ?,
        ?
      FROM accounts
      WHERE conn_id IS NOT NULL
        AND conn_id != ''
    `).run(timestamp, timestamp)

    sqlite.prepare(`
      INSERT OR IGNORE INTO source_accounts
        (id, source_connection_id, fintrack_account_id, external_account_id,
         name, currency, status, raw_payload, created_at, updated_at)
      SELECT
        'legacy:csv:' || id,
        'legacy:csv',
        id,
        id,
        name,
        currency,
        'active',
        NULL,
        ?,
        ?
      FROM accounts
    `).run(timestamp, timestamp)

    sqlite.prepare(`
      UPDATE transactions
      SET
        source_connection_id = COALESCE(
          source_connection_id,
          (SELECT 'legacy:simplefin:' || accounts.conn_id FROM accounts WHERE accounts.id = transactions.account_id)
        ),
        source_account_id = COALESCE(
          source_account_id,
          (SELECT 'legacy:simplefin:' || accounts.conn_id || ':' || accounts.id FROM accounts WHERE accounts.id = transactions.account_id)
        ),
        external_id = COALESCE(external_id, id),
        source_item_key = COALESCE(source_item_key, account_id || ':' || id),
        normalizer_version = COALESCE(normalizer_version, 'legacy-simplefin-v1'),
        updated_at = COALESCE(updated_at, created_at, ?)
      WHERE source = 'simplefin'
        AND EXISTS (
          SELECT 1
          FROM accounts
          WHERE accounts.id = transactions.account_id
            AND accounts.conn_id IS NOT NULL
            AND accounts.conn_id != ''
        )
        AND (
          source_connection_id IS NULL
          OR source_account_id IS NULL
          OR external_id IS NULL
          OR source_item_key IS NULL
          OR normalizer_version IS NULL
          OR updated_at IS NULL
        )
    `).run(timestamp)

    sqlite.prepare(`
      UPDATE transactions
      SET
        source_connection_id = COALESCE(source_connection_id, 'legacy:csv'),
        source_account_id = COALESCE(source_account_id, 'legacy:csv:' || account_id),
        external_id = COALESCE(external_id, id),
        source_item_key = COALESCE(source_item_key, account_id || ':' || id),
        normalizer_version = COALESCE(normalizer_version, 'legacy-csv-v1'),
        updated_at = COALESCE(updated_at, created_at, ?)
      WHERE source = 'csv'
        AND EXISTS (
          SELECT 1
          FROM accounts
          WHERE accounts.id = transactions.account_id
        )
        AND (
          source_connection_id IS NULL
          OR source_account_id IS NULL
          OR external_id IS NULL
          OR source_item_key IS NULL
          OR normalizer_version IS NULL
          OR updated_at IS NULL
        )
    `).run(timestamp)
  })()
}

function ensureIngestionSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_profiles (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES sources(id),
      kind TEXT NOT NULL DEFAULT 'csv',
      name TEXT NOT NULL,
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_connections (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_accounts (
      id TEXT PRIMARY KEY,
      source_connection_id TEXT NOT NULL REFERENCES source_connections(id),
      fintrack_account_id TEXT REFERENCES accounts(id),
      external_account_id TEXT NOT NULL,
      name TEXT,
      currency TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      raw_payload TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_runs (
      id TEXT PRIMARY KEY,
      source_connection_id TEXT REFERENCES source_connections(id),
      import_profile_id TEXT REFERENCES import_profiles(id),
      status TEXT NOT NULL DEFAULT 'pending',
      started_at INTEGER,
      finished_at INTEGER,
      item_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_import_items (
      id TEXT PRIMARY KEY,
      import_run_id TEXT NOT NULL REFERENCES import_runs(id),
      source_account_id TEXT REFERENCES source_accounts(id),
      external_id TEXT,
      source_item_key TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      received_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staged_transactions (
      id TEXT PRIMARY KEY,
      import_run_id TEXT REFERENCES import_runs(id),
      raw_item_id TEXT REFERENCES raw_import_items(id),
      source_connection_id TEXT REFERENCES source_connections(id),
      source_account_id TEXT REFERENCES source_accounts(id),
      account_id TEXT REFERENCES accounts(id),
      transaction_id TEXT REFERENCES transactions(id),
      external_id TEXT,
      source_item_key TEXT,
      posted INTEGER,
      transacted_at INTEGER,
      amount TEXT,
      currency TEXT,
      description TEXT,
      pending INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'staged',
      category TEXT,
      notes TEXT,
      tags TEXT,
      normalized_payload TEXT,
      validation_errors TEXT,
      normalizer_version TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_profile_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_profile_id TEXT NOT NULL REFERENCES import_profiles(id),
      target_field TEXT NOT NULL,
      source_field TEXT,
      transform TEXT,
      default_value TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  addColumnIfMissing(
    'transactions',
    'source_connection_id',
    `source_connection_id TEXT REFERENCES source_connections(id)`,
  )
  addColumnIfMissing(
    'transactions',
    'source_account_id',
    `source_account_id TEXT REFERENCES source_accounts(id)`,
  )
  addColumnIfMissing('transactions', 'external_id', `external_id TEXT`)
  addColumnIfMissing('transactions', 'source_item_key', `source_item_key TEXT`)
  addColumnIfMissing('transactions', 'import_run_id', `import_run_id TEXT REFERENCES import_runs(id)`)
  addColumnIfMissing('transactions', 'raw_item_id', `raw_item_id TEXT REFERENCES raw_import_items(id)`)
  addColumnIfMissing('transactions', 'normalizer_version', `normalizer_version TEXT`)
  addColumnIfMissing('transactions', 'updated_at', `updated_at INTEGER`)

  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS import_profiles_source_idx
    ON import_profiles(source_id);

    CREATE INDEX IF NOT EXISTS source_connections_source_idx
    ON source_connections(source_id);

    CREATE UNIQUE INDEX IF NOT EXISTS source_accounts_connection_external_idx
    ON source_accounts(source_connection_id, external_account_id);

    CREATE INDEX IF NOT EXISTS source_accounts_fintrack_account_idx
    ON source_accounts(fintrack_account_id);

    CREATE INDEX IF NOT EXISTS import_runs_connection_idx
    ON import_runs(source_connection_id);

    CREATE INDEX IF NOT EXISTS import_runs_profile_idx
    ON import_runs(import_profile_id);

    CREATE INDEX IF NOT EXISTS import_runs_status_idx
    ON import_runs(status);

    CREATE UNIQUE INDEX IF NOT EXISTS raw_import_items_run_key_idx
    ON raw_import_items(import_run_id, source_item_key);

    CREATE INDEX IF NOT EXISTS raw_import_items_source_account_idx
    ON raw_import_items(source_account_id);

    CREATE INDEX IF NOT EXISTS raw_import_items_status_idx
    ON raw_import_items(status);

    CREATE INDEX IF NOT EXISTS staged_transactions_import_run_idx
    ON staged_transactions(import_run_id);

    CREATE INDEX IF NOT EXISTS staged_transactions_raw_item_idx
    ON staged_transactions(raw_item_id);

    CREATE INDEX IF NOT EXISTS staged_transactions_status_idx
    ON staged_transactions(status);

    CREATE INDEX IF NOT EXISTS staged_transactions_account_idx
    ON staged_transactions(account_id);

    CREATE INDEX IF NOT EXISTS import_profile_mappings_profile_idx
    ON import_profile_mappings(import_profile_id);

    CREATE UNIQUE INDEX IF NOT EXISTS import_profile_mappings_target_idx
    ON import_profile_mappings(import_profile_id, target_field);

    CREATE INDEX IF NOT EXISTS transactions_source_connection_idx
    ON transactions(source_connection_id);

    CREATE INDEX IF NOT EXISTS transactions_source_account_idx
    ON transactions(source_account_id);

    CREATE INDEX IF NOT EXISTS transactions_import_run_idx
    ON transactions(import_run_id);

    CREATE INDEX IF NOT EXISTS transactions_raw_item_idx
    ON transactions(raw_item_id);

    CREATE UNIQUE INDEX IF NOT EXISTS transactions_source_connection_item_key_idx
    ON transactions(source_connection_id, source_item_key);

    CREATE INDEX IF NOT EXISTS transactions_source_item_key_idx
    ON transactions(source_item_key);
  `)

  backfillLegacyIngestionSources()
}

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

ensureIngestionSchema()
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
