import { createHash, randomUUID } from 'crypto'
import { sqlite } from '../db'
import { stableStringify } from './identity'
import type {
  ImportRunStatus,
  IngestionJsonObject,
  RawImportItemStatus,
  SourceConnectionStatus,
  SourceKind,
  SourceStatus,
  StagedTransactionStatus,
} from './types'

type SqliteDatabase = import('better-sqlite3').Database

export interface SourceRecord {
  id: string
  kind: SourceKind
  name: string
  status: SourceStatus
  metadata: IngestionJsonObject | null
  createdAt: number
  updatedAt: number
}

export interface SourceConnectionRecord {
  id: string
  sourceId: string
  name: string
  status: SourceConnectionStatus
  config: IngestionJsonObject | null
  createdAt: number
  updatedAt: number
}

export interface SourceAccountRecord {
  id: string
  sourceConnectionId: string
  fintrackAccountId: string | null
  externalAccountId: string
  name: string | null
  currency: string | null
  status: SourceStatus
  rawPayload: IngestionJsonObject | null
  createdAt: number
  updatedAt: number
}

export interface ImportRunRecord {
  id: string
  sourceConnectionId: string | null
  importProfileId: string | null
  status: ImportRunStatus
  startedAt: number | null
  finishedAt: number | null
  itemCount: number
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface RawImportItemRecord {
  id: string
  importRunId: string
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string
  rawPayload: IngestionJsonObject
  contentHash: string | null
  status: RawImportItemStatus
  receivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface StagedTransactionRecord {
  id: string
  importRunId: string | null
  rawItemId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  accountId: string | null
  transactionId: string | null
  externalId: string | null
  sourceItemKey: string | null
  posted: number | null
  transactedAt: number | null
  amount: string | null
  currency: string | null
  description: string | null
  pending: boolean
  status: StagedTransactionStatus
  category: string | null
  notes: string | null
  tags: string[] | null
  normalizedPayload: IngestionJsonObject | null
  validationErrors: string[] | null
  normalizerVersion: string | null
  createdAt: number
  updatedAt: number
}

export interface EnsureSourceInput {
  id?: string
  kind: SourceKind
  name: string
  status?: SourceStatus
  metadata?: IngestionJsonObject | null
}

export interface EnsureSourceConnectionInput {
  id?: string
  sourceId: string
  name: string
  status?: SourceConnectionStatus
  config?: IngestionJsonObject | null
}

export interface EnsureSourceAccountInput {
  id?: string
  sourceConnectionId: string
  fintrackAccountId?: string | null
  externalAccountId: string
  name?: string | null
  currency?: string | null
  status?: SourceStatus
  rawPayload?: IngestionJsonObject | null
}

export interface CreateImportRunInput {
  id?: string
  sourceConnectionId?: string | null
  importProfileId?: string | null
  status?: ImportRunStatus
  startedAt?: number | null
}

export interface FinishImportRunInput {
  id: string
  status?: ImportRunStatus
  itemCount?: number
  error?: string | null
  finishedAt?: number
}

export interface InsertRawImportItemInput {
  id?: string
  importRunId: string
  sourceAccountId?: string | null
  externalId?: string | null
  sourceItemKey: string
  rawPayload: IngestionJsonObject
  contentHash?: string | null
  status?: RawImportItemStatus
  receivedAt?: number | null
}

export type InsertRawImportItemResult =
  | { status: 'inserted'; item: RawImportItemRecord }
  | { status: 'duplicate'; item: RawImportItemRecord }

export interface InsertStagedTransactionInput {
  id?: string
  importRunId?: string | null
  rawItemId?: string | null
  sourceConnectionId?: string | null
  sourceAccountId?: string | null
  accountId?: string | null
  transactionId?: string | null
  externalId?: string | null
  sourceItemKey?: string | null
  posted?: number | null
  transactedAt?: number | null
  amount?: string | null
  currency?: string | null
  description?: string | null
  pending?: boolean
  status?: StagedTransactionStatus
  category?: string | null
  notes?: string | null
  tags?: string[] | null
  normalizedPayload?: IngestionJsonObject | null
  validationErrors?: string[] | null
  normalizerVersion?: string | null
}

interface SourceRow {
  id: string
  kind: SourceKind
  name: string
  status: SourceStatus
  metadata: string | null
  createdAt: number
  updatedAt: number
}

interface SourceConnectionRow {
  id: string
  sourceId: string
  name: string
  status: SourceConnectionStatus
  config: string | null
  createdAt: number
  updatedAt: number
}

interface SourceAccountRow {
  id: string
  sourceConnectionId: string
  fintrackAccountId: string | null
  externalAccountId: string
  name: string | null
  currency: string | null
  status: SourceStatus
  rawPayload: string | null
  createdAt: number
  updatedAt: number
}

interface ImportRunRow {
  id: string
  sourceConnectionId: string | null
  importProfileId: string | null
  status: ImportRunStatus
  startedAt: number | null
  finishedAt: number | null
  itemCount: number
  error: string | null
  createdAt: number
  updatedAt: number
}

interface RawImportItemRow {
  id: string
  importRunId: string
  sourceAccountId: string | null
  externalId: string | null
  sourceItemKey: string
  rawPayload: string
  contentHash: string | null
  status: RawImportItemStatus
  receivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface StagedTransactionRow {
  id: string
  importRunId: string | null
  rawItemId: string | null
  sourceConnectionId: string | null
  sourceAccountId: string | null
  accountId: string | null
  transactionId: string | null
  externalId: string | null
  sourceItemKey: string | null
  posted: number | null
  transactedAt: number | null
  amount: string | null
  currency: string | null
  description: string | null
  pending: number
  status: StagedTransactionStatus
  category: string | null
  notes: string | null
  tags: string | null
  normalizedPayload: string | null
  validationErrors: string | null
  normalizerVersion: string | null
  createdAt: number
  updatedAt: number
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'item'
}

function hashText(value: string, length = 12): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function defaultSourceId(kind: SourceKind, name: string): string {
  if (kind === 'csv' || kind === 'simplefin') return kind
  return `source:${kind}:${slug(name)}:${hashText(`${kind}\0${name}`)}`
}

function defaultConnectionId(sourceId: string, name: string): string {
  return `connection:${sourceId}:${slug(name)}:${hashText(`${sourceId}\0${name}`)}`
}

function defaultSourceAccountId(sourceConnectionId: string, externalAccountId: string): string {
  return `source-account:${sourceConnectionId}:${slug(externalAccountId)}:${hashText(`${sourceConnectionId}\0${externalAccountId}`)}`
}

function stringifyJson(value: IngestionJsonObject | string[] | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

function contentHash(rawPayload: IngestionJsonObject): string {
  return createHash('sha256')
    .update(stableStringify(rawPayload))
    .digest('hex')
}

function parseJson<T>(value: string | null): T | null {
  if (value === null) return null
  return JSON.parse(value) as T
}

function selectSource(database: SqliteDatabase, id: string): SourceRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      kind,
      name,
      status,
      metadata,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM sources
    WHERE id = ?
  `).get(id) as SourceRow | undefined

  if (!row) return null
  return {
    ...row,
    metadata: parseJson<IngestionJsonObject>(row.metadata),
  }
}

function selectSourceConnection(database: SqliteDatabase, id: string): SourceConnectionRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      source_id AS sourceId,
      name,
      status,
      config,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM source_connections
    WHERE id = ?
  `).get(id) as SourceConnectionRow | undefined

  if (!row) return null
  return {
    ...row,
    config: parseJson<IngestionJsonObject>(row.config),
  }
}

function selectImportRun(database: SqliteDatabase, id: string): ImportRunRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      source_connection_id AS sourceConnectionId,
      import_profile_id AS importProfileId,
      status,
      started_at AS startedAt,
      finished_at AS finishedAt,
      item_count AS itemCount,
      error,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM import_runs
    WHERE id = ?
  `).get(id) as ImportRunRecord | undefined

  return row ?? null
}

function selectSourceAccount(database: SqliteDatabase, id: string): SourceAccountRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      source_connection_id AS sourceConnectionId,
      fintrack_account_id AS fintrackAccountId,
      external_account_id AS externalAccountId,
      name,
      currency,
      status,
      raw_payload AS rawPayload,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM source_accounts
    WHERE id = ?
  `).get(id) as SourceAccountRow | undefined

