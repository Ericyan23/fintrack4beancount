import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { db, getSetting, setSetting } from '@/lib/db'
import { loadCategories } from '@/lib/categories'
import { transactions } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'

const PROMPT = (description: string, categories: string[]) =>
  `Classify this financial transaction into exactly one of the categories listed.
Transaction: "${description}"
Categories: ${categories.join(', ')}
Reply with only the category name, nothing else.`

const GEMINI_DAILY_QUOTA_EXHAUSTED_ON = 'gemini_daily_quota_exhausted_on'

function matchCategory(text: string, categories: string[]): string | null {
  if (categories.includes(text)) return text
  const lower = text.toLowerCase()
  return categories.find(c => c.toLowerCase().includes(lower)) ?? null
}

function todayKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function geminiDailyQuotaExhaustedToday(): boolean {
  return getSetting(GEMINI_DAILY_QUOTA_EXHAUSTED_ON) === todayKey()
}

function markGeminiDailyQuotaExhausted(): void {
  setSetting(GEMINI_DAILY_QUOTA_EXHAUSTED_ON, todayKey())
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isGeminiDailyQuotaError(err: unknown): boolean {
  const message = errorMessage(err)
  return message.includes('GenerateRequestsPerDayPerProjectPerModel')
}

function isGeminiRateLimitError(err: unknown): boolean {
  const message = errorMessage(err)
  return message.includes('[429 Too Many Requests]') || message.includes('Too Many Requests')
}

function friendlyGeminiQuotaError(): Error {
  return new Error('今日 Gemini 免费额度已用完，请稍后重试或配置 Claude。')
}

function friendlyGeminiRateLimitError(): Error {
  return new Error('Gemini 请求过于频繁，请稍后重试。')
}

async function classifyWithGemini(
  description: string,
  categories: string[],
  apiKey: string,
): Promise<string | null> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })
  const result = await model.generateContent(PROMPT(description, categories))
  const text = result.response.text().trim()
  return matchCategory(text, categories)
}

async function classifyWithClaude(
  description: string,
  categories: string[],
  apiKey: string,
): Promise<string | null> {
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 64,
    messages: [{ role: 'user', content: PROMPT(description, categories) }],
  })
  const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : null
  if (!text) return null
  return matchCategory(text, categories)
}

export async function classifyByAI(
  description: string,
  categories?: string[],
): Promise<string | null> {
  const cats = categories ?? loadCategories()
  const geminiKey = getSetting('gemini_api_key') ?? process.env.GEMINI_API_KEY
  const claudeKey = getSetting('claude_api_key') ?? process.env.CLAUDE_API_KEY

  if (geminiKey && !geminiDailyQuotaExhaustedToday()) {
    try {
      return await classifyWithGemini(description, cats, geminiKey)
    } catch (err) {
      if (isGeminiDailyQuotaError(err)) {
        markGeminiDailyQuotaExhausted()
        if (!claudeKey) throw friendlyGeminiQuotaError()
      } else if (isGeminiRateLimitError(err) && !claudeKey) {
        throw friendlyGeminiRateLimitError()
      }
      // If Claude is available, fall back silently; otherwise rethrow so callers see the real error
      if (!claudeKey) throw err
      console.error('[ai classify] Gemini failed, falling back to Claude:', err)
    }
  } else if (geminiKey && !claudeKey) {
    throw friendlyGeminiQuotaError()
  }
  if (claudeKey) {
    return await classifyWithClaude(description, cats, claudeKey)
  }
  return null
}

export async function suggestCategoriesForUncategorized(): Promise<void> {
  const hasKey =
    getSetting('gemini_api_key') ?? process.env.GEMINI_API_KEY ??
    getSetting('claude_api_key') ?? process.env.CLAUDE_API_KEY
  if (!hasKey) return

  const unclassified = db
    .select()
    .from(transactions)
    .where(isNull(transactions.category))
    .limit(20)
    .all()

  const noSuggestion = unclassified.filter(t => !t.suggestedCat)
  if (noSuggestion.length === 0) return

  for (const txn of noSuggestion) {
    const suggested = await classifyByAI(txn.description)
    if (suggested) {
      db.update(transactions)
        .set({ suggestedCat: suggested })
        .where(eq(transactions.id, txn.id))
        .run()
    }
  }
}

export async function suggestCategoriesForBatch(ids: string[]): Promise<void> {
  const hasKey =
    getSetting('gemini_api_key') ?? process.env.GEMINI_API_KEY ??
    getSetting('claude_api_key') ?? process.env.CLAUDE_API_KEY
  if (!hasKey) return

  for (const id of ids) {
    const [txn] = db.select().from(transactions).where(eq(transactions.id, id)).all()
    if (!txn || txn.category || txn.suggestedCat) continue

    const suggested = await classifyByAI(txn.description)
    if (suggested) {
      db.update(transactions)
        .set({ suggestedCat: suggested })
        .where(eq(transactions.id, id))
        .run()
    }
  }
}
