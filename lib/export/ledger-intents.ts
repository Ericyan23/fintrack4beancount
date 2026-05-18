export type LedgerIntentKind =
  | 'cash_transaction'
  | 'split_transaction'
  | 'confirmed_transfer'
  | 'investment_activity'

export type LedgerPostingRole =
  | 'source'
  | 'category'
  | 'split'
  | 'transfer'
  | 'investment_security'
  | 'investment_cash'
  | 'investment_fee'
  | 'investment_pnl'
  | 'investment_income'

export interface LedgerPostingPrice {
  amount: string
  currency: string
}

export interface LedgerPostingIntent {
  account: string | null
  amount: string | null
  currency: string | null
  role: LedgerPostingRole
  transactionId?: string
  investmentActivityId?: string
  splitId?: string
  memo?: string | null
  notes?: string | null
  cost?: LedgerPostingPrice | null
  price?: LedgerPostingPrice | null
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

export interface LedgerIntentInvestmentActivityInput {
  id: string
  sourceId: string
  date: string
  description: string
  activityType: 'buy' | 'sell' | 'dividend' | 'interest' | 'reinvest_dividend'
  positionEffect?: string | null
  investmentAccount: string | null
  commodity?: string | null
  quantity?: string | null
  cashAmount: string
  cashCurrency: string
  unitCost?: string | null
  unitPrice?: string | null
  feeAmount?: string | null
  feeAccount?: string | null
  pnlAccount?: string | null
  incomeAccount?: string | null
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

export function ledgerIntentFromInvestmentActivity(
  activity: LedgerIntentInvestmentActivityInput,
): LedgerIntent {
  const postings = investmentPostings(activity)

  return {
    id: `intent:investment:${activity.id}`,
    kind: 'investment_activity',
    sourceId: activity.sourceId,
    date: activity.date,
    description: activity.description,
    postings,
    transactionIds: [],
  }
}

function investmentPostings(activity: LedgerIntentInvestmentActivityInput): LedgerPostingIntent[] {
  switch (activity.activityType) {
    case 'buy':
    case 'sell':
      return tradeInvestmentPostings(activity)
    case 'dividend':
    case 'interest':
      return incomeInvestmentPostings(activity)
    case 'reinvest_dividend':
      return reinvestDividendPostings(activity)
  }

  const exhaustiveActivityType: never = activity.activityType
  return exhaustiveActivityType
}

function tradeInvestmentPostings(activity: LedgerIntentInvestmentActivityInput): LedgerPostingIntent[] {
  if (activity.activityType !== 'buy' && activity.activityType !== 'sell') {
    throw new Error(`Unsupported trade investment activity type: ${activity.activityType}`)
  }

  const quantity = signedInvestmentQuantity(activity.activityType, activity.quantity ?? '')
  const requiresPnlPosting = Boolean(activity.pnlAccount)
  const postings: LedgerPostingIntent[] = [
    securityPosting(activity, quantity, {
      cost: requiresPnlPosting || !activity.unitCost
        ? null
        : { amount: activity.unitCost, currency: activity.cashCurrency },
      price: activity.unitPrice
        ? { amount: activity.unitPrice, currency: activity.cashCurrency }
        : null,
    }),
    cashPosting(activity, activity.cashAmount),
  ]

  appendFeeAndPnlPostings(postings, activity, requiresPnlPosting)
  return postings
}

function incomeInvestmentPostings(activity: LedgerIntentInvestmentActivityInput): LedgerPostingIntent[] {
  return [
    cashPosting(activity, activity.cashAmount),
    {
      account: activity.incomeAccount ?? null,
      amount: negateDecimalString(activity.cashAmount),
      currency: activity.cashCurrency,
      role: 'investment_income',
      investmentActivityId: activity.id,
    },
  ]
}

function reinvestDividendPostings(activity: LedgerIntentInvestmentActivityInput): LedgerPostingIntent[] {
  return [
    securityPosting(activity, activity.quantity ?? '', {
      cost: activity.unitCost
        ? { amount: activity.unitCost, currency: activity.cashCurrency }
        : null,
      price: null,
    }),
    {
      account: activity.incomeAccount ?? null,
      amount: negateDecimalString(activity.cashAmount),
      currency: activity.cashCurrency,
      role: 'investment_income',
      investmentActivityId: activity.id,
    },
  ]
}

function securityPosting(
  activity: LedgerIntentInvestmentActivityInput,
  amount: string,
  annotation: Pick<LedgerPostingIntent, 'cost' | 'price'>,
): LedgerPostingIntent {
  return {
    account: activity.investmentAccount,
    amount,
    currency: activity.commodity ?? null,
    role: 'investment_security',
    investmentActivityId: activity.id,
    cost: annotation.cost,
    price: annotation.price,
  }
}

function cashPosting(
  activity: LedgerIntentInvestmentActivityInput,
  amount: string,
): LedgerPostingIntent {
  return {
    account: activity.investmentAccount,
    amount,
    currency: activity.cashCurrency,
    role: 'investment_cash',
    investmentActivityId: activity.id,
  }
}

function appendFeeAndPnlPostings(
  postings: LedgerPostingIntent[],
  activity: LedgerIntentInvestmentActivityInput,
  requiresPnlPosting: boolean,
): void {
  if (activity.feeAmount && !isZeroDecimalString(activity.feeAmount)) {
    postings.push({
      account: activity.feeAccount ?? null,
      amount: activity.feeAmount,
      currency: activity.cashCurrency,
      role: 'investment_fee',
      investmentActivityId: activity.id,
    })
  }

  if (requiresPnlPosting) {
    postings.push({
      account: activity.pnlAccount ?? null,
      amount: null,
      currency: null,
      role: 'investment_pnl',
      investmentActivityId: activity.id,
    })
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

function signedInvestmentQuantity(activityType: 'buy' | 'sell', quantity: string): string {
  const unsigned = quantity.startsWith('-') ? quantity.slice(1) : quantity
  return activityType === 'sell' && !isZeroDecimalString(unsigned) ? `-${unsigned}` : unsigned
}

function isZeroDecimalString(value: string): boolean {
  return /^-?0+(?:\.0+)?$/.test(value)
}
