import { db, getSetting, sqlite } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
import { isNull, eq, and } from 'drizzle-orm'
import { classifyByAI } from '@/lib/classify/ai'
import { loadCategories } from '@/lib/categories'

const AI_BATCH_DELAY_MS = 6500
const DESCRIPTION_GROUP_TOKEN_LIMIT = 6

function send(controller: ReadableStreamDefaultController, data: object) {
  controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
}

function normalizeDescription(description: string): string {
  const normalized = description
    .toUpperCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\bX{2,}\d*\b/g, ' ')
    .replace(/[*#:_.,;'"()[\]{}]+/g, ' ')
    .replace(/[-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const tokens = normalized
    .split(' ')
    .filter(token => token && !/^\d+$/.test(token) && !/^X+$/.test(token))
    .slice(0, DESCRIPTION_GROUP_TOKEN_LIMIT)

  return tokens.join(' ') || normalized || description.trim().toUpperCase()
}

type BatchTransaction = typeof transactions.$inferSelect

interface DescriptionGroup {
  key: string
  label: string
  transactions: BatchTransaction[]
}

function groupByDescription(rows: BatchTransaction[]): DescriptionGroup[] {
  const groups = new Map<string, DescriptionGroup>()

  for (const txn of rows) {
    const key = normalizeDescription(txn.description)
    const existing = groups.get(key)
    if (existing) {
      existing.transactions.push(txn)
    } else {
      groups.set(key, {
        key,
        label: key,
        transactions: [txn],
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.transactions.length - a.transactions.length)
}

export async function POST(): Promise<Response> {
  const geminiKey = getSetting('gemini_api_key') ?? process.env.GEMINI_API_KEY
  const claudeKey = getSetting('claude_api_key') ?? process.env.CLAUDE_API_KEY

  const stream = new ReadableStream({
    async start(controller) {
      if (!geminiKey && !claudeKey) {
        send(controller, { type: 'error', error: 'Gemini or Claude API key is not configured' })
        controller.close()
        return
      }

      const cats = loadCategories()
      if (cats.length === 0) {
        send(controller, { type: 'error', error: 'The category list is empty. Add categories first' })
        controller.close()
        return
      }

      const unclassified = db
        .select()
        .from(transactions)
        .where(and(isNull(transactions.suggestedCat), eq(transactions.status, 'posted'), isNull(transactions.category)))
        .all()

      if (unclassified.length === 0) {
        const remaining = db.select().from(transactions)
          .where(and(isNull(transactions.category), eq(transactions.status, 'posted')))
          .all().length
        send(controller, { type: 'done', suggested: 0, remaining, info: 'All uncategorized transactions already have AI suggestions' })
        controller.close()
        return
      }

      const groups = groupByDescription(unclassified)
      const updateSuggestion = sqlite.prepare(`
        UPDATE transactions
        SET suggested_cat = ?
        WHERE id = ? AND category IS NULL AND suggested_cat IS NULL
      `)

      send(controller, {
        type: 'start',
        total: groups.length,
        transactionTotal: unclassified.length,
        grouped: true,
      })

      let suggested = 0
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i]
        try {
          const cat = await classifyByAI(group.label, cats)
          if (cat) {
            for (const txn of group.transactions) {
              suggested += updateSuggestion.run(cat, txn.id).changes
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          send(controller, { type: 'error', error: `AI request failed: ${msg}`, suggested })
          controller.close()
          return
        }

        send(controller, {
          type: 'progress',
          current: i + 1,
          total: groups.length,
          suggested,
          transactionTotal: unclassified.length,
          grouped: true,
          groupSize: group.transactions.length,
        })

        // Stay below Gemini free tier's 10 RPM limit.
        if (i < groups.length - 1) await new Promise(r => setTimeout(r, AI_BATCH_DELAY_MS))
      }

      const remaining = db.select().from(transactions)
        .where(and(isNull(transactions.category), eq(transactions.status, 'posted')))
        .all().length

      send(controller, { type: 'done', suggested, remaining })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
