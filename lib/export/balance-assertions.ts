import path from 'path'
import { sqlite } from '@/lib/db'
import {
  accountStateOn,
  defaultBeancountRoot,
  loadLedgerSnapshot,
  type LedgerBalanceDirective,
  type LedgerSnapshot,
} from '@/lib/export/beancount-ledger'
import {
  exportCandidateFromBalanceAssertion,
  type ExportCandidateBalanceAssertion,
} from '@/lib/export/ledger-intents'
import { loadPreviouslyExportedSourceIds } from '@/lib/export/export-runs'

export type BalanceAssertionSeverity = 'blocker' | 'review'

export interface BalanceAssertionIssue {
  severity: BalanceAssertionSeverity
  code: string
  message: string
  balanceAssertionId?: string
  account?: string | null
  sourceId?: string
}

export interface PreflightBalanceAssertion {
  id: string
  fintrackAccountId: string | null
  fintrackAccountName: string | null
  beancountAccount: string
  assertionDate: string
  amount: string
  currency: string
  sourceId: string
  status: string
  note: string | null
}

export interface BalanceAssertionPreflightResult {
  ok: boolean
  period: string
  dateRange: { start: string; end: string }
  beancountRoot: string
  ledger: {
    filesScanned: number
    openAccounts: number
    sourceIds: number
    balances: number
  }
  proposedStaging: string
  summary: {
    assertionsScanned: number
    exportableAssertions: number
    positionAssertionsScanned?: number
    exportablePositionAssertions?: number
    blockers: number
    reviewItems: number
    duplicateCandidates: number
    previouslyExported?: number
  }
  blockers: BalanceAssertionIssue[]
  reviewItems: BalanceAssertionIssue[]
  duplicateCandidates: BalanceAssertionIssue[]
  exportableAssertions: PreflightBalanceAssertion[]
  exportableCandidates: ExportCandidateBalanceAssertion[]
}

interface PeriodRange {
  start: string
  end: string
}

interface InvestmentPositionRow {
  id: string
  sourceConnectionId: string | null
  sourceAccountId: string | null
  accountId: string | null
  accountName: string | null
  beancountAccount: string | null
  securityId: string | null
  sourceSymbol: string | null
  beancountCommodity: string | null
  asOfDate: string
  quantity: string
  marketValue: string | null
  currency: string | null
  rawPayload: string | null
}

function parsePeriod(period: string): PeriodRange {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('period must use YYYY-MM')
  }
  const startDate = new Date(`${period}-01T00:00:00Z`)
  if (Number.isNaN(startDate.getTime())) throw new Error('invalid period')
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0))
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  }
}

export function currentBalanceAssertionPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function loadDraftBalanceAssertions(range: PeriodRange): PreflightBalanceAssertion[] {
  return sqlite.prepare(`
    SELECT
      b.id,
      b.fintrack_account_id AS fintrackAccountId,
      a.name AS fintrackAccountName,
      b.beancount_account AS beancountAccount,
      b.assertion_date AS assertionDate,
      b.amount,
      b.currency,
      b.source_id AS sourceId,
      b.status,
      b.note
    FROM balance_assertions b
    LEFT JOIN accounts a ON a.id = b.fintrack_account_id
    WHERE b.assertion_date BETWEEN ? AND ?
      AND b.status = 'draft'
    ORDER BY b.assertion_date ASC, b.id ASC
  `).all(range.start, range.end) as PreflightBalanceAssertion[]
}

function loadInvestmentPositionRows(range: PeriodRange): InvestmentPositionRow[] {
  return sqlite.prepare(`
    SELECT
      p.id,
      p.source_connection_id AS sourceConnectionId,
      p.source_account_id AS sourceAccountId,
      p.account_id AS accountId,
      accounts.name AS accountName,
      accounts.beancount_account AS beancountAccount,
      p.security_id AS securityId,
      securities.source_symbol AS sourceSymbol,
      securities.beancount_commodity AS beancountCommodity,
      p.as_of_date AS asOfDate,
      p.quantity,
      p.market_value AS marketValue,
      p.currency,
      p.raw_payload AS rawPayload
    FROM investment_positions p
    LEFT JOIN accounts
      ON accounts.id = p.account_id
    LEFT JOIN securities
      ON securities.id = p.security_id
    WHERE p.as_of_date BETWEEN ? AND ?
    ORDER BY p.as_of_date ASC, p.id ASC
  `).all(range.start, range.end) as InvestmentPositionRow[]
}

function sourceIdForInvestmentPosition(position: Pick<InvestmentPositionRow, 'id'>): string {
  return `fintrack:position:${position.id}`
}

