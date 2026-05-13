import { db, getSetting, sqlite } from '@/lib/db'
import { accounts, transactions, syncLog, netWorthSnapshots } from '@/lib/db/schema'
import { classifyNewTransactions, reclassifyUnmatched } from '@/lib/classify/rules'
import { detectAccountType, isLiabilityAccount } from '@/lib/accounts'

interface SimpleFINTransaction {
  id: string
  posted: number
  'transacted-at'?: number
  amount: string
  description: string
  pending?: boolean
}

interface SimpleFINAccount {
  id: string
  name: string
  currency: string
  balance: string
  'balance-date': number
  org?: { domain?: string; name?: string }
  transactions?: SimpleFINTransaction[]
}

interface SimpleFINData {
  errors?: Array<{ code: string; message: string }>
  errlist?: Array<{ code: string; msg: string }>
  accounts?: SimpleFINAccount[]
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

const SIMPLEFIN_LOOKBACK_DAYS = 90
const PENDING_STALE_DAYS = 40

interface ExistingAccountSettings {
  orgName: string | null
  orgDomain: string | null
  accountTypeOverride: string | null
  beancountAccount: string | null
}

interface NetWorthHistoryTxn {
  accountId: string
  amount: string
  posted: number
}

interface NetWorthAccountHistory {
  currentBalance: number
  isLiability: boolean
  posted: number[]
  prefix: number[]
  total: number
}

function mapAccount(
  acct: SimpleFINAccount,
  connId: string,
  existing?: ExistingAccountSettings,
) {
  const orgName = existing?.orgName || acct.org?.name?.trim() || null
  const orgDomain = existing?.orgDomain || acct.org?.domain?.trim() || null
  const detectedType = detectAccountType(acct.name, orgName ?? '')
  const accountType = existing?.accountTypeOverride || detectedType

  return {
    id: acct.id,
    name: acct.name,
    currency: acct.currency ?? 'USD',
    balance: acct.balance,
    balanceDate: acct['balance-date'],
    connId,
    orgName,
    orgDomain,
    accountType,
    accountTypeOverride: existing?.accountTypeOverride ?? null,
    beancountAccount: existing?.beancountAccount ?? null,
    updatedAt: now(),
  }
}

function mapTransaction(accountId: string) {
  return (txn: SimpleFINTransaction) => {
    const pending = txn.pending ?? false
    const syncedAt = now()
    const pendingDisplayDate = txn['transacted-at'] && txn['transacted-at'] > 0
      ? txn['transacted-at']
      : syncedAt
    return {
      id: txn.id,
      accountId,
      source: 'simplefin' as const,
      posted: pending ? pendingDisplayDate : txn.posted,
      transactedAt: txn['transacted-at'] ?? null,
      amount: txn.amount,
      description: txn.description,
      pending,
      status: pending ? 'pending' : 'posted',
      category: null,
      suggestedCat: null,
      notes: null,
      tags: [] as string[],
      createdAt: syncedAt,
    }
  }
}

function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sumBeforePosted(history: NetWorthAccountHistory, cutoff: number): number {
  let low = 0
  let high = history.posted.length

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (history.posted[mid] < cutoff) low = mid + 1
    else high = mid
  }

  return history.prefix[low] ?? 0
}

async function recordNetWorthSnapshot(): Promise<void> {
  const allAccounts = db.select().from(accounts).all()
  let assets = 0
  let liabilities = 0

  for (const acct of allAccounts) {
    const bal = parseAmount(acct.balance)
    if (isLiabilityAccount(acct)) {
      liabilities += Math.abs(bal)
    } else {
      assets += bal
    }
  }

  db.insert(netWorthSnapshots).values({
    snapshotAt: now(),
    assets: assets.toFixed(2),
    liabilities: liabilities.toFixed(2),
    netWorth: (assets - liabilities).toFixed(2),
  }).run()
}

