import { NextRequest, NextResponse } from 'next/server'
import { getSetting, setSetting } from '@/lib/db'

const ALLOWED_KEYS = ['simplefin_access_url', 'sync_hour', 'gemini_api_key', 'claude_api_key'] as const
type AllowedKey = (typeof ALLOWED_KEYS)[number]

function isAllowedKey(key: string): key is AllowedKey {
  return ALLOWED_KEYS.includes(key as AllowedKey)
}

function sanitizeSyncHour(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const hour = Number(trimmed)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  return String(hour)
}

export async function GET(): Promise<NextResponse> {
  const result: Record<string, string | null> = {}
  for (const key of ALLOWED_KEYS) {
    const value = getSetting(key)
    // Mask sensitive values
    if (key === 'simplefin_access_url' && value) {
      try {
        const u = new URL(value)
        result[key] = `${u.protocol}//${u.host}${u.pathname}`
      } catch {
        result[key] = '(configured)'
      }
    } else if ((key === 'claude_api_key' || key === 'gemini_api_key') && value) {
      result[key] = '(configured)'
    } else {
      result[key] = value
    }
  }
  return NextResponse.json(result)
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as Record<string, unknown>

  for (const [key, value] of Object.entries(body)) {
    if (!isAllowedKey(key)) continue
    if (key === 'sync_hour') {
      const sanitized = sanitizeSyncHour(value)
      if (sanitized === null) {
        return NextResponse.json({ error: 'Sync hour must be an integer from 0 to 23' }, { status: 400 })
      }
      setSetting(key, sanitized)
      continue
    }

    if (typeof value === 'string' && value.trim()) {
      let sanitized = value.trim().replace(/[%\s]+$/, '')
      // API keys must be ASCII-only — strip any non-ASCII chars from copy-paste accidents
      if (key === 'gemini_api_key' || key === 'claude_api_key') {
        sanitized = sanitized.replace(/[^\x20-\x7E]/g, '')
      }
      if (sanitized) setSetting(key, sanitized)
    }
  }

  return NextResponse.json({ success: true })
}