  if (!row) return null
  return {
    ...row,
    rawPayload: parseJson<IngestionJsonObject>(row.rawPayload),
  }
}

function selectRawImportItemById(database: SqliteDatabase, id: string): RawImportItemRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      import_run_id AS importRunId,
      source_account_id AS sourceAccountId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      raw_payload AS rawPayload,
      content_hash AS contentHash,
      status,
      received_at AS receivedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM raw_import_items
    WHERE id = ?
  `).get(id) as RawImportItemRow | undefined

  return row ? mapRawImportItem(row) : null
}

function selectRawImportItemByRunKey(
  database: SqliteDatabase,
  importRunId: string,
  sourceItemKey: string,
): RawImportItemRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      import_run_id AS importRunId,
      source_account_id AS sourceAccountId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      raw_payload AS rawPayload,
      content_hash AS contentHash,
      status,
      received_at AS receivedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM raw_import_items
    WHERE import_run_id = ?
      AND source_item_key = ?
  `).get(importRunId, sourceItemKey) as RawImportItemRow | undefined

  return row ? mapRawImportItem(row) : null
}

function selectStagedTransaction(database: SqliteDatabase, id: string): StagedTransactionRecord | null {
  const row = database.prepare(`
    SELECT
      id,
      import_run_id AS importRunId,
      raw_item_id AS rawItemId,
      source_connection_id AS sourceConnectionId,
      source_account_id AS sourceAccountId,
      account_id AS accountId,
      transaction_id AS transactionId,
      external_id AS externalId,
      source_item_key AS sourceItemKey,
      posted,
      transacted_at AS transactedAt,
      amount,
      currency,
      description,
      pending,
      status,
      category,
      notes,
      tags,
      normalized_payload AS normalizedPayload,
      validation_errors AS validationErrors,
      normalizer_version AS normalizerVersion,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM staged_transactions
    WHERE id = ?
  `).get(id) as StagedTransactionRow | undefined

  if (!row) return null
  return {
    ...row,
    pending: Boolean(row.pending),
    tags: parseJson<string[]>(row.tags),
    normalizedPayload: parseJson<IngestionJsonObject>(row.normalizedPayload),
    validationErrors: parseJson<string[]>(row.validationErrors),
  }
}

