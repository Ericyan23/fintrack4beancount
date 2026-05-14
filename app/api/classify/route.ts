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

function countRemainingUnclassified(): number {
  const row = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM transactions
    WHERE ledger_account IS NULL AND status = 'posted'
  `).get() as { total: number }
  return row.total
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
        .where(and(
          isNull(transactions.suggestedLedgerAccount),
          eq(transactions.status, 'posted'),
          isNull(transactions.ledgerAccount),
        ))
        .all()

      if (unclassified.length === 0) {
        const remaining = countRemainingUnclassified()
        send(controller, { type: 'done', suggested: 0, remaining, info: 'All uncategorized transactions already have AI suggestions' })
        controller.close()
        return
      }

      const groups = groupByDescription(unclassified)
      const updateSuggestion = sqlite.prepare(`
        UPDATE transactions
        SET suggested_ledger_account = ?,
            suggested_cat = ?,
            classifier = 'ai',
            suggested_at = ?
        WHERE id = ?
          AND ledger_account IS NULL
          AND suggested_ledger_account IS NULL
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
            const timestamp = Math.floor(Date.now() / 1000)
            for (const txn of group.transactions) {
              suggested += updateSuggestion.run(cat, cat, timestamp, txn.id).changes
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

      const remaining = countRemainingUnclassified()

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
