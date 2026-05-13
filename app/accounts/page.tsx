export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { accounts, syncLog, type Account } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import AccountMappingTable from '@/components/AccountMappingTable'
import BalanceCard from '@/components/BalanceCard'
import { accountInstitution, isLiabilityAccount } from '@/lib/accounts'
import Link from 'next/link'

function formatTimeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function groupByInstitution(rows: Account[]): Array<[string, Account[]]> {
  const groups = new Map<string, Account[]>()
  for (const account of rows) {
    const institution = accountInstitution(account)
    groups.set(institution, [...(groups.get(institution) ?? []), account])
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'en-US'))
}

export default function AccountsPage() {
  const allAccounts = db.select().from(accounts).orderBy(accounts.name).all()
  const syncHistory = db
    .select()
    .from(syncLog)
    .orderBy(desc(syncLog.syncedAt))
    .limit(10)
    .all()

  const lastSync = syncHistory[0]

  const assets = allAccounts.filter(a => !isLiabilityAccount(a))
  const liabilities = allAccounts.filter(a => isLiabilityAccount(a))
  const assetGroups = groupByInstitution(assets)
  const liabilityGroups = groupByInstitution(liabilities)

  const totalAssets = assets.reduce((s, a) => s + parseFloat(a.balance), 0)
  const totalLiabilities = liabilities.reduce((s, a) => s + Math.abs(parseFloat(a.balance)), 0)

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Accounts</h1>
        {lastSync && (
          <span className="text-xs text-slate-400">
            Last sync: {formatTimeAgo(lastSync.syncedAt)}
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-950 border border-emerald-800 rounded-xl p-4">
          <p className="text-xs text-emerald-400">Total assets</p>
          <p className="text-2xl font-bold text-emerald-300 mt-1">{formatCurrency(totalAssets)}</p>
        </div>
        <div className="bg-red-950 border border-red-800 rounded-xl p-4">
          <p className="text-xs text-red-400">Total liabilities</p>
          <p className="text-2xl font-bold text-red-300 mt-1">{formatCurrency(totalLiabilities)}</p>
        </div>
      </div>

      {/* Assets section */}
      {assets.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-emerald-400 mb-3 flex items-center gap-2">
            <span>● Assets</span>
            <span className="text-slate-500">{formatCurrency(totalAssets)}</span>
          </h2>
          <div className="space-y-4">
            {assetGroups.map(([institution, group]) => (
              <div key={institution}>
                <h3 className="mb-2 text-xs font-medium text-slate-500">{institution}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map(acct => (
                    <Link key={acct.id} href={`/transactions?accountId=${encodeURIComponent(acct.id)}`}>
                      <BalanceCard account={acct} />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liabilities section */}
      {liabilities.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
            <span>● Liabilities</span>
            <span className="text-slate-500">{formatCurrency(totalLiabilities)}</span>
          </h2>
          <div className="space-y-4">
            {liabilityGroups.map(([institution, group]) => (
              <div key={institution}>
                <h3 className="mb-2 text-xs font-medium text-slate-500">{institution}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map(acct => (
                    <Link key={acct.id} href={`/transactions?accountId=${encodeURIComponent(acct.id)}`}>
                      <BalanceCard account={acct} />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {allAccounts.length === 0 && (
        <div className="bg-slate-800 rounded-xl p-8 text-center text-slate-500 border border-slate-700">
          No account data yet. Configure SimpleFIN and sync first.
        </div>
      )}

      {allAccounts.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-slate-400 mb-3">Account mapping</h2>
          <AccountMappingTable accounts={allAccounts} />
        </div>
      )}

      {/* Sync log */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 mb-3">Sync log</h2>
        {syncHistory.length === 0 ? (
          <p className="text-slate-500 text-sm">No sync records yet</p>
        ) : (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {syncHistory.map((log, i) => (
              <div
                key={log.id}
                className={`flex items-center justify-between px-4 py-2.5 text-sm ${
                  i > 0 ? 'border-t border-slate-700' : ''
                }`}
              >
                <span className="text-slate-400">{formatDateTime(log.syncedAt)}</span>
                {log.error ? (
                  <span className="text-red-400 text-xs">Error: {log.error}</span>
                ) : (
                  <span className="text-emerald-400">+{log.newCount} new transactions</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