function toPositionBalanceAssertion(position: InvestmentPositionRow): PreflightBalanceAssertion {
  const label = position.sourceSymbol ?? position.securityId ?? position.id
  const marketValue = position.marketValue && position.currency
    ? `; market value ${position.marketValue} ${position.currency}`
    : ''

  return {
    id: `position:${position.id}`,
    fintrackAccountId: position.accountId,
    fintrackAccountName: position.accountName,
    beancountAccount: position.beancountAccount ?? '',
    assertionDate: position.asOfDate,
    amount: position.quantity,
    currency: position.beancountCommodity ?? '',
    sourceId: sourceIdForInvestmentPosition(position),
    status: 'draft',
    note: `Investment position ${label}${marketValue}`,
  }
}

function validatePositionProvenance(
  position: InvestmentPositionRow,
  assertion: PreflightBalanceAssertion,
  blockers: BalanceAssertionIssue[],
): boolean {
  const missing: string[] = []
  if (!position.sourceConnectionId) missing.push('source_connection_id')
  if (!position.sourceAccountId) missing.push('source_account_id')
  if (!position.rawPayload || position.rawPayload.trim() === '') missing.push('raw_payload')

  if (missing.length === 0) return true

  addIssue(blockers, {
    code: 'missing_position_provenance',
    balanceAssertionId: assertion.id,
    account: assertion.beancountAccount,
    sourceId: assertion.sourceId,
    message: `Investment position is missing source provenance: ${missing.join(', ')}`,
  }, 'blocker')
  return false
}

function addIssue(
  target: BalanceAssertionIssue[],
  issue: Omit<BalanceAssertionIssue, 'severity'>,
  severity: BalanceAssertionSeverity,
): void {
  target.push({ ...issue, severity })
}

function parseAmount(amount: string): number | null {
  const normalized = amount.replace(/,/g, '').trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
  const value = Number.parseFloat(normalized)
  return Number.isFinite(value) ? value : null
}

function amountsMatch(a: string, b: string, tolerance = 0.005): boolean {
  const left = parseAmount(a)
  const right = parseAmount(b)
  if (left === null || right === null) return false
  return Math.abs(left - right) < tolerance
}

function amountTolerance(assertion: PreflightBalanceAssertion): number {
  return assertion.id.startsWith('position:') ? 0.0000005 : 0.005
}

function balanceKey(assertion: Pick<PreflightBalanceAssertion, 'assertionDate' | 'beancountAccount' | 'currency'>): string {
  return `${assertion.assertionDate}|${assertion.beancountAccount}|${assertion.currency}`
}

function validateAmount(
  assertion: PreflightBalanceAssertion,
  blockers: BalanceAssertionIssue[],
): boolean {
  if (parseAmount(assertion.amount) !== null) return true
  addIssue(blockers, {
    code: 'invalid_balance_amount',
    balanceAssertionId: assertion.id,
    account: assertion.beancountAccount,
    sourceId: assertion.sourceId,
    message: `${assertion.amount} is not a valid balance assertion amount`,
  }, 'blocker')
  return false
}

function validateCurrency(
  assertion: PreflightBalanceAssertion,
  blockers: BalanceAssertionIssue[],
): boolean {
  if (/^[A-Z][A-Z0-9._-]*$/.test(assertion.currency)) return true
  addIssue(blockers, {
    code: assertion.id.startsWith('position:')
      ? 'missing_position_commodity_mapping'
      : 'invalid_balance_currency',
    balanceAssertionId: assertion.id,
    account: assertion.beancountAccount,
    sourceId: assertion.sourceId,
    message: assertion.id.startsWith('position:')
      ? 'Investment position is missing Beancount commodity mapping'
      : `${assertion.currency} is not a valid balance assertion currency or commodity`,
  }, 'blocker')
  return false
}

function validateLedgerAccount(
  snapshot: LedgerSnapshot,
  assertion: PreflightBalanceAssertion,
  blockers: BalanceAssertionIssue[],
): boolean {
  const state = accountStateOn(snapshot, assertion.beancountAccount, assertion.assertionDate)
  if (state.ok) return true

  const code = state.reason === 'missing'
    ? 'balance_account_not_open'
    : state.reason === 'not_yet_open'
      ? 'balance_account_not_yet_open'
      : 'balance_account_closed'
  addIssue(blockers, {
    code,
    balanceAssertionId: assertion.id,
    account: assertion.beancountAccount,
    sourceId: assertion.sourceId,
    message: `${assertion.beancountAccount} is not open on ${assertion.assertionDate}`,
  }, 'blocker')
  return false
}

