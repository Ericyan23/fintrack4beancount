import { db, sqlite } from '@/lib/db'
import { accounts, netWorthSnapshots } from '@/lib/db/schema'
import { isLiabilityAccount } from '@/lib/accounts'

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

export async function recordNetWorthSnapshot(): Promise<void> {
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
    snapshotAt: Math.floor(Date.now() / 1000),
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
