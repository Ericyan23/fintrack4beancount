import { sqlite } from '../db'

type SqliteDatabase = import('better-sqlite3').Database

export interface ListImportRunSecuritiesInput {
  importRunId: string
}

export interface UpdateSecurityMappingInput {
  importRunId: string
  securityId: string
  beancountCommodity: string | null
  actor?: string | null
  reason?: string | null
}

export interface SecurityMapping {
  id: string
  sourceConnectionId: string | null
  sourceSymbol: string
  name: string | null
  instrumentType: string
  underlyingSymbol: string | null
  contractSymbol: string | null
  optionType: string | null
  expirationDate: string | null
  strikePrice: string | null
  beancountCommodity: string | null
  suggestedCommodity: string | null
  activityCount: number
  blockedCount: number
  needsReviewCount: number
  reviewedCount: number
  ignoredCount: number
}

interface ExistsRow {
  value: number
}

interface SecurityMappingDbRow extends Omit<SecurityMapping, 'suggestedCommodity'> {}

export class ImportRunNotFoundError extends Error {
  constructor() {
    super('Import run not found')
    this.name = 'ImportRunNotFoundError'
  }
}

export class SecurityNotFoundInRunError extends Error {
  constructor() {
    super('Security not found')
    this.name = 'SecurityNotFoundInRunError'
  }
}

export class InvalidBeancountCommodityError extends Error {
  readonly status = 400

  constructor() {
    super('beancountCommodity must be a Beancount commodity symbol or null')
    this.name = 'InvalidBeancountCommodityError'
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function importRunExists(database: SqliteDatabase, importRunId: string): boolean {
  const row = database.prepare(`
    SELECT 1 AS value
    FROM import_runs
    WHERE id = ?
  `).get(importRunId) as ExistsRow | undefined

  return Boolean(row)
}

function requireImportRun(database: SqliteDatabase, importRunId: string): void {
  if (!importRunExists(database, importRunId)) throw new ImportRunNotFoundError()
}

function normalizeBeancountCommodity(value: string | null): string | null {
  if (value === null) return null

  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9._-]{0,63}$/.test(normalized)) {
    throw new InvalidBeancountCommodityError()
  }

  return normalized
}

function suggestedCommodity(sourceSymbol: string | null): string | null {
  if (!sourceSymbol) return null

  const cleaned = sourceSymbol
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z]+/, '')
    .replace(/[^A-Z0-9._-]+/g, '-')
    .slice(0, 64)

  return /^[A-Z][A-Z0-9._-]*$/.test(cleaned) ? cleaned : null
}

function securityMappingQuery(filterBySecurity: boolean): string {
  const securityFilter = filterBySecurity ? 'WHERE securities.id = ?' : ''

  return `
    WITH run_security_events AS (
      SELECT security_id, status
      FROM investment_activities
      WHERE import_run_id = ?
        AND security_id IS NOT NULL
      UNION ALL
      SELECT security_id, status
      FROM investment_positions
      WHERE import_run_id = ?
        AND security_id IS NOT NULL
    ),
    run_security_counts AS (
      SELECT
        security_id AS id,
        COUNT(*) AS activityCount,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blockedCount,
        SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS needsReviewCount,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewedCount,
        SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignoredCount
      FROM run_security_events
      GROUP BY security_id
    )
    SELECT
      securities.id,
      securities.source_connection_id AS sourceConnectionId,
      securities.source_symbol AS sourceSymbol,
      securities.name,
      securities.instrument_type AS instrumentType,
      securities.underlying_symbol AS underlyingSymbol,
      securities.contract_symbol AS contractSymbol,
      securities.option_type AS optionType,
      securities.expiration_date AS expirationDate,
      securities.strike_price AS strikePrice,
      securities.beancount_commodity AS beancountCommodity,
      run_security_counts.activityCount,
      run_security_counts.blockedCount,
      run_security_counts.needsReviewCount,
      run_security_counts.reviewedCount,
      run_security_counts.ignoredCount
    FROM run_security_counts
    INNER JOIN securities
      ON securities.id = run_security_counts.id
    ${securityFilter}
    ORDER BY securities.instrument_type ASC, securities.source_symbol ASC, securities.id ASC
  `
}

function withSuggestion(row: SecurityMappingDbRow): SecurityMapping {
  return {
    ...row,
    suggestedCommodity: row.beancountCommodity ?? suggestedCommodity(row.sourceSymbol),
  }
}

function selectImportRunSecurity(
  database: SqliteDatabase,
  importRunId: string,
  securityId: string,
): SecurityMapping | null {
  const row = database.prepare(securityMappingQuery(true))
    .get(importRunId, importRunId, securityId) as SecurityMappingDbRow | undefined

  return row ? withSuggestion(row) : null
}

const insertAuditLog = sqlite.prepare(`
  INSERT INTO audit_log (
    entity_type,
    entity_id,
    action,
    actor,
    reason,
    before_values,
    after_values,
    metadata,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

function auditText(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function recordSecurityMappingAudit(input: {
  beforeSecurity: SecurityMapping
  afterSecurity: SecurityMapping
  importRunId: string
  actor?: string | null
  reason?: string | null
  timestamp: number
}): void {
  if (input.beforeSecurity.beancountCommodity === input.afterSecurity.beancountCommodity) return

  insertAuditLog.run(
    'security',
    input.beforeSecurity.id,
    'security_mapping_update',
    auditText(input.actor, 'local'),
    auditText(input.reason, 'security_mapping_update'),
    JSON.stringify({
      security: {
        beancountCommodity: input.beforeSecurity.beancountCommodity,
      },
    }),
    JSON.stringify({
      security: {
        beancountCommodity: input.afterSecurity.beancountCommodity,
      },
    }),
    JSON.stringify({
      importRunId: input.importRunId,
      sourceConnectionId: input.beforeSecurity.sourceConnectionId,
      sourceSymbol: input.beforeSecurity.sourceSymbol,
      instrumentType: input.beforeSecurity.instrumentType,
      fields: ['beancountCommodity'],
    }),
    input.timestamp,
  )
}

export function listImportRunSecurities(
  input: ListImportRunSecuritiesInput,
  database: SqliteDatabase = sqlite,
): SecurityMapping[] {
  requireImportRun(database, input.importRunId)

  const rows = database.prepare(securityMappingQuery(false))
    .all(input.importRunId, input.importRunId) as SecurityMappingDbRow[]

  return rows.map(withSuggestion)
}

export function updateSecurityMapping(
  input: UpdateSecurityMappingInput,
  database: SqliteDatabase = sqlite,
): SecurityMapping {
  requireImportRun(database, input.importRunId)

  const beforeSecurity = selectImportRunSecurity(database, input.importRunId, input.securityId)
  if (!beforeSecurity) throw new SecurityNotFoundInRunError()

  const beancountCommodity = normalizeBeancountCommodity(input.beancountCommodity)
  const timestamp = nowSeconds()

  return database.transaction(() => {
    database.prepare(`
      UPDATE securities
      SET beancount_commodity = ?,
          updated_at = ?
      WHERE id = ?
    `).run(beancountCommodity, timestamp, input.securityId)

    const afterSecurity = selectImportRunSecurity(database, input.importRunId, input.securityId)
    if (!afterSecurity) throw new SecurityNotFoundInRunError()

    recordSecurityMappingAudit({
      beforeSecurity,
      afterSecurity,
      importRunId: input.importRunId,
      actor: input.actor,
      reason: input.reason,
      timestamp,
    })

    return afterSecurity
  })()
}