function mapRawImportItem(row: RawImportItemRow): RawImportItemRecord {
  return {
    ...row,
    rawPayload: parseJson<IngestionJsonObject>(row.rawPayload) ?? {},
  }
}

function requireRow<T>(row: T | null, label: string, id: string): T {
  if (!row) throw new Error(`${label} not found: ${id}`)
  return row
}

export function ensureSource(
  input: EnsureSourceInput,
  database: SqliteDatabase = sqlite,
): SourceRecord {
  const id = input.id ?? defaultSourceId(input.kind, input.name)
  const timestamp = nowSeconds()

  return database.transaction(() => {
    database.prepare(`
      INSERT OR IGNORE INTO sources
        (id, kind, name, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.kind,
      input.name,
      input.status ?? 'active',
      stringifyJson(input.metadata),
      timestamp,
      timestamp,
    )

    return requireRow(selectSource(database, id), 'Source', id)
  })()
}

export function ensureSourceConnection(
  input: EnsureSourceConnectionInput,
  database: SqliteDatabase = sqlite,
): SourceConnectionRecord {
  const id = input.id ?? defaultConnectionId(input.sourceId, input.name)
  const timestamp = nowSeconds()

  return database.transaction(() => {
    database.prepare(`
      INSERT OR IGNORE INTO source_connections
        (id, source_id, name, status, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceId,
      input.name,
      input.status ?? 'active',
      stringifyJson(input.config),
      timestamp,
      timestamp,
    )

    return requireRow(selectSourceConnection(database, id), 'Source connection', id)
  })()
}

export function ensureSourceAccount(
  input: EnsureSourceAccountInput,
  database: SqliteDatabase = sqlite,
): SourceAccountRecord {
  const id = input.id ?? defaultSourceAccountId(input.sourceConnectionId, input.externalAccountId)
  const timestamp = nowSeconds()

  return database.transaction(() => {
    database.prepare(`
      INSERT OR IGNORE INTO source_accounts
        (id, source_connection_id, fintrack_account_id, external_account_id,
         name, currency, status, raw_payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceConnectionId,
      input.fintrackAccountId ?? null,
      input.externalAccountId,
      input.name ?? null,
      input.currency ?? null,
      input.status ?? 'active',
      stringifyJson(input.rawPayload),
      timestamp,
      timestamp,
    )

    return requireRow(selectSourceAccount(database, id), 'Source account', id)
  })()
}

export function createImportRun(
  input: CreateImportRunInput = {},
  database: SqliteDatabase = sqlite,
): ImportRunRecord {
  const id = input.id ?? randomUUID()
  const timestamp = nowSeconds()
  const startedAt = input.startedAt === undefined ? timestamp : input.startedAt

  return database.transaction(() => {
    database.prepare(`
      INSERT INTO import_runs
        (id, source_connection_id, import_profile_id, status, started_at, item_count, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
    `).run(
      id,
      input.sourceConnectionId ?? null,
      input.importProfileId ?? null,
      input.status ?? 'running',
      startedAt,
      timestamp,
      timestamp,
    )

    return requireRow(selectImportRun(database, id), 'Import run', id)
  })()
}

export function finishImportRun(
  input: FinishImportRunInput,
  database: SqliteDatabase = sqlite,
): ImportRunRecord {
  const timestamp = nowSeconds()
  const finishedAt = input.finishedAt ?? timestamp

  return database.transaction(() => {
    database.prepare(`
      UPDATE import_runs
      SET
        status = ?,
        finished_at = ?,
        item_count = COALESCE(?, (
          SELECT COUNT(*)
          FROM raw_import_items
          WHERE import_run_id = ?
        )),
        error = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.status ?? 'completed',
      finishedAt,
      input.itemCount ?? null,
      input.id,
      input.error ?? null,
      timestamp,
      input.id,
    )

    return requireRow(selectImportRun(database, input.id), 'Import run', input.id)
  })()
}

export function insertRawImportItem(
  input: InsertRawImportItemInput,
  database: SqliteDatabase = sqlite,
): InsertRawImportItemResult {
  const id = input.id ?? randomUUID()
  const timestamp = nowSeconds()
  const rawPayload = JSON.stringify(input.rawPayload)
  const hash = input.contentHash ?? contentHash(input.rawPayload)

  return database.transaction(() => {
    const result = database.prepare(`
      INSERT INTO raw_import_items
        (id, import_run_id, source_account_id, external_id, source_item_key,
         raw_payload, content_hash, status, received_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(import_run_id, source_item_key) DO NOTHING
    `).run(
      id,
      input.importRunId,
      input.sourceAccountId ?? null,
      input.externalId ?? null,
      input.sourceItemKey,
      rawPayload,
      hash,
      input.status ?? 'pending',
      input.receivedAt === undefined ? timestamp : input.receivedAt,
      timestamp,
      timestamp,
    )

    if (result.changes === 0) {
      const item = requireRow(
        selectRawImportItemByRunKey(database, input.importRunId, input.sourceItemKey),
        'Raw import item',
        `${input.importRunId}:${input.sourceItemKey}`,
      )
      return { status: 'duplicate' as const, item }
    }

    return {
      status: 'inserted' as const,
      item: requireRow(selectRawImportItemById(database, id), 'Raw import item', id),
    }
  })()
}

export function insertStagedTransaction(
  input: InsertStagedTransactionInput,
  database: SqliteDatabase = sqlite,
): StagedTransactionRecord {
  const id = input.id ?? randomUUID()
  const timestamp = nowSeconds()

  return database.transaction(() => {
    database.prepare(`
      INSERT INTO staged_transactions
        (id, import_run_id, raw_item_id, source_connection_id, source_account_id,
         account_id, transaction_id, external_id, source_item_key, posted,
         transacted_at, amount, currency, description, pending, status, category,
         notes, tags, normalized_payload, validation_errors, normalizer_version,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.importRunId ?? null,
      input.rawItemId ?? null,
      input.sourceConnectionId ?? null,
      input.sourceAccountId ?? null,
      input.accountId ?? null,
      input.transactionId ?? null,
      input.externalId ?? null,
      input.sourceItemKey ?? null,
      input.posted ?? null,
      input.transactedAt ?? null,
      input.amount ?? null,
      input.currency ?? null,
      input.description ?? null,
      input.pending ? 1 : 0,
      input.status ?? 'staged',
      input.category ?? null,
      input.notes ?? null,
      stringifyJson(input.tags),
      stringifyJson(input.normalizedPayload),
      stringifyJson(input.validationErrors),
      input.normalizerVersion ?? null,
      timestamp,
      timestamp,
    )

    return requireRow(selectStagedTransaction(database, id), 'Staged transaction', id)
  })()
}
