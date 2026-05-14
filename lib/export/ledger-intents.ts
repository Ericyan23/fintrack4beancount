export type LedgerIntentKind = 'cash_transaction' | 'split_transaction' | 'confirmed_transfer'

export type LedgerPostingRole = 'source' | 'category' | 'split' | 'transfer'

export interface LedgerPostingIntent {
  account: string | null
  amount: string
  currency: string
  role: LedgerPostingRole
  transactionId?: string
  splitId?: string
  memo?: string | null
  notes?: string | null
}

export interface LedgerIntent {
  id: string
  kind: LedgerIntentKind
  sourceId: string
  date: string
  description: string
  postings: LedgerPostingIntent[]
  transactionIds: string[]
  transferMatchId?: number
}

export interface ExportCandidateBalanceAssertion {
  id: string
  kind: 'balance_assertion'
  sourceId: string
  date: string
  account: string
  amount: string
  currency: string
  fintrackAccountId?: string | null
  note?: string | null
}

export type ExportCandidate = LedgerIntent | ExportCandidateBalanceAssertion

export interface LedgerIntentSplitPostingInput {
  id: string
  parentTransactionId: string
  amount: string
  currency: string
  ledgerAccount: string | null
  memo?: string | null
  notes?: string | null
}

export interface LedgerIntentTransactionInput {
  id: string
  sourceId: string
  date: string
  description: string
  amount: string
  beancountAccount: string | null
  category: string | null
  currency: string
  splitPostings?: LedgerIntentSplitPostingInput[]
}

export interface LedgerIntentTransferInput {
  id: number
  sourceId: string
  date: string
  outflow: LedgerIntentTransactionInput
  inflow: LedgerIntentTransactionInput
}

export interface BalanceAssertionCandidateInput {
  id: string
  sourceId: string
  assertionDate: string
  beancountAccount: string
  amount: string
  currency: string
  fintrackAccountId?: string | null
  note?: string | null
}

export function ledgerIntentFromTransaction(txn: LedgerIntentTransactionInput): LedgerIntent {
  const splitPostings = txn.splitPostings ?? []
  const postings: LedgerPostingIntent[] = [
    {
      account: txn.beancountAccount,
      amount: txn.amount,
      currency: txn.currency,
      role: 'source',
      transactionId: txn.id,
    },
  ]

  if (splitPostings.length > 0) {
    for (const split of splitPostings) {
      postings.push({
        account: split.ledgerAccount,
        amount: negateDecimalString(split.amount),
        currency: split.currency,
        role: 'split',
        transactionId: txn.id,
        splitId: split.id,
        memo: split.memo ?? null,
        notes: split.notes ?? null,
      })
    }
  } else {
    postings.push({
      account: txn.category,
      amount: negateDecimalString(txn.amount),
      currency: txn.currency,
      role: 'category',
      transactionId: txn.id,
    })
  }

  return {
    id: `intent:transaction:${txn.id}`,
    kind: splitPostings.length > 0 ? 'split_transaction' : 'cash_transaction',
    sourceId: txn.sourceId,
    date: txn.date,
    description: txn.description,
    postings,
    transactionIds: [txn.id],
  }
}

export function ledgerIntentFromTransfer(transfer: LedgerIntentTransferInput): LedgerIntent {
  return {
    id: `intent:transfer:${transfer.id}`,
    kind: 'confirmed_transfer',
    sourceId: transfer.sourceId,
    date: transfer.date,
    description: 'Transfer',
    postings: [
      {
        account: transfer.outflow.beancountAccount,
        amount: transfer.outflow.amount,
        currency: transfer.outflow.currency,
        role: 'transfer',
        transactionId: transfer.outflow.id,
      },
      {
        account: transfer.inflow.beancountAccount,
        amount: transfer.inflow.amount,
        currency: transfer.inflow.currency,
        role: 'transfer',
        transactionId: transfer.inflow.id,
      },
    ],
    transactionIds: [transfer.outflow.id, transfer.inflow.id],
    transferMatchId: transfer.id,
  }
}

export function exportCandidateFromBalanceAssertion(
  assertion: BalanceAssertionCandidateInput,
): ExportCandidateBalanceAssertion {
  return {
    id: `candidate:balance:${assertion.id}`,
    kind: 'balance_assertion',
    sourceId: assertion.sourceId,
    date: assertion.assertionDate,
    account: assertion.beancountAccount,
    amount: assertion.amount,
    currency: assertion.currency,
    fintrackAccountId: assertion.fintrackAccountId ?? null,
    note: assertion.note ?? null,
  }
}

export function negateDecimalString(value: string): string {
  if (/^-?0+(?:\.0+)?$/.test(value)) return value.startsWith('-') ? value.slice(1) : value
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}
