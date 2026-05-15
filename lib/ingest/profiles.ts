import { randomUUID } from 'crypto'
import { sqlite } from '@/lib/db'
import { ensureSource } from './store'
import { getCsvParserProfile, type CsvImportField, type CsvImportMapping } from './csv'
import type { IngestionJsonObject, ImportProfileKind } from './types'

const CSV_SOURCE_ID = 'csv'
const CSV_SOURCE_NAME = 'CSV Import'
const CSV_PROFILE_KIND: ImportProfileKind = 'csv'
const CSV_FIELDS: CsvImportField[] = [
  'date',
  'amount',
  'description',
  'account',
  'category',
  'notes',
  'tags',
  'status',
  'externalId',
]
const REQUIRED_FIELDS = new Set<CsvImportField>(['date', 'amount', 'description'])

export interface CsvImportProfileConfig {
  connectionName: string | null
  defaultAccountId: string | null
  defaultLedgerAccount: string | null
  parserProfileId: string | null
}

export interface CsvImportProfileRecord {
  id: string
  sourceId: string
  kind: ImportProfileKind
  name: string
  config: CsvImportProfileConfig
  mapping: CsvImportMapping
  createdAt: number
  updatedAt: number
}

export interface SaveCsvImportProfileInput {
  profileId?: string
  name: string
  mapping: CsvImportMapping
  connectionName?: string | null
  defaultAccountId?: string | null
  defaultLedgerAccount?: string | null
  parserProfileId?: string | null
}

export class CsvImportProfileValidationError extends Error {
  validationErrors: string[]
  status = 400

  constructor(validationErrors: string[]) {
    super(validationErrors.join(', ') || 'Invalid CSV import profile')
    this.name = 'CsvImportProfileValidationError'
    this.validationErrors = validationErrors
  }
}

export class CsvImportProfileNotFoundError extends Error {
  status = 404

  constructor(profileId: string) {
    super(`CSV import profile not found: ${profileId}`)
    this.name = 'CsvImportProfileNotFoundError'
  }
}

interface ProfileRow {
  id: string
  sourceId: string
  kind: ImportProfileKind
  name: string
  config: string | null
  createdAt: number
  updatedAt: number
}

