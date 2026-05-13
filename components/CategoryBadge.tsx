'use client'

import { categoryColorKey } from '@/lib/category-format'

const CATEGORY_COLORS: Record<string, string> = {
  Food: 'bg-orange-900 text-orange-200',
  Transport: 'bg-blue-900 text-blue-200',
  Shopping: 'bg-purple-900 text-purple-200',
  Entertainment: 'bg-pink-900 text-pink-200',
  Health: 'bg-green-900 text-green-200',
  Home: 'bg-yellow-900 text-yellow-200',
  Income: 'bg-emerald-900 text-emerald-200',
  Equity: 'bg-teal-900 text-teal-200',
  Travel: 'bg-indigo-900 text-indigo-200',
  Transfer: 'bg-cyan-900 text-cyan-200',
  'Other': 'bg-slate-700 text-slate-300',
}

function getCategoryColor(category: string | null): string {
  if (!category) return 'bg-red-900 text-red-300'
  return CATEGORY_COLORS[categoryColorKey(category)] ?? CATEGORY_COLORS['Other']
}

interface Props {
  category: string | null
  suggested?: string | null
  onClick?: () => void
  className?: string
}

export default function CategoryBadge({ category, suggested, onClick, className = '' }: Props) {
  const colorClass = getCategoryColor(category)
  const label = category ?? (suggested ? `${suggested} ?` : '未分类')

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-opacity hover:opacity-80 ${colorClass} ${
        !category ? 'border border-red-500' : ''
      } ${className}`}
      title={suggested && !category ? `AI建议: ${suggested}` : undefined}
    >
      {!category && <span className="mr-1">⚠</span>}
      {label}
    </button>
  )
}
