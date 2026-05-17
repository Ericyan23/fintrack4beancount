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
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', {
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
        <div>
          <h1 className="text-xl font-bold">账户映射</h1>
          <p className="mt-1 text-sm text-slate-500">
            导出前将导入的机构账户映射到 Beancount 账户。
          </p>
        </div>
        {lastSync && (
          <span className="text-xs text-slate-400">
            上次同步：{formatTimeAgo(lastSync.syncedAt)}
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-950 border border-emerald-800 rounded-xl p-4">
          <p className="text-xs text-emerald-400">已导入资产</p>
          <p className="text-2xl font-bold text-emerald-300 mt-1">{formatCurrency(totalAssets)}</p>
        </div>
        <div className="bg-red-950 border border-red-800 rounded-xl p-4">
          <p className="text-xs text-red-400">已导入负债</p>
          <p className="text-2xl font-bold text-red-300 mt-1">{formatCurrency(totalLiabilities)}</p>
        </div>
      </div>

      {/* Assets section */}
      {assets.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-emerald-400 mb-3 flex items-center gap-2">
            <span>● 资产来源账户</span>
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
            <span>● 负债来源账户</span>
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
          还没有来源账户数据。请先配置 SimpleFIN 并同步，然后再做映射。
        </div>
      )}

      {allAccounts.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-slate-400 mb-3">Beancount 账户映射</h2>
          <AccountMappingTable accounts={allAccounts} />
        </div>
      )}

      {/* Sync log */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 mb-3">导入同步日志</h2>
        {syncHistory.length === 0 ? (
          <p className="text-slate-500 text-sm">暂无同步记录</p>
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
                  <span className="text-red-400 text-xs">错误：{log.error}</span>
                ) : (
                  <span className="text-emerald-400">+{log.newCount} 条新交易</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
