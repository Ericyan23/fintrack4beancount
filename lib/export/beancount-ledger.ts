import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface LedgerAccountState {
  account: string
  openDate: string
  closeDate: string | null
  file: string
  line: number
}

export interface LedgerSourceId {
  sourceId: string
  file: string
  line: number
}

export interface LedgerPosting {
  date: string
  payee: string
  account: string
  amount: string
  currency: string
  file: string
  line: number
  sourceId: string | null
}

export interface LedgerBalanceDirective {
  date: string
  account: string
  amount: string
  currency: string
  file: string
  line: number
  sourceId: string | null
}

export interface LedgerSnapshot {
  root: string
  mainFile: string
  files: string[]
  accounts: Map<string, LedgerAccountState>
  sourceIds: Map<string, LedgerSourceId>
  postings: LedgerPosting[]
  balances: LedgerBalanceDirective[]
}

export type BeancountAccountStatus = 'open' | 'closed' | 'not_yet_open'

export interface BeancountAccountView {
  account: string
  root: string
  status: BeancountAccountStatus
  openDate: string
  closeDate: string | null
  file: string
  line: number
}

const INCLUDE_RE = /^\s*include\s+"([^"]+)"/
const OPEN_RE = /^\s*(\d{4}-\d{2}-\d{2})\s+open\s+([A-Z][A-Za-z0-9:_-]+)\b/
const CLOSE_RE = /^\s*(\d{4}-\d{2}-\d{2})\s+close\s+([A-Z][A-Za-z0-9:_-]+)\b/
const SOURCE_ID_RE = /^\s+source_id:\s+"([^"]+)"/
const TRANSACTION_RE = /^(\d{4}-\d{2}-\d{2})\s+[*!]\s+(.*)$/
const POSTING_RE = /^\s+([A-Z][A-Za-z0-9:_-]+)\s+(-?\d+(?:\.\d+)?)\s+([A-Z][A-Z0-9._-]*)\b/
const BALANCE_RE = /^(\d{4}-\d{2}-\d{2})\s+balance\s+([A-Z][A-Za-z0-9:_-]+)\s+(-?[\d,]+(?:\.\d+)?)\s+([A-Z][A-Z0-9._-]*)\b/

export function defaultBeancountRoot(): string {
  return process.env.BEANCOUNT_ROOT ?? path.resolve(process.cwd(), '..', 'beancount')
}

function isComment(line: string): boolean {
  return line.trimStart().startsWith(';')
}

function resolveInclude(currentFile: string, includePath: string): string {
  if (path.isAbsolute(includePath)) return includePath
  return path.resolve(path.dirname(currentFile), includePath)
}

function parsePayee(rest: string): string {
  const quoted = Array.from(rest.matchAll(/"([^"]*)"/g)).map(match => match[1])
  if (quoted.length === 0) return ''
  return quoted[0]
}

function scanPostings(file: string, lines: string[], snapshot: LedgerSnapshot): void {
  let current: { date: string; payee: string; sourceId: string | null } | null = null

  lines.forEach((line, index) => {
    if (isComment(line)) return

    const transactionMatch = line.match(TRANSACTION_RE)
    if (transactionMatch) {
      current = {
        date: transactionMatch[1],
        payee: parsePayee(transactionMatch[2]),
        sourceId: null,
      }
      return
    }

    if (/^\d{4}-\d{2}-\d{2}\s+/.test(line)) {
      current = null
      return
    }

    if (!current) return

    const sourceIdMatch = line.match(SOURCE_ID_RE)
    if (sourceIdMatch) {
      current.sourceId = sourceIdMatch[1]
      return
    }

    const postingMatch = line.match(POSTING_RE)
    if (!postingMatch) return
    const account = postingMatch[1]
    if (!account.startsWith('Assets:') && !account.startsWith('Liabilities:')) return

    snapshot.postings.push({
      date: current.date,
      payee: current.payee,
      account,
      amount: postingMatch[2],
      currency: postingMatch[3],
      file,
      line: index + 1,
      sourceId: current.sourceId,
    })
  })
}

function scanBalances(file: string, lines: string[], snapshot: LedgerSnapshot): void {
  let currentBalanceIndex: number | null = null

  lines.forEach((line, index) => {
    if (isComment(line)) return

    const balanceMatch = line.match(BALANCE_RE)
    if (balanceMatch) {
      currentBalanceIndex = snapshot.balances.length
      snapshot.balances.push({
        date: balanceMatch[1],
        account: balanceMatch[2],
        amount: balanceMatch[3].replace(/,/g, ''),
        currency: balanceMatch[4],
        file,
        line: index + 1,
        sourceId: null,
      })
      return
    }

    if (currentBalanceIndex === null) return
    if (!/^\s+/.test(line)) {
      currentBalanceIndex = null
      return
    }

    const sourceIdMatch = line.match(SOURCE_ID_RE)
    if (sourceIdMatch) {
      snapshot.balances[currentBalanceIndex].sourceId = sourceIdMatch[1]
    }
  })
}

