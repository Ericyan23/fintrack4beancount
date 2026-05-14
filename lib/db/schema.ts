import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type {
  ImportProfileKind,
  ImportRunStatus,
  IngestionJsonObject,
  RawImportItemStatus,
  SourceConnectionStatus,
  SourceKind,
  SourceStatus,
  StagedTransactionStatus,
} from '../ingest/types'

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

export const sources = sqliteTable('sources', {
  id:        text('id').primaryKey(),
  kind:      text('kind').notNull().$type<SourceKind>(),
  name:      text('name').notNull(),
  status:    text('status').notNull().default('active').$type<SourceStatus>(),
  metadata:  text('metadata', { mode: 'json' }).$type<IngestionJsonObject>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const importProfiles = sqliteTable('import_profiles', {
  id:        text('id').primaryKey(),
  sourceId:  text('source_id').references(() => sources.id),
  kind:      text('kind').notNull().default('csv').$type<ImportProfileKind>(),
  name:      text('name').notNull(),
  config:    text('config', { mode: 'json' }).$type<IngestionJsonObject>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('import_profiles_source_idx').on(table.sourceId),
])

export const sourceConnections = sqliteTable('source_connections', {
  id:        text('id').primaryKey(),
  sourceId:  text('source_id').notNull().references(() => sources.id),
  name:      text('name').notNull(),
  status:    text('status').notNull().default('active').$type<SourceConnectionStatus>(),
  config:    text('config', { mode: 'json' }).$type<IngestionJsonObject>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('source_connections_source_idx').on(table.sourceId),
])

export const sourceAccounts = sqliteTable('source_accounts', {
  id:                 text('id').primaryKey(),
  sourceConnectionId: text('source_connection_id').notNull().references(() => sourceConnections.id),
  fintrackAccountId:  text('fintrack_account_id').references(() => accounts.id),
  externalAccountId:  text('external_account_id').notNull(),
  name:               text('name'),
  currency:           text('currency'),
  status:             text('status').notNull().default('active').$type<SourceStatus>(),
  rawPayload:         text('raw_payload', { mode: 'json' }).$type<IngestionJsonObject>(),
  createdAt:          integer('created_at').notNull(),
  updatedAt:          integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('source_accounts_connection_external_idx')
    .on(table.sourceConnectionId, table.externalAccountId),
  index('source_accounts_fintrack_account_idx').on(table.fintrackAccountId),
])

export const importRuns = sqliteTable('import_runs', {
  id:                 text('id').primaryKey(),
  sourceConnectionId: text('source_connection_id').references(() => sourceConnections.id),
  importProfileId:    text('import_profile_id').references(() => importProfiles.id),
  status:             text('status').notNull().default('pending').$type<ImportRunStatus>(),
  startedAt:          integer('started_at'),
  finishedAt:         integer('finished_at'),
  itemCount:          integer('item_count').notNull().default(0),
  error:              text('error'),
  createdAt:          integer('created_at').notNull(),
  updatedAt:          integer('updated_at').notNull(),
}, (table) => [
  index('import_runs_connection_idx').on(table.sourceConnectionId),
  index('import_runs_profile_idx').on(table.importProfileId),
  index('import_runs_status_idx').on(table.status),
])

export const rawImportItems = sqliteTable('raw_import_items', {
  id:              text('id').primaryKey(),
  importRunId:     text('import_run_id').notNull().references(() => importRuns.id),
  sourceAccountId: text('source_account_id').references(() => sourceAccounts.id),
  externalId:      text('external_id'),
  sourceItemKey:   text('source_item_key').notNull(),
  rawPayload:      text('raw_payload', { mode: 'json' }).notNull().$type<IngestionJsonObject>(),
  contentHash:     text('content_hash'),
  status:          text('status').notNull().default('pending').$type<RawImportItemStatus>(),
  receivedAt:      integer('received_at'),
  createdAt:       integer('created_at').notNull(),
  updatedAt:       integer('updated_at').notNull(),
}, (table) => [
  uniqueIndex('raw_import_items_run_key_idx').on(table.importRunId, table.sourceItemKey),
  index('raw_import_items_source_account_idx').on(table.sourceAccountId),
  index('raw_import_items_status_idx').on(table.status),
])

export const transactions = sqliteTable('transactions', {
  id:           text('id').primaryKey(),
  accountId:    text('account_id').notNull().references(() => accounts.id),
  sourceConnectionId: text('source_connection_id').references(() => sourceConnections.id),
  sourceAccountId:    text('source_account_id').references(() => sourceAccounts.id),
  externalId:         text('external_id'),
  sourceItemKey:      text('source_item_key'),
  importRunId:        text('import_run_id').references(() => importRuns.id),
  rawItemId:          text('raw_item_id').references(() => rawImportItems.id),
  normalizerVersion:  text('normalizer_version'),
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
  updatedAt:    integer('updated_at'),
}, (table) => [
  index('transactions_source_connection_idx').on(table.sourceConnectionId),
  index('transactions_source_account_idx').on(table.sourceAccountId),
  index('transactions_import_run_idx').on(table.importRunId),
  index('transactions_raw_item_idx').on(table.rawItemId),
  uniqueIndex('transactions_source_connection_item_key_idx')
    .on(table.sourceConnectionId, table.sourceItemKey),
  index('transactions_source_item_key_idx').on(table.sourceItemKey),
])

export const stagedTransactions = sqliteTable('staged_transactions', {
  id:                 text('id').primaryKey(),
  importRunId:        text('import_run_id').references(() => importRuns.id),
  rawItemId:          text('raw_item_id').references(() => rawImportItems.id),
  sourceConnectionId: text('source_connection_id').references(() => sourceConnections.id),
  sourceAccountId:    text('source_account_id').references(() => sourceAccounts.id),
  accountId:          text('account_id').references(() => accounts.id),
  transactionId:      text('transaction_id').references(() => transactions.id),
  externalId:         text('external_id'),
  sourceItemKey:      text('source_item_key'),
  posted:             integer('posted'),
  transactedAt:       integer('transacted_at'),
  amount:             text('amount'),
  currency:           text('currency'),
  description:        text('description'),
  pending:            integer('pending', { mode: 'boolean' }).notNull().default(false),
  status:             text('status').notNull().default('staged').$type<StagedTransactionStatus>(),
  category:           text('category'),
  notes:              text('notes'),
  tags:               text('tags', { mode: 'json' }).$type<string[]>(),
  normalizedPayload:  text('normalized_payload', { mode: 'json' }).$type<IngestionJsonObject>(),
  validationErrors:   text('validation_errors', { mode: 'json' }).$type<string[]>(),
  normalizerVersion:  text('normalizer_version'),
  createdAt:          integer('created_at').notNull(),
  updatedAt:          integer('updated_at').notNull(),
}, (table) => [
  index('staged_transactions_import_run_idx').on(table.importRunId),
  index('staged_transactions_raw_item_idx').on(table.rawItemId),
  index('staged_transactions_status_idx').on(table.status),
  index('staged_transactions_account_idx').on(table.accountId),
])

export const transactionSplits = sqliteTable('transaction_splits', {
  id:                  text('id').primaryKey(),
  parentTransactionId: text('parent_transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  splitGroupId:        text('split_group_id').notNull(),
  amount:              text('amount').notNull(),
  currency:            text('currency').notNull().default('USD'),
  ledgerAccount:       text('ledger_account').notNull(),
  memo:                text('memo'),
  notes:               text('notes'),
  sortOrder:           integer('sort_order').notNull(),
  createdFrom:         text('created_from').notNull().default('manual_split'),
  createdAt:           integer('created_at').notNull(),
  updatedAt:           integer('updated_at').notNull(),
}, (table) => [
  index('transaction_splits_parent_idx').on(table.parentTransactionId),
  index('transaction_splits_group_idx').on(table.splitGroupId),
  uniqueIndex('transaction_splits_parent_sort_idx').on(table.parentTransactionId, table.sortOrder),
])

export const importProfileMappings = sqliteTable('import_profile_mappings', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  importProfileId: text('import_profile_id').notNull().references(() => importProfiles.id),
  targetField:     text('target_field').notNull(),
  sourceField:     text('source_field'),
  transform:       text('transform'),
  defaultValue:    text('default_value'),
  required:        integer('required', { mode: 'boolean' }).notNull().default(false),
  sortOrder:       integer('sort_order').notNull().default(0),
  createdAt:       integer('created_at').notNull(),
  updatedAt:       integer('updated_at').notNull(),
}, (table) => [
  index('import_profile_mappings_profile_idx').on(table.importProfileId),
  uniqueIndex('import_profile_mappings_target_idx').on(table.importProfileId, table.targetField),
])

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
type TransactionSelect = typeof transactions.$inferSelect
type TransactionProvenanceKeys =
  | 'sourceConnectionId'
  | 'sourceAccountId'
  | 'externalId'
  | 'sourceItemKey'
  | 'importRunId'
  | 'rawItemId'
  | 'normalizerVersion'
  | 'updatedAt'
export type Transaction = Omit<TransactionSelect, TransactionProvenanceKeys> &
  Partial<Pick<TransactionSelect, TransactionProvenanceKeys>>
export type TransferMatch = typeof transferMatches.$inferSelect
export type Category = typeof categories.$inferSelect
export type Rule = typeof rules.$inferSelect
export type SyncLog = typeof syncLog.$inferSelect
export type NetWorthSnapshot = typeof netWorthSnapshots.$inferSelect
export type BalanceAssertion = typeof balanceAssertions.$inferSelect
export type Source = typeof sources.$inferSelect
export type SourceConnection = typeof sourceConnections.$inferSelect
export type SourceAccount = typeof sourceAccounts.$inferSelect
export type ImportRun = typeof importRuns.$inferSelect
export type RawImportItem = typeof rawImportItems.$inferSelect
export type StagedTransaction = typeof stagedTransactions.$inferSelect
export type TransactionSplit = typeof transactionSplits.$inferSelect
export type ImportProfile = typeof importProfiles.$inferSelect
export type ImportProfileMapping = typeof importProfileMappings.$inferSelect