export async function backfillNetWorthHistory(): Promise<void> {
  const allAccounts = db.select().from(accounts).all()
  if (allAccounts.length === 0) return

  const earliestRow = sqlite.prepare(
    'SELECT MIN(posted) AS earliest FROM transactions WHERE posted > 0'
  ).get() as { earliest: number | null }
  if (!earliestRow.earliest) return

  const allTxns = sqlite.prepare(`
    SELECT account_id AS accountId, amount, posted
    FROM transactions
    WHERE posted > 0
    ORDER BY account_id, posted ASC
  `).all() as NetWorthHistoryTxn[]

  const histories = new Map<string, NetWorthAccountHistory>()
  for (const acct of allAccounts) {
    histories.set(acct.id, {
      currentBalance: parseAmount(acct.balance),
      isLiability: isLiabilityAccount(acct),
      posted: [],
      prefix: [0],
      total: 0,
    })
  }

  for (const txn of allTxns) {
    const history = histories.get(txn.accountId)
    if (!history) continue
    const amount = parseAmount(txn.amount)
    history.posted.push(txn.posted)
    history.total += amount
    history.prefix.push(history.total)
  }

  const existingSnapshots = sqlite.prepare(`
    SELECT snapshot_at AS snapshotAt
    FROM net_worth_snapshots
    ORDER BY snapshot_at ASC
  `).all() as Array<{ snapshotAt: number }>
  let existingSnapshotIndex = 0

  const insertSnapshot = sqlite.prepare(`
    INSERT INTO net_worth_snapshots (snapshot_at, assets, liabilities, net_worth)
    VALUES (?, ?, ?, ?)
  `)

  const earliest = earliestRow.earliest
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)

  sqlite.transaction(() => {
    // For each day from earliest to yesterday, calculate net worth
    for (let dayStart = earliest; dayStart < todayStart; dayStart += 86400) {
      const dayEnd = dayStart + 86400

      while (
        existingSnapshotIndex < existingSnapshots.length &&
        existingSnapshots[existingSnapshotIndex].snapshotAt < dayStart
      ) {
        existingSnapshotIndex++
      }

      if (
        existingSnapshotIndex < existingSnapshots.length &&
        existingSnapshots[existingSnapshotIndex].snapshotAt < dayEnd
      ) {
        continue
      }

      let assets = 0
      let liabilities = 0

      for (const history of histories.values()) {
        // Sum transactions that occurred after this day to subtract from the current balance.
        const laterSum = history.total - sumBeforePosted(history, dayEnd)
        const balAtDay = history.currentBalance - laterSum

        if (history.isLiability) {
          liabilities += Math.abs(balAtDay)
        } else {
          assets += Math.max(0, balAtDay)
        }
      }

      insertSnapshot.run(
        dayStart + 43200,
        assets.toFixed(2),
        liabilities.toFixed(2),
        (assets - liabilities).toFixed(2),
      )
    }
  })()
}