function scanFile(
  file: string,
  snapshot: LedgerSnapshot,
  visited: Set<string>,
): void {
  const resolved = path.resolve(file)
  if (visited.has(resolved)) return
  if (!fs.existsSync(resolved)) {
    throw new Error(`Beancount file not found: ${resolved}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`Beancount path is not a file: ${resolved}`)
  }
  visited.add(resolved)
  snapshot.files.push(resolved)

  const text = fs.readFileSync(resolved, 'utf8')
  const lines = text.split(/\r?\n/)
  scanPostings(resolved, lines, snapshot)
  scanBalances(resolved, lines, snapshot)

  lines.forEach((line, index) => {
    if (isComment(line)) return
    const lineNumber = index + 1

    const includeMatch = line.match(INCLUDE_RE)
    if (includeMatch) {
      scanFile(resolveInclude(resolved, includeMatch[1]), snapshot, visited)
      return
    }

    const openMatch = line.match(OPEN_RE)
    if (openMatch) {
      snapshot.accounts.set(openMatch[2], {
        account: openMatch[2],
        openDate: openMatch[1],
        closeDate: snapshot.accounts.get(openMatch[2])?.closeDate ?? null,
        file: resolved,
        line: lineNumber,
      })
      return
    }

    const closeMatch = line.match(CLOSE_RE)
    if (closeMatch) {
      const existing = snapshot.accounts.get(closeMatch[2])
      if (existing) {
        existing.closeDate = closeMatch[1]
      } else {
        snapshot.accounts.set(closeMatch[2], {
          account: closeMatch[2],
          openDate: '0000-00-00',
          closeDate: closeMatch[1],
          file: resolved,
          line: lineNumber,
        })
      }
      return
    }

    const sourceIdMatch = line.match(SOURCE_ID_RE)
    if (sourceIdMatch && !snapshot.sourceIds.has(sourceIdMatch[1])) {
      snapshot.sourceIds.set(sourceIdMatch[1], {
        sourceId: sourceIdMatch[1],
        file: resolved,
        line: lineNumber,
      })
    }
  })
}

export function loadLedgerSnapshot(root = defaultBeancountRoot()): LedgerSnapshot {
  const mainFile = path.join(root, 'main.bean')
  const snapshot: LedgerSnapshot = {
    root,
    mainFile,
    files: [],
    accounts: new Map(),
    sourceIds: new Map(),
    postings: [],
    balances: [],
  }
  scanFile(mainFile, snapshot, new Set())
  return snapshot
}

export function ledgerRevision(root: string, files: string[]): string {
  const digest = crypto.createHash('sha256')
  for (const file of [...files].sort()) {
    const stat = fs.statSync(file)
    digest.update(path.relative(root, file))
    digest.update(':')
    digest.update(String(stat.size))
    digest.update(':')
    digest.update(String(Math.trunc(stat.mtimeMs)))
    digest.update('\n')
  }
  return digest.digest('hex').slice(0, 16)
}

export function accountRoot(account: string): string {
  return account.split(':', 1)[0]
}

export function accountStatusOn(state: LedgerAccountState, date: string): BeancountAccountStatus {
  if (state.openDate > date) return 'not_yet_open'
  if (state.closeDate && state.closeDate <= date) return 'closed'
  return 'open'
}

export function listLedgerAccounts(
  snapshot: LedgerSnapshot,
  date = new Date().toISOString().slice(0, 10),
): BeancountAccountView[] {
  return Array.from(snapshot.accounts.values())
    .map(state => ({
      account: state.account,
      root: accountRoot(state.account),
      status: accountStatusOn(state, date),
      openDate: state.openDate,
      closeDate: state.closeDate,
      file: state.file,
      line: state.line,
    }))
    .sort((a, b) => a.account.localeCompare(b.account))
}

export function accountStateOn(
  snapshot: LedgerSnapshot,
  account: string | null | undefined,
  date: string,
): { ok: true; state: LedgerAccountState } | { ok: false; reason: 'missing' | 'not_yet_open' | 'closed'; state?: LedgerAccountState } {
  if (!account) return { ok: false, reason: 'missing' }
  const state = snapshot.accounts.get(account)
  if (!state) return { ok: false, reason: 'missing' }
  if (state.openDate > date) return { ok: false, reason: 'not_yet_open', state }
  if (state.closeDate && state.closeDate <= date) return { ok: false, reason: 'closed', state }
  return { ok: true, state }
}