interface MappingRow {
  targetField: CsvImportField
  sourceField: string | null
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseConfig(value: string | null): CsvImportProfileConfig {
  if (!value) {
    return {
      connectionName: null,
      defaultAccountId: null,
      defaultLedgerAccount: null,
      parserProfileId: null,
    }
  }

  try {
    const parsed = JSON.parse(value) as Partial<CsvImportProfileConfig>
    return {
      connectionName: normalizeOptionalText(parsed.connectionName ?? null),
      defaultAccountId: normalizeOptionalText(parsed.defaultAccountId ?? null),
      defaultLedgerAccount: normalizeOptionalText(parsed.defaultLedgerAccount ?? null),
      parserProfileId: normalizeOptionalText(parsed.parserProfileId ?? null),
    }
  } catch {
    return {
      connectionName: null,
      defaultAccountId: null,
      defaultLedgerAccount: null,
      parserProfileId: null,
    }
  }
}

function serializeConfig(config: CsvImportProfileConfig): string {
  const payload: IngestionJsonObject = {
    connectionName: config.connectionName,
    defaultAccountId: config.defaultAccountId,
    defaultLedgerAccount: config.defaultLedgerAccount,
    parserProfileId: config.parserProfileId,
  }
  return JSON.stringify(payload)
}

function parseMappingRows(rows: MappingRow[]): CsvImportMapping {
  const mapping: CsvImportMapping = {}
  for (const row of rows) {
    if (!CSV_FIELDS.includes(row.targetField)) continue
    if (!row.sourceField) continue
    mapping[row.targetField] = row.sourceField
  }
  return mapping
}

function selectProfileById(profileId: string): ProfileRow | null {
  const row = sqlite.prepare(`
    SELECT
      id,
      source_id AS sourceId,
      kind,
      name,
      config,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM import_profiles
    WHERE id = ?
  `).get(profileId) as ProfileRow | undefined

  return row ?? null
}

function selectProfileByName(name: string): ProfileRow | null {
  const row = sqlite.prepare(`
    SELECT
      id,
      source_id AS sourceId,
      kind,
      name,
      config,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM import_profiles
    WHERE source_id = ?
      AND kind = ?
      AND name = ?
  `).get(CSV_SOURCE_ID, CSV_PROFILE_KIND, name) as ProfileRow | undefined

  return row ?? null
}

function selectMappings(profileId: string): MappingRow[] {
  return sqlite.prepare(`
    SELECT
      target_field AS targetField,
      source_field AS sourceField
    FROM import_profile_mappings
    WHERE import_profile_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(profileId) as MappingRow[]
}

function mapProfile(row: ProfileRow): CsvImportProfileRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    kind: row.kind,
    name: row.name,
    config: parseConfig(row.config),
    mapping: parseMappingRows(selectMappings(row.id)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function validateCsvProfileInput(input: SaveCsvImportProfileInput): string[] {
  const errors: string[] = []
  if (!normalizeOptionalText(input.name)) errors.push('Profile name is required')
  const parserProfileId = normalizeOptionalText(input.parserProfileId)
  if (parserProfileId && !getCsvParserProfile(parserProfileId)) {
    errors.push(`Unknown CSV parser profile: ${parserProfileId}`)
  }
  for (const [field, value] of Object.entries(input.mapping)) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      errors.push(`${field} mapping must be a string`)
    }
  }
  return errors
}

export function listCsvImportProfiles(): CsvImportProfileRecord[] {
  const rows = sqlite.prepare(`
    SELECT
      id,
      source_id AS sourceId,
      kind,
      name,
      config,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM import_profiles
    WHERE source_id = ?
      AND kind = ?
    ORDER BY updated_at DESC, created_at DESC, name ASC
  `).all(CSV_SOURCE_ID, CSV_PROFILE_KIND) as ProfileRow[]

  return rows.map(mapProfile)
}

export function getCsvImportProfile(profileId: string): CsvImportProfileRecord | null {
  const row = selectProfileById(profileId)
  return row ? mapProfile(row) : null
}

export function saveCsvImportProfile(input: SaveCsvImportProfileInput): CsvImportProfileRecord {
  const validationErrors = validateCsvProfileInput(input)
  if (validationErrors.length > 0) {
    throw new CsvImportProfileValidationError(validationErrors)
  }

  ensureSource({
    id: CSV_SOURCE_ID,
    kind: 'csv',
    name: CSV_SOURCE_NAME,
  })

  const name = normalizeOptionalText(input.name)!
  const config: CsvImportProfileConfig = {
    connectionName: normalizeOptionalText(input.connectionName),
    defaultAccountId: normalizeOptionalText(input.defaultAccountId),
    defaultLedgerAccount: normalizeOptionalText(input.defaultLedgerAccount),
    parserProfileId: normalizeOptionalText(input.parserProfileId),
  }
  const mappingEntries = CSV_FIELDS.flatMap((field, index) => {
    const value = input.mapping[field]
    if (typeof value !== 'string' || !value.trim()) return []
    return [{
      targetField: field,
      sourceField: value.trim(),
      required: REQUIRED_FIELDS.has(field),
      sortOrder: index,
    }]
  })

  const timestamp = Math.floor(Date.now() / 1000)
  return sqlite.transaction(() => {
    const existing = input.profileId ? selectProfileById(input.profileId) : selectProfileByName(name)
    const profileId = existing?.id ?? input.profileId ?? randomUUID()

    if (input.profileId && !existing) {
      throw new CsvImportProfileNotFoundError(input.profileId)
    }

    if (existing) {
      sqlite.prepare(`
        UPDATE import_profiles
        SET name = ?, config = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        serializeConfig(config),
        timestamp,
        profileId,
      )
      sqlite.prepare(`
        DELETE FROM import_profile_mappings
        WHERE import_profile_id = ?
      `).run(profileId)
    } else {
      sqlite.prepare(`
        INSERT INTO import_profiles (
          id,
          source_id,
          kind,
          name,
          config,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        profileId,
        CSV_SOURCE_ID,
        CSV_PROFILE_KIND,
        name,
        serializeConfig(config),
        timestamp,
        timestamp,
      )
    }

    const insertMapping = sqlite.prepare(`
      INSERT INTO import_profile_mappings (
        import_profile_id,
        target_field,
        source_field,
        transform,
        default_value,
        required,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `)
    for (const row of mappingEntries) {
      insertMapping.run(
        profileId,
        row.targetField,
        row.sourceField,
        row.required ? 1 : 0,
        row.sortOrder,
        timestamp,
        timestamp,
      )
    }

    const saved = selectProfileById(profileId)
    if (!saved) {
      throw new Error(`Failed to load CSV import profile: ${profileId}`)
    }
    return mapProfile(saved)
  })()
}
