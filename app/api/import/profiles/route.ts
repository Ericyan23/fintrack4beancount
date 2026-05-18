import { NextRequest, NextResponse } from 'next/server'
import {
  CsvImportProfileNotFoundError,
  CsvImportProfileValidationError,
  listCsvImportProfiles,
  saveCsvImportProfile,
} from '@/lib/ingest/profiles'
import type { CsvImportMapping } from '@/lib/ingest/csv'

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const text = await req.text()
  if (!text.trim()) return {}

  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  return parsed as Record<string, unknown>
}

function parseMapping(value: unknown): CsvImportMapping | { error: string } {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'mapping must be a JSON object' }
  }

  const mapping: CsvImportMapping = {}
  for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string') {
      return { error: `${field} mapping must be a string or null` }
    }
    if (raw.trim()) {
      mapping[field as keyof CsvImportMapping] = raw.trim()
    }
  }
  return mapping
}

function parseOptionalText(body: Record<string, unknown>, field: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, field)) return undefined
  const value = body[field]
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ profiles: listCsvImportProfiles() })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown> | null
  try {
    body = await readBody(req)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body === null) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const mapping = parseMapping(body.mapping)
  if ('error' in mapping) {
    return NextResponse.json({ error: mapping.error }, { status: 400 })
  }

  const name = parseOptionalText(body, 'name')
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Profile name is required' }, { status: 400 })
  }

  try {
    const profile = saveCsvImportProfile({
      profileId: parseOptionalText(body, 'profileId') ?? undefined,
      name,
      mapping,
      connectionName: parseOptionalText(body, 'connectionName') ?? undefined,
      defaultAccountId: parseOptionalText(body, 'defaultAccountId') ?? undefined,
      defaultLedgerAccount: parseOptionalText(body, 'defaultLedgerAccount') ?? undefined,
      parserProfileId: parseOptionalText(body, 'parserProfileId') ?? undefined,
    })
    return NextResponse.json({ profile })
  } catch (error) {
    if (error instanceof CsvImportProfileValidationError || error instanceof CsvImportProfileNotFoundError) {
      return NextResponse.json({
        error: error.message,
        ...(error instanceof CsvImportProfileValidationError ? { validationErrors: error.validationErrors } : {}),
      }, { status: error.status })
    }
    throw error
  }
}