export async function syncSimpleFin(): Promise<{ newCount: number; error?: string }> {
  const accessUrl = getSetting('simplefin_access_url') ?? process.env.SIMPLEFIN_ACCESS_URL
  if (!accessUrl) return { newCount: 0, error: 'No SimpleFIN access URL configured' }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(accessUrl)
  } catch {
    return { newCount: 0, error: 'Invalid SimpleFIN access URL' }
  }

  const auth = Buffer.from(`${parsedUrl.username}:${parsedUrl.password}`).toString('base64')
  const base = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`
  const connId = parsedUrl.host

  const syncStartedAt = now()
  const startDate = syncStartedAt - SIMPLEFIN_LOOKBACK_DAYS * 86400
  const pendingStaleCutoff = syncStartedAt - PENDING_STALE_DAYS * 86400

  let data: SimpleFINData
  try {
    const res = await fetch(
      `${base}/accounts?version=2&start-date=${startDate}&pending=1`,
      { headers: { Authorization: `Basic ${auth}` } },
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }
    data = (await res.json()) as SimpleFINData
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logSync(0, message)
    return { newCount: 0, error: message }
  }

  for (const err of data.errlist ?? []) {
    console.error(`[simplefin] ${err.code}: ${err.msg}`)
  }

  let newCount = 0

  // Prepared once, reused per transaction
  const insertStmt = sqlite.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, source, posted, transacted_at, amount, description, pending, status,
       category, suggested_cat, notes, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Update mutable fields on existing records; preserves category/notes/tags set by the user
  const updateStmt = sqlite.prepare(`
    UPDATE transactions
    SET pending = ?, status = ?, posted = ?, amount = ?, description = ?
    WHERE id = ?
  `)

  // Cancel pending transactions within sync window no longer reported by SimpleFIN
  const cancelDisappearedStmt = sqlite.prepare(`
    UPDATE transactions
    SET pending = 0, status = 'cancelled'
    WHERE account_id = ? AND status = 'pending' AND created_at >= ?
      AND id NOT IN (SELECT value FROM json_each(?))
  `)

  // Auto-cancel stale pending older than 40 days (never resolved)
  const cancelStaleStmt = sqlite.prepare(`
    UPDATE transactions SET pending = 0, status = 'cancelled'
    WHERE status = 'pending' AND created_at < ?
  `)
  const existingAccountStmt = sqlite.prepare(`
    SELECT org_name AS orgName, org_domain AS orgDomain,
           account_type_override AS accountTypeOverride,
           beancount_account AS beancountAccount
    FROM accounts
    WHERE id = ?
  `)

  const newIds: string[] = []

  sqlite.transaction(() => {
    for (const acct of data.accounts ?? []) {
      const existing = existingAccountStmt.get(acct.id) as ExistingAccountSettings | undefined
      const mappedAccount = mapAccount(acct, connId, existing)

      db.insert(accounts)
        .values(mappedAccount)
        .onConflictDoUpdate({
          target: accounts.id,
          set: {
            balance: acct.balance,
            balanceDate: acct['balance-date'],
            orgName: mappedAccount.orgName,
            orgDomain: mappedAccount.orgDomain,
            accountType: mappedAccount.accountType,
            updatedAt: now(),
          },
        })
        .run()

      const rows = (acct.transactions ?? []).map(mapTransaction(acct.id))

      // IDs of transactions SimpleFIN currently reports as pending for this account
      const currentPendingIds = (acct.transactions ?? [])
        .filter(t => t.pending)
        .map(t => t.id)

      for (const row of rows) {
        const status = row.pending ? 'pending' : 'posted'
        const result = insertStmt.run(
          row.id, row.accountId, row.source, row.posted, row.transactedAt,
          row.amount, row.description, row.pending ? 1 : 0, status,
          null, null, null, JSON.stringify(row.tags), row.createdAt,
        )
        if (result.changes > 0) {
          newIds.push(row.id)
          newCount++
        } else {
          // Existing record: sync status, pending flag, amount, posted date, description
          // (category/notes/tags are intentionally left alone)
          updateStmt.run(row.pending ? 1 : 0, status, row.posted, row.amount, row.description, row.id)
        }
      }

      // Pending transactions within the sync window that SimpleFIN no longer returns
      // have settled or been cancelled, so mark them cancelled either way.
      cancelDisappearedStmt.run(acct.id, startDate, JSON.stringify(currentPendingIds))
    }

    // Global stale-pending cleanup
    cancelStaleStmt.run(pendingStaleCutoff)
  })()

  if (newIds.length > 0) {
    await classifyNewTransactions(newIds)
  }
  await reclassifyUnmatched()

  await recordNetWorthSnapshot()
  await backfillNetWorthHistory()
  await logSync(newCount)
  return { newCount }
}

async function logSync(newCount: number, error?: string): Promise<void> {
  db.insert(syncLog).values({
    syncedAt: now(),
    newCount,
    error: error ?? null,
  }).run()
}
