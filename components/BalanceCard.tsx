import type { Account } from '@/lib/db/schema'
import {
  accountDisplayName,
  accountInstitution,
  accountLast4,
  accountTypeLabel,
  effectiveAccountType,
  isLiabilityAccount,
} from '@/lib/accounts'

interface Props {
  account: Account
}

function formatBalance(balance: string, currency: string): string {
  const num = parseFloat(balance)
  if (isNaN(num)) return balance
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(Math.abs(num))
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`
  return `${Math.floor(diff / 86400)} days ago`
}

export default function BalanceCard({ account }: Props) {
  const isCredit = isLiabilityAccount(account)
  const effectiveType = effectiveAccountType(account)
  const balance = parseFloat(account.balance)
  const last4 = accountLast4(account)
  const isZero = Math.abs(balance) < 0.005

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 hover:border-slate-500 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-slate-300 text-sm font-medium leading-snug truncate">
            {accountDisplayName(account)}
          </p>
          <p className="text-slate-500 text-[11px] mt-1">{accountInstitution(account)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-700 text-slate-400">
            {last4 ?? account.currency}
          </span>
          <span className="text-[11px] text-slate-500">{accountTypeLabel(effectiveType)}</span>
        </div>
      </div>

      <p className={`text-xl font-bold mt-2 tabular-nums ${
        isZero ? 'text-slate-300' : isCredit ? 'text-red-400' : 'text-emerald-400'
      }`}>
        {isCredit && balance !== 0 ? '-' : ''}{formatBalance(account.balance, account.currency)}
      </p>

      <p className="text-slate-500 text-xs mt-2">
        Updated {formatTimeAgo(account.balanceDate)}
      </p>
    </div>
  )
}
