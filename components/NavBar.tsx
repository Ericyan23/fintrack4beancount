'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SyncButton from './SyncButton'

const tabs = [
  { href: '/', label: '首页', icon: '🏠' },
  { href: '/review', label: '审核', icon: '✓' },
  { href: '/transactions', label: '交易', icon: '💳' },
  { href: '/transfers', label: '转账', icon: '↔' },
  { href: '/reports', label: '报表', icon: '📊' },
  { href: '/beancount', label: '账本', icon: 'B' },
  { href: '/categories', label: '分类', icon: '🏷️' },
  { href: '/accounts', label: '账户', icon: '🏦' },
  { href: '/rules', label: '规则', icon: '📋' },
  { href: '/settings', label: '设置', icon: '⚙️' },
]

export default function NavBar() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop top nav */}
      <nav className="hidden md:flex items-center justify-between gap-4 bg-slate-800 border-b border-slate-700 px-6 py-3">
        <div className="flex min-w-0 items-center gap-5">
          <span className="shrink-0 font-bold text-xl text-blue-400">FinTrack</span>
          <div className="flex min-w-0 items-center gap-4 overflow-x-auto">
          {tabs.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 text-sm font-medium transition-colors ${
                pathname === tab.href
                  ? 'text-blue-400'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {tab.label}
            </Link>
          ))}
          </div>
        </div>
        <div className="shrink-0">
          <SyncButton />
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex overflow-x-auto border-t border-slate-700 bg-slate-800 pb-[env(safe-area-inset-bottom)]">
        {tabs.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex min-h-14 min-w-16 shrink-0 flex-col items-center justify-center px-2 py-2 text-xs font-medium transition-colors ${
              pathname === tab.href
                ? 'text-blue-400'
                : 'text-slate-400'
            }`}
          >
            <span className="text-lg">{tab.icon}</span>
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between bg-slate-800 border-b border-slate-700 px-4 py-3">
        <span className="font-bold text-lg text-blue-400">FinTrack</span>
        <SyncButton />
      </div>
    </>
  )
}