function validateDuplicateSourceId(
  snapshot: LedgerSnapshot,
  assertion: PreflightBalanceAssertion,
  blockers: BalanceAssertionIssue[],
  duplicateCandidates: BalanceAssertionIssue[],
): boolean {
  const existing = snapshot.sourceIds.get(assertion.sourceId)
  if (!existing) return true

  const issue = {
    code: 'duplicate_balance_source_id',
    balanceAssertionId: assertion.id,
    account: assertion.beancountAccount,
    sourceId: assertion.sourceId,
    message: `${assertion.sourceId} already exists in ${path.relative(snapshot.root, existing.file)}:${existing.line}`,
  }
  addIssue(blockers, issue, 'blocker')
  addIssue(duplicateCandidates, issue, 'review')
  return false
}

function findExistingBalances(
  snapshot: LedgerSnapshot,
  assertion: PreflightBalanceAssertion,
): LedgerBalanceDirective[] {
  return snapshot.balances.filter(balance =>
    balance.date === assertion.assertionDate &&
    balance.account === assertion.beancountAccount &&
    balance.currency === assertion.currency
  )
}

function validateExistingBalance(
  snapshot: LedgerSnapshot,
  assertion: PreflightBalanceAssertion,
  blockers: BalanceAssertionIssue[],
  duplicateCandidates: BalanceAssertionIssue[],
): boolean {
  const existing = findExistingBalances(snapshot, assertion)
  if (existing.length === 0) return true

  const tolerance = amountTolerance(assertion)
  const sameAmount = existing.some(balance => amountsMatch(balance.amount, assertion.amount, tolerance))
  const balance = sameAmount ? existing.find(item => amountsMatch(item.amount, assertion.amount, tolerance)) ?? existing[0] : existing[0]
  const code = sameAmount ? 'duplicate_existing_balance' : 'conflicting_existing_balance'
  const issue = {
    code,
    balanceAssertionId: assertion.id,
    account: assertion.beancountAccount,
    sourceId: assertion.sourceId,
    message: `${assertion.beancountAccount} already has ${balance.amount} ${balance.currency} balance on ${balance.date} in ${path.relative(snapshot.root, balance.file)}:${balance.line}`,
  }
  addIssue(blockers, issue, 'blocker')
  addIssue(duplicateCandidates, issue, 'review')
  return false
}

function groupByBalanceKey(assertions: PreflightBalanceAssertion[]): Map<string, PreflightBalanceAssertion[]> {
  const groups = new Map<string, PreflightBalanceAssertion[]>()
  for (const assertion of assertions) {
    const key = balanceKey(assertion)
    groups.set(key, [...(groups.get(key) ?? []), assertion])
  }
  return groups
}

function markDraftDuplicates(
  candidates: PreflightBalanceAssertion[],
  blockers: BalanceAssertionIssue[],
  duplicateCandidates: BalanceAssertionIssue[],
): Set<string> {
  const blockedIds = new Set<string>()

  for (const group of groupByBalanceKey(candidates).values()) {
    if (group.length < 2) continue
    const tolerance = Math.min(...group.map(amountTolerance))
    const allSameAmount = group.every(assertion => amountsMatch(assertion.amount, group[0].amount, tolerance))
    const code = allSameAmount ? 'duplicate_draft_balance' : 'conflicting_draft_balance'

    for (const assertion of group) {
      blockedIds.add(assertion.id)
      const issue = {
        code,
        balanceAssertionId: assertion.id,
        account: assertion.beancountAccount,
        sourceId: assertion.sourceId,
        message: `${assertion.beancountAccount} has ${group.length} draft balance assertions on ${assertion.assertionDate} ${assertion.currency}`,
      }
      addIssue(blockers, issue, 'blocker')
      addIssue(duplicateCandidates, issue, 'review')
    }
  }

  return blockedIds
}

