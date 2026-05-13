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

async function recordNetWorthSnapshot(): Promise<void> {
  const allAccounts = db.select().from(accounts).all()
  let assets = 0
  let liabilities = 0

  for (const acct of allAccounts) {
    const bal = parseFloat(acct.balance)
    if (isNaN(bal)) continue
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

  // Find earliest transaction we have
  const allTxns = sqlite.prepare(
    'SELECT account_id, amount, posted FROM transactions WHERE posted > 0 ORDER BY posted ASC'
  ).all() as { account_id: string; amount: string; posted: number }[]

  if (allTxns.length === 0) return

  const earliest = allTxns[0].posted
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)

  // For each day from earliest to yesterday, calculate net worth
  for (let dayStart = earliest; dayStart < todayStart; dayStart += 86400) {
    const dayEnd = dayStart + 86400

    // Check if we already have a snapshot for this day
    const existing = sqlite.prepare(
      'SELECT id FROM net_worth_snapshots WHERE snapshot_at >= ? AND snapshot_at < ?'
    ).get(dayStart, dayEnd)
    if (existing) continue

    let assets = 0
    let liabilities = 0

    for (const acct of allAccounts) {
      const currentBal = parseFloat(acct.balance)
      if (isNaN(currentBal)) continue

      // Sum transactions that occurred AFTER this day (to subtract from current balance)
      const laterTxns = allTxns.filter(t => t.account_id === acct.id && t.posted >= dayEnd)
      const laterSum = laterTxns.reduce((s, t) => s + parseFloat(t.amount), 0)
      const balAtDay = currentBal - laterSum

      if (isLiabilityAccount(acct)) {
        liabilities += Math.abs(balAtDay)
      } else {
        assets += Math.max(0, balAtDay)
      }
    }

    sqlite.prepare(
      'INSERT INTO net_worth_snapshots (snapshot_at, assets, liabilities, net_worth) VALUES (?, ?, ?, ?)'
    ).run(dayStart + 43200, assets.toFixed(2), liabilities.toFixed(2), (assets - liabilities).toFixed(2))
  }
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

  for (const acct of data.accounts ?? []) {
    const existing = sqlite.prepare(`
      SELECT org_name AS orgName, org_domain AS orgDomain,
             account_type_override AS accountTypeOverride,
             beancount_account AS beancountAccount
      FROM accounts
      WHERE id = ?
    `).get(acct.id) as ExistingAccountSettings | undefined
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

    const newIds: string[] = []

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
    // have settled or been cancelled — mark them cancelled either way
    cancelDisappearedStmt.run(acct.id, startDate, JSON.stringify(currentPendingIds))

    if (newIds.length > 0) {
      await classifyNewTransactions(newIds)
    }
  }

  // Global stale-pending cleanup
  cancelStaleStmt.run(pendingStaleCutoff)
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
