import {
  ledgerIntentFromTransaction,
  ledgerIntentFromTransfer,
  type LedgerIntent,
  type LedgerPostingIntent,
} from '@/lib/export/ledger-intents'
import type { BeancountPreflightResult } from '@/lib/export/preflight'

export interface RenderBeancountDraftOptions {
  generatedAt?: Date
}

type BeancountDraftPreflight = Omit<BeancountPreflightResult, 'exportableIntents'> & {
  exportableIntents?: LedgerIntent[]
}

interface DraftEntry {
  date: string
  sourceId: string
  intent: LedgerIntent
}

function escapeBeancountString(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim()
}

function formatAmount(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value
  return normalized.toFixed(2)
}

function parseAmount(amount: string, context: string): number {
  const value = Number.parseFloat(amount)
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid amount for ${context}: ${amount}`)
  }
  return value
}

function postingLine(account: string, amount: number, currency: string): string {
  const left = `  ${account}`
  const spacing = left.length >= 50 ? '  ' : ' '.repeat(50 - left.length)
  return `${left}${spacing}${formatAmount(amount)} ${currency}`
}

function renderSourceId(sourceId: string): string {
  return `  source_id: "${escapeBeancountString(sourceId)}"`
}

function postingTransactionId(posting: LedgerPostingIntent, intent: LedgerIntent): string {
  return posting.transactionId ?? intent.transactionIds[0] ?? intent.id
}

function postingParseContext(posting: LedgerPostingIntent, intent: LedgerIntent): string {
  return posting.splitId ?? postingTransactionId(posting, intent)
}

function requirePostingAccount(intent: LedgerIntent, posting: LedgerPostingIntent): string {
  const transactionId = postingTransactionId(posting, intent)

  switch (posting.role) {
    case 'source':
    case 'transfer':
      if (!posting.account) {
        throw new Error(`Missing Beancount account for transaction ${transactionId}`)
      }
      return posting.account
    case 'category':
      if (!posting.account || posting.account.startsWith('Transfer:')) {
        throw new Error(`Missing export category for transaction ${transactionId}`)
      }
      return posting.account
    case 'split':
      if (!posting.account) {
        throw new Error(`Missing split ledger account for transaction ${transactionId}`)
      }
      return posting.account
  }

  const exhaustiveRole: never = posting.role
  return exhaustiveRole
}

function requireConsistentTransferCurrency(intent: LedgerIntent): void {
  if (intent.kind !== 'confirmed_transfer') return

  const [firstPosting, ...remainingPostings] = intent.postings
  if (!firstPosting) return
  for (const posting of remainingPostings) {
    if (posting.currency !== firstPosting.currency) {
      throw new Error(`Currency mismatch for transfer match ${intent.transferMatchId ?? intent.id}`)
    }
  }
}

function renderLedgerIntent(intent: LedgerIntent): string {
  requireConsistentTransferCurrency(intent)
  const lines = [
    `${intent.date} * "${escapeBeancountString(intent.description)}"`,
    renderSourceId(intent.sourceId),
  ]

  for (const posting of intent.postings) {
    const account = requirePostingAccount(intent, posting)
    const amount = parseAmount(posting.amount, postingParseContext(posting, intent))
    lines.push(postingLine(account, amount, posting.currency))
  }

  return lines.join('\n')
}

function renderHeader(preflight: BeancountDraftPreflight, generatedAt: Date): string {
  return [
    `; Generated: ${generatedAt.toISOString()}`,
    `; Period: ${preflight.period}`,
    '; Source: FinTrack',
    '; Warning: draft only; review before committing to Beancount.',
    `; Proposed staging: ${preflight.proposedStaging}`,
  ].join('\n')
}

function exportableIntentsFor(preflight: BeancountDraftPreflight): LedgerIntent[] {
  const legacyIntents = [
    ...preflight.exportableTransactions.map(ledgerIntentFromTransaction),
    ...preflight.mergedTransfers.map(ledgerIntentFromTransfer),
  ]

  if (preflight.exportableIntents !== undefined) {
    assertIntentParity(preflight.exportableIntents, legacyIntents)
    return preflight.exportableIntents
  }

  return legacyIntents
}

function assertIntentParity(intents: LedgerIntent[], legacyIntents: LedgerIntent[]): void {
  const intentSourceIds = sortedSourceIds(intents)
  const legacySourceIds = sortedSourceIds(legacyIntents)

  if (
    intentSourceIds.length !== legacySourceIds.length ||
    intentSourceIds.some((sourceId, index) => sourceId !== legacySourceIds[index])
  ) {
    throw new Error('Cannot render Beancount draft because exportableIntents do not match legacy export fields')
  }
}

function sortedSourceIds(intents: LedgerIntent[]): string[] {
  return intents.map(intent => intent.sourceId).sort((a, b) => a.localeCompare(b))
}

export function renderBeancountDraft(
  preflight: BeancountDraftPreflight,
  options: RenderBeancountDraftOptions = {},
): string {
  if (preflight.blockers.length > 0) {
    throw new Error('Cannot render Beancount draft while preflight has blockers')
  }

  const entries: DraftEntry[] = exportableIntentsFor(preflight).map(intent => ({
    date: intent.date,
    sourceId: intent.sourceId,
    intent,
  }))

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.sourceId.localeCompare(b.sourceId)
  })

  const generatedAt = options.generatedAt ?? new Date()
  const renderedEntries = entries.map(entry => renderLedgerIntent(entry.intent))
  return [renderHeader(preflight, generatedAt), ...renderedEntries].join('\n\n') + '\n'
}
