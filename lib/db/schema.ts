import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  currency:    text('currency').notNull().default('USD'),
  balance:     text('balance').notNull(),
  balanceDate: integer('balance_date').notNull(),
  connId:      text('conn_id').notNull(),
  orgName:     text('org_name'),
  orgDomain:   text('org_domain'),
  accountType: text('account_type').notNull().default('depository'), // 'depository' | 'credit' | 'investment' | 'loan'
  accountTypeOverride: text('account_type_override'),
  beancountAccount: text('beancount_account'),
  updatedAt:   integer('updated_at').notNull(),
})

export const transactions = sqliteTable('transactions', {
  id:           text('id').primaryKey(),
  accountId:    text('account_id').notNull().references(() => accounts.id),
  source:       text('source').notNull().default('simplefin'),
  posted:       integer('posted').notNull(),
  transactedAt: integer('transacted_at'),
  amount:       text('amount').notNull(),
  description:  text('description').notNull(),
  pending:      integer('pending', { mode: 'boolean' }).notNull().default(false),
  status:       text('status').notNull().default('posted'), // 'pending' | 'posted' | 'cancelled'
  category:     text('category'),
  suggestedCat: text('suggested_cat'),
  notes:        text('notes'),
  tags:         text('tags', { mode: 'json' }).$type<string[]>(),
  createdAt:    integer('created_at').notNull(),
})

export const transferMatches = sqliteTable('transfer_matches', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  outflowTransactionId: text('outflow_transaction_id').notNull().references(() => transactions.id),
  inflowTransactionId:  text('inflow_transaction_id').notNull().references(() => transactions.id),
  kind:      text('kind').notNull(), // credit_card_payment | internal | wallet | investment | other
  status:    text('status').notNull().default('suggested'), // suggested | confirmed | ignored
  confidence: integer('confidence').notNull(),
  dateDeltaDays: integer('date_delta_days').notNull(),
  reason:    text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const categories = sqliteTable('categories', {
  name:      text('name').primaryKey(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
})

export const rules = sqliteTable('rules', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  pattern:   text('pattern').notNull(),
  category:  text('category').notNull(),
  priority:  integer('priority').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const syncLog = sqliteTable('sync_log', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  syncedAt: integer('synced_at').notNull(),
  newCount: integer('new_count').notNull().default(0),
  error:    text('error'),
})

export const settings = sqliteTable('settings', {
  key:   text('key').primaryKey(),
  value: text('value').notNull(),
})

export const netWorthSnapshots = sqliteTable('net_worth_snapshots', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  snapshotAt:  integer('snapshot_at').notNull(),
  assets:      text('assets').notNull(),
  liabilities: text('liabilities').notNull(),
  netWorth:    text('net_worth').notNull(),
})

export const balanceAssertions = sqliteTable('balance_assertions', {
  id: text('id').primaryKey(),
  fintrackAccountId: text('fintrack_account_id').references(() => accounts.id),
  beancountAccount: text('beancount_account').notNull(),
  assertionDate: text('assertion_date').notNull(),
  amount: text('amount').notNull(),
  currency: text('currency').notNull().default('USD'),
  sourceId: text('source_id').notNull(),
  status: text('status').notNull().default('draft'), // draft | staged | merged | rejected
  note: text('note'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type Account = typeof accounts.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type TransferMatch = typeof transferMatches.$inferSelect
export type Category = typeof categories.$inferSelect
export type Rule = typeof rules.$inferSelect
export type SyncLog = typeof syncLog.$inferSelect
export type NetWorthSnapshot = typeof netWorthSnapshots.$inferSelect
export type BalanceAssertion = typeof balanceAssertions.$inferSelect
