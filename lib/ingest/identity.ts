import { createHash } from 'crypto'

export interface SourceItemKeyInput {
  sourceAccountId: string
  externalId?: string | null
  date: string
  amount: string
  description: string
  rawPayload?: unknown
  category?: string | null
  notes?: string | null
  tags?: string[] | null
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value)
}

function normalizeForStableStringify(value: unknown, seen: Set<object>): unknown {
  if (value === null) return null

  if (typeof value === 'string' || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined

  if (value instanceof Date) return value.toISOString()

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Cannot stable stringify circular payload')
    seen.add(value)
    const normalized = value.map(item => {
      const itemValue = normalizeForStableStringify(item, seen)
      return itemValue === undefined ? null : itemValue
    })
    seen.delete(value)
    return normalized
  }

  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Cannot stable stringify circular payload')
    seen.add(value)
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const itemValue = normalizeForStableStringify((value as Record<string, unknown>)[key], seen)
      if (itemValue !== undefined) normalized[key] = itemValue
    }
    seen.delete(value)
    return normalized
  }

  return String(value)
}

export function stableStringify(value: unknown): string {
  const normalized = normalizeForStableStringify(value, new Set())
  return JSON.stringify(normalized ?? null)
}

export function buildSourceItemKey(input: SourceItemKeyInput): string {
  const externalId = input.externalId
  const sourceAccountPart = encodeKeyPart(input.sourceAccountId)

  if (externalId !== undefined && externalId !== null && externalId !== '') {
    return `source-account:${sourceAccountPart}:external:${encodeKeyPart(externalId)}`
  }

  const hashInput = {
    amount: input.amount,
    date: input.date,
    description: input.description,
    sourceAccountId: input.sourceAccountId,
    ...(input.rawPayload === undefined ? {} : { rawPayload: input.rawPayload }),
  }
  const digest = createHash('sha256')
    .update(stableStringify(hashInput))
    .digest('hex')
    .slice(0, 32)

  return `source-account:${sourceAccountPart}:hash:${digest}`
}

export const createSourceItemKey = buildSourceItemKey
