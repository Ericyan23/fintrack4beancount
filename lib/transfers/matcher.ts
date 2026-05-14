import { sqlite } from '@/lib/db'

export type TransferMatchStatus = 'suggested' | 'confirmed' | 'ignored'

export interface TransferTxn {
  id: string
  accountId: string
  accountName: string
  accountType: string
  accountTypeOverride: string | null
  beancountAccount: string | null
  posted: number
  amount: string
  description: string
  category: string
}

export interface TransferMatchView {
  id: number
  status: TransferMatchStatus
  kind: string
  confidence: number
  dateDeltaDays: number
  reason: string
  createdAt: number
  updatedAt: number
  outflow: TransferTxn
  inflow: TransferTxn
}

export interface TransferScanResult {
  suggested: number
  confirmed: number
  ignored: number
  unmatched: number
  candidates: number
}

interface CandidateTxn extends TransferTxn {
  cents: number
}

interface MatchCandidate {
  outflow: CandidateTxn
  inflow: CandidateTxn
  kind: string
  confidence: number
  dateDeltaDays: number
  reason: string
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function amountCents(amount: string): number {
  return Math.round(Number.parseFloat(amount) * 100)
}

function daysBetween(a: number, b: number): number {
  return Math.abs(Math.round((a - b) / 86400))
}

function effectiveAccountType(txn: Pick<TransferTxn, 'accountType' | 'accountTypeOverride'>): string {
  return txn.accountTypeOverride || txn.accountType
}

function isCreditLike(txn: TransferTxn): boolean {
  const type = effectiveAccountType(txn)
  return type === 'credit' || type === 'loan'
}

function text(txn: TransferTxn): string {
  return `${txn.description} ${txn.category} ${txn.accountName}`.toUpperCase()
}

function hasAny(value: string, pattern: RegExp): boolean {
  return pattern.test(value)
}

function isBankLike(txn: TransferTxn): boolean {
  const type = effectiveAccountType(txn)
  return type === 'depository' || type === 'cash'
}

function hasCreditPaymentLanguage(txn: TransferTxn): boolean {
  return hasAny(text(txn), /CREDIT (?:CARD|CRD)|CARD PAYMENT|ACH PMT|EPAY|PAYMENT.*THANK|THANK YOU|PAYMENT FROM (?:CHK|CHECKING)|AUTOPAY|MOBILE BANKING PAYMENT/)
}

function transferKind(outflow: TransferTxn, inflow: TransferTxn): string {
  const combined = `${text(outflow)} ${text(inflow)}`
  if (hasAny(combined, /BROKERAGE|INVESTMENT|MONEYLINE/)) return 'investment'
  if (hasAny(combined, /WALLET|PAYPAL|VENMO|CASH APP/)) return 'wallet'
  if (isCreditLike(outflow) || isCreditLike(inflow)) return 'credit_card_payment'
  if (hasAny(combined, /CREDIT (?:CARD|CRD)|CARD PAYMENT|PAYMENT.*THANK|THANK YOU|CRD \d|AUTOPAY/)) {
    return 'credit_card_payment'
  }
  if (hasAny(combined, /TRANSFER|P2P|BANKING TRANSFER|ATM/)) return 'internal'
  return 'other'
}

function shouldAutoConfirm(candidate: MatchCandidate): boolean {
  const oneCreditOneBank =
    (isCreditLike(candidate.outflow) && isBankLike(candidate.inflow)) ||
    (isCreditLike(candidate.inflow) && isBankLike(candidate.outflow))

  if (
    candidate.kind === 'credit_card_payment' &&
    oneCreditOneBank &&
    candidate.confidence >= 92 &&
    hasCreditPaymentLanguage(candidate.outflow) &&
    hasCreditPaymentLanguage(candidate.inflow)
  ) {
    return true
  }

  if (
    candidate.kind === 'internal' &&
    candidate.confidence >= 95 &&
    candidate.dateDeltaDays === 0 &&
    hasAny(`${text(candidate.outflow)} ${text(candidate.inflow)}`, /CONF|REF|ZELLE|ONLINE BANKING TRANSFER/)
  ) {
    return true
  }

  return false
}

function confirmationTokens(description: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of description.matchAll(/(?:confirmation#|conf#)\s*([a-z0-9]+)/gi)) {
    if (match[1] && match[1].length >= 5) tokens.add(match[1].toLowerCase())
  }
  return tokens
}

function hasSharedConfirmation(a: TransferTxn, b: TransferTxn): boolean {
  const left = confirmationTokens(a.description)
  if (left.size === 0) return false
  const right = confirmationTokens(b.description)
  for (const token of left) {
    if (right.has(token)) return true
  }
  return false
}

function scoreCandidate(outflow: CandidateTxn, inflow: CandidateTxn): MatchCandidate | null {
  if (outflow.accountId === inflow.accountId) return null
  if (Math.abs(outflow.cents) !== Math.abs(inflow.cents)) return null

  const dateDeltaDays = daysBetween(outflow.posted, inflow.posted)
  if (dateDeltaDays > 7) return null

  const kind = transferKind(outflow, inflow)
  const reasons = ['same amount']
  let confidence = 60

  if (dateDeltaDays === 0) {
    confidence += 20
    reasons.push('same day')
  } else if (dateDeltaDays <= 2) {
    confidence += 18
    reasons.push(`within ${dateDeltaDays} days`)
  } else if (dateDeltaDays <= 5) {
    confidence += 12
    reasons.push(`within ${dateDeltaDays} days`)
  } else {
    confidence += 8
    reasons.push(`within ${dateDeltaDays} days`)
  }

  if (kind === 'credit_card_payment') {
    confidence += 15
    reasons.push('credit/bank pattern')
  } else if (kind === 'internal') {
    confidence += 10
    reasons.push('internal transfer pattern')
  } else if (kind === 'wallet' || kind === 'investment') {
    confidence += 8
    reasons.push(`${kind} pattern`)
  }

  if (hasSharedConfirmation(outflow, inflow)) {
    confidence += 20
    reasons.push('shared confirmation')
  }

  if (
    hasAny(text(outflow), /PAYMENT|TRANSFER|EPAY|ACH|ZELLE|AUTOPAY|CONF/) &&
    hasAny(text(inflow), /PAYMENT|TRANSFER|EPAY|ACH|ZELLE|AUTOPAY|CONF|THANK/)
  ) {
    confidence += 5
    reasons.push('transfer descriptions')
  }

  return {
    outflow,
    inflow,
    kind,
    confidence: Math.min(confidence, 100),
    dateDeltaDays,
    reason: reasons.join(', '),
  }
}

function loadTransferTransactions(): CandidateTxn[] {
  const rows = sqlite.prepare(`
    SELECT
      t.id,
      t.account_id AS accountId,
      a.name AS accountName,
      a.account_type AS accountType,
      a.account_type_override AS accountTypeOverride,
      a.beancount_account AS beancountAccount,
      t.posted,
      t.amount,
      t.description,
      COALESCE(NULLIF(t.ledger_account, ''), t.category) AS category
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.status = 'posted'
      AND COALESCE(NULLIF(t.ledger_account, ''), t.category) LIKE 'Transfer:%'
  `).all() as Array<Omit<CandidateTxn, 'cents'>>

  return rows
    .map(row => ({ ...row, cents: amountCents(row.amount) }))
    .filter(row => row.cents !== 0)
}

function lockedTransactionIds(): Set<string> {
  const rows = sqlite.prepare(`
    SELECT outflow_transaction_id AS outflowId, inflow_transaction_id AS inflowId
    FROM transfer_matches
    WHERE status = 'confirmed'
  `).all() as Array<{ outflowId: string; inflowId: string }>

  const ids = new Set<string>()
  for (const row of rows) {
    ids.add(row.outflowId)
    ids.add(row.inflowId)
  }
  return ids
}

function ignoredPairs(): Set<string> {
  const rows = sqlite.prepare(`
    SELECT outflow_transaction_id AS outflowId, inflow_transaction_id AS inflowId
    FROM transfer_matches
    WHERE status = 'ignored'
  `).all() as Array<{ outflowId: string; inflowId: string }>
  return new Set(rows.map(row => `${row.outflowId}:${row.inflowId}`))
}

export function scanTransferMatches(): TransferScanResult {
  const txns = loadTransferTransactions()
  const locked = lockedTransactionIds()
  const ignored = ignoredPairs()
  const outflows = txns.filter(txn => txn.cents < 0 && !locked.has(txn.id))
  const inflows = txns.filter(txn => txn.cents > 0 && !locked.has(txn.id))
  const candidates: MatchCandidate[] = []

  for (const outflow of outflows) {
    for (const inflow of inflows) {
      if (ignored.has(`${outflow.id}:${inflow.id}`)) continue
      const candidate = scoreCandidate(outflow, inflow)
      if (candidate && candidate.confidence >= 78) candidates.push(candidate)
    }
  }

  candidates.sort((a, b) =>
    b.confidence - a.confidence
    || a.dateDeltaDays - b.dateDeltaDays
    || Math.abs(b.outflow.cents) - Math.abs(a.outflow.cents)
  )

  let suggested = 0
  const used = new Set<string>()
  const createdAt = now()
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO transfer_matches
      (outflow_transaction_id, inflow_transaction_id, kind, status, confidence,
       date_delta_days, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM transfer_matches WHERE status = 'suggested'`).run()

    for (const candidate of candidates) {
      if (used.has(candidate.outflow.id) || used.has(candidate.inflow.id)) continue
      const status: TransferMatchStatus = shouldAutoConfirm(candidate) ? 'confirmed' : 'suggested'
      const result = insert.run(
        candidate.outflow.id,
        candidate.inflow.id,
        candidate.kind,
        status,
        candidate.confidence,
        candidate.dateDeltaDays,
        status === 'confirmed' ? `${candidate.reason}, auto-confirmed` : candidate.reason,
        createdAt,
        createdAt,
      )
      if (result.changes > 0) {
        used.add(candidate.outflow.id)
        used.add(candidate.inflow.id)
        suggested++
      }
    }
  })()

  return transferSummary(candidates.length)
}

export function setTransferMatchStatus(id: number, status: TransferMatchStatus): void {
  const updatedAt = now()
  const match = sqlite.prepare(`
    SELECT id, outflow_transaction_id AS outflowId, inflow_transaction_id AS inflowId
    FROM transfer_matches
    WHERE id = ?
  `).get(id) as { id: number; outflowId: string; inflowId: string } | undefined

  if (!match) return

  sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE transfer_matches
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, updatedAt, id)

    if (status === 'confirmed') {
      sqlite.prepare(`
        DELETE FROM transfer_matches
        WHERE status = 'suggested'
          AND id != ?
          AND (
            outflow_transaction_id IN (?, ?)
            OR inflow_transaction_id IN (?, ?)
          )
      `).run(id, match.outflowId, match.inflowId, match.outflowId, match.inflowId)
    }
  })()
}

export function listTransferMatches(status?: TransferMatchStatus | 'all'): TransferMatchView[] {
  const statusClause = status && status !== 'all' ? 'WHERE m.status = ?' : ''
  const params = status && status !== 'all' ? [status] : []
  const rows = sqlite.prepare(`
    SELECT
      m.id,
      m.status,
      m.kind,
      m.confidence,
      m.date_delta_days AS dateDeltaDays,
      m.reason,
      m.created_at AS createdAt,
      m.updated_at AS updatedAt,

      out_t.id AS out_id,
      out_t.account_id AS out_accountId,
      out_a.name AS out_accountName,
      out_a.account_type AS out_accountType,
      out_a.account_type_override AS out_accountTypeOverride,
      out_a.beancount_account AS out_beancountAccount,
      out_t.posted AS out_posted,
      out_t.amount AS out_amount,
      out_t.description AS out_description,
      COALESCE(NULLIF(out_t.ledger_account, ''), out_t.category) AS out_category,

      in_t.id AS in_id,
      in_t.account_id AS in_accountId,
      in_a.name AS in_accountName,
      in_a.account_type AS in_accountType,
      in_a.account_type_override AS in_accountTypeOverride,
      in_a.beancount_account AS in_beancountAccount,
      in_t.posted AS in_posted,
      in_t.amount AS in_amount,
      in_t.description AS in_description,
      COALESCE(NULLIF(in_t.ledger_account, ''), in_t.category) AS in_category
    FROM transfer_matches m
    JOIN transactions out_t ON out_t.id = m.outflow_transaction_id
    JOIN accounts out_a ON out_a.id = out_t.account_id
    JOIN transactions in_t ON in_t.id = m.inflow_transaction_id
    JOIN accounts in_a ON in_a.id = in_t.account_id
    ${statusClause}
    ORDER BY
      CASE m.status WHEN 'suggested' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
      m.confidence DESC,
      out_t.posted DESC
  `).all(...params) as Array<{
    id: number
    status: TransferMatchStatus
    kind: string
    confidence: number
    dateDeltaDays: number
    reason: string
    createdAt: number
    updatedAt: number
    out_id: string
    out_accountId: string
    out_accountName: string
    out_accountType: string
    out_accountTypeOverride: string | null
    out_beancountAccount: string | null
    out_posted: number
    out_amount: string
    out_description: string
    out_category: string
    in_id: string
    in_accountId: string
    in_accountName: string
    in_accountType: string
    in_accountTypeOverride: string | null
    in_beancountAccount: string | null
    in_posted: number
    in_amount: string
    in_description: string
    in_category: string
  }>

  return rows.map(row => ({
    id: row.id,
    status: row.status,
    kind: row.kind,
    confidence: row.confidence,
    dateDeltaDays: row.dateDeltaDays,
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    outflow: {
      id: row.out_id,
      accountId: row.out_accountId,
      accountName: row.out_accountName,
      accountType: row.out_accountType,
      accountTypeOverride: row.out_accountTypeOverride,
      beancountAccount: row.out_beancountAccount,
      posted: row.out_posted,
      amount: row.out_amount,
      description: row.out_description,
      category: row.out_category,
    },
    inflow: {
      id: row.in_id,
      accountId: row.in_accountId,
      accountName: row.in_accountName,
      accountType: row.in_accountType,
      accountTypeOverride: row.in_accountTypeOverride,
      beancountAccount: row.in_beancountAccount,
      posted: row.in_posted,
      amount: row.in_amount,
      description: row.in_description,
      category: row.in_category,
    },
  }))
}

export function listUnmatchedTransferTransactions(): TransferTxn[] {
  return sqlite.prepare(`
    SELECT
      t.id,
      t.account_id AS accountId,
      a.name AS accountName,
      a.account_type AS accountType,
      a.account_type_override AS accountTypeOverride,
      a.beancount_account AS beancountAccount,
      t.posted,
      t.amount,
      t.description,
      COALESCE(NULLIF(t.ledger_account, ''), t.category) AS category
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.status = 'posted'
      AND COALESCE(NULLIF(t.ledger_account, ''), t.category) LIKE 'Transfer:%'
      AND NOT EXISTS (
        SELECT 1
        FROM transfer_matches m
        WHERE m.status IN ('suggested', 'confirmed')
          AND (m.outflow_transaction_id = t.id OR m.inflow_transaction_id = t.id)
      )
    ORDER BY ABS(CAST(t.amount AS REAL)) DESC, t.posted DESC
  `).all() as TransferTxn[]
}

export function transferSummary(candidateCount = 0): TransferScanResult {
  const row = sqlite.prepare(`
    SELECT
      COUNT(CASE WHEN status = 'suggested' THEN 1 END) AS suggested,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN status = 'ignored' THEN 1 END) AS ignored
    FROM transfer_matches
  `).get() as { suggested: number; confirmed: number; ignored: number }

  return {
    suggested: row.suggested ?? 0,
    confirmed: row.confirmed ?? 0,
    ignored: row.ignored ?? 0,
    unmatched: listUnmatchedTransferTransactions().length,
    candidates: candidateCount,
  }
}
