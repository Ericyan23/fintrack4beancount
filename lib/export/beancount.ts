import type {
  BeancountPreflightResult,
  PreflightTransaction,
  PreflightTransfer,
} from '@/lib/export/preflight'

export interface RenderBeancountDraftOptions {
  generatedAt?: Date
}

interface DraftEntry {
  date: string
  sourceId: string
  render: () => string
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

function requireAccount(txn: PreflightTransaction): string {
  if (!txn.beancountAccount) {
    throw new Error(`Missing Beancount account for transaction ${txn.id}`)
  }
  return txn.beancountAccount
}

function requireCategory(txn: PreflightTransaction): string {
  if (!txn.category || txn.category.startsWith('Transfer:')) {
    throw new Error(`Missing export category for transaction ${txn.id}`)
  }
  return txn.category
}

function renderTransaction(txn: PreflightTransaction): string {
  const account = requireAccount(txn)
  const category = requireCategory(txn)
  const amount = parseAmount(txn.amount, txn.id)

  return [
    `${txn.date} * "${escapeBeancountString(txn.description)}"`,
    renderSourceId(txn.sourceId),
    postingLine(account, amount, txn.currency),
    postingLine(category, -amount, txn.currency),
  ].join('\n')
}

function renderTransfer(transfer: PreflightTransfer): string {
  const outflowAccount = requireAccount(transfer.outflow)
  const inflowAccount = requireAccount(transfer.inflow)
  const outflowAmount = parseAmount(transfer.outflow.amount, transfer.outflow.id)
  const inflowAmount = parseAmount(transfer.inflow.amount, transfer.inflow.id)
  const currency = transfer.outflow.currency

  if (currency !== transfer.inflow.currency) {
    throw new Error(`Currency mismatch for transfer match ${transfer.id}`)
  }

  return [
    `${transfer.date} * "Transfer"`,
    renderSourceId(transfer.sourceId),
    postingLine(outflowAccount, outflowAmount, currency),
    postingLine(inflowAccount, inflowAmount, currency),
  ].join('\n')
}

function renderHeader(preflight: BeancountPreflightResult, generatedAt: Date): string {
  return [
    `; Generated: ${generatedAt.toISOString()}`,
    `; Period: ${preflight.period}`,
    '; Source: FinTrack',
    '; Warning: draft only; review before committing to Beancount.',
    `; Proposed staging: ${preflight.proposedStaging}`,
  ].join('\n')
}

export function renderBeancountDraft(
  preflight: BeancountPreflightResult,
  options: RenderBeancountDraftOptions = {},
): string {
  if (preflight.blockers.length > 0) {
    throw new Error('Cannot render Beancount draft while preflight has blockers')
  }

  const entries: DraftEntry[] = [
    ...preflight.exportableTransactions.map(txn => ({
      date: txn.date,
      sourceId: txn.sourceId,
      render: () => renderTransaction(txn),
    })),
    ...preflight.mergedTransfers.map(transfer => ({
      date: transfer.date,
      sourceId: transfer.sourceId,
      render: () => renderTransfer(transfer),
    })),
  ]

  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.sourceId.localeCompare(b.sourceId)
  })

  const generatedAt = options.generatedAt ?? new Date()
  const renderedEntries = entries.map(entry => entry.render())
  return [renderHeader(preflight, generatedAt), ...renderedEntries].join('\n\n') + '\n'
}