export function runBalanceAssertionPreflight(options: {
  period?: string
  beancountRoot?: string
  excludeExported?: boolean
} = {}): BalanceAssertionPreflightResult {
  const period = options.period ?? currentBalanceAssertionPeriod()
  const range = parsePeriod(period)
  const beancountRoot = options.beancountRoot ?? defaultBeancountRoot()
  const snapshot = loadLedgerSnapshot(beancountRoot)
  const manualRows = loadDraftBalanceAssertions(range)
  const positionRows = loadInvestmentPositionRows(range)
  const positionAssertions = positionRows.map(toPositionBalanceAssertion)
  const positionRowsByAssertion = new Map(
    positionRows.map((position, index) => [positionAssertions[index], position]),
  )
  const rows = [...manualRows, ...positionAssertions]
  const blockers: BalanceAssertionIssue[] = []
  const reviewItems: BalanceAssertionIssue[] = []
  const duplicateCandidates: BalanceAssertionIssue[] = []
  const validCandidates: PreflightBalanceAssertion[] = []
  const previouslyExportedSourceIds = options.excludeExported
    ? loadPreviouslyExportedSourceIds({ exportTarget: 'beancount_handoff' })
    : new Set<string>()
  let previouslyExported = 0

  for (const assertion of rows) {
    if (previouslyExportedSourceIds.has(assertion.sourceId)) {
      previouslyExported += 1
      continue
    }

    let valid = true
    const positionRow = positionRowsByAssertion.get(assertion)
    if (positionRow) {
      valid = validatePositionProvenance(positionRow, assertion, blockers) && valid
    }
    valid = validateAmount(assertion, blockers) && valid
    valid = validateCurrency(assertion, blockers) && valid
    valid = validateLedgerAccount(snapshot, assertion, blockers) && valid
    valid = validateDuplicateSourceId(snapshot, assertion, blockers, duplicateCandidates) && valid
    valid = validateExistingBalance(snapshot, assertion, blockers, duplicateCandidates) && valid
    if (valid) validCandidates.push(assertion)
  }

  const blockedDraftIds = markDraftDuplicates(validCandidates, blockers, duplicateCandidates)
  const exportableAssertions = validCandidates.filter(assertion => !blockedDraftIds.has(assertion.id))
  const exportableCandidates = exportableAssertions.map(exportCandidateFromBalanceAssertion)
  const proposedStaging = path.join('staging', period, 'fintrack', 'draft', `${period}-balances.bean`)

  return {
    ok: blockers.length === 0,
    period,
    dateRange: { start: range.start, end: range.end },
    beancountRoot,
    ledger: {
      filesScanned: snapshot.files.length,
      openAccounts: snapshot.accounts.size,
      sourceIds: snapshot.sourceIds.size,
      balances: snapshot.balances.length,
    },
    proposedStaging,
    summary: {
      assertionsScanned: rows.length,
      exportableAssertions: exportableAssertions.length,
      positionAssertionsScanned: positionAssertions.length,
      exportablePositionAssertions: exportableAssertions.filter(assertion => assertion.id.startsWith('position:')).length,
      blockers: blockers.length,
      reviewItems: reviewItems.length,
      duplicateCandidates: duplicateCandidates.length,
      previouslyExported,
    },
    blockers,
    reviewItems,
    duplicateCandidates,
    exportableAssertions,
    exportableCandidates,
  }
}

function escapeBeancountString(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim()
}

function formatBalanceAmount(value: string): string {
  const amount = parseAmount(value)
  if (amount === null) throw new Error(`Invalid balance assertion amount: ${value}`)
  const normalized = value.replace(/,/g, '').trim()
  if (Object.is(amount, -0) || /^-0+(?:\.0+)?$/.test(normalized)) {
    return normalized.slice(1)
  }
  return normalized
}

function balanceLine(assertion: PreflightBalanceAssertion): string {
  const left = `${assertion.assertionDate} balance ${assertion.beancountAccount}`
  const spacing = left.length >= 58 ? '  ' : ' '.repeat(58 - left.length)
  return `${left}${spacing}${formatBalanceAmount(assertion.amount)} ${assertion.currency}`
}

function renderBalanceAssertion(assertion: PreflightBalanceAssertion): string {
  const lines = [
    balanceLine(assertion),
    `  source_id: "${escapeBeancountString(assertion.sourceId)}"`,
  ]
  if (assertion.fintrackAccountId) {
    lines.push(`  fintrack_account_id: "${escapeBeancountString(assertion.fintrackAccountId)}"`)
  }
  if (assertion.note) {
    lines.push(`  fintrack_note: "${escapeBeancountString(assertion.note)}"`)
  }
  return lines.join('\n')
}

function renderHeader(preflight: BalanceAssertionPreflightResult, generatedAt: Date): string {
  return [
    `; Generated: ${generatedAt.toISOString()}`,
    `; Period: ${preflight.period}`,
    '; Source: FinTrack balance assertions',
    '; Warning: draft only; review before committing to Beancount.',
    `; Proposed staging: ${preflight.proposedStaging}`,
  ].join('\n')
}

export function renderBalanceAssertionDraft(
  preflight: BalanceAssertionPreflightResult,
  options: { generatedAt?: Date } = {},
): string {
  if (preflight.blockers.length > 0) {
    throw new Error('Cannot render balance assertion draft while preflight has blockers')
  }

  const generatedAt = options.generatedAt ?? new Date()
  const rendered = [...preflight.exportableAssertions]
    .sort((a, b) => {
      if (a.assertionDate !== b.assertionDate) return a.assertionDate.localeCompare(b.assertionDate)
      return a.sourceId.localeCompare(b.sourceId)
    })
    .map(renderBalanceAssertion)

  return [renderHeader(preflight, generatedAt), ...rendered].join('\n\n') + '\n'
}
