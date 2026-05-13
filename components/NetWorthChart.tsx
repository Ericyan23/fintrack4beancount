'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import type { NetWorthSnapshot } from '@/lib/db/schema'

interface Props {
  snapshots: NetWorthSnapshot[]
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`
  }
  return `$${value.toFixed(0)}`
}

export default function NetWorthChart({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        No net worth history yet. It appears after the first sync.
      </div>
    )
  }

  const data = snapshots.map(s => ({
    date: new Date(s.snapshotAt * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    netWorth: parseFloat(s.netWorth),
    assets: parseFloat(s.assets),
    liabilities: parseFloat(s.liabilities),
  }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#94a3b8', fontSize: 10 }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#94a3b8', fontSize: 10 }}
          tickFormatter={formatCurrency}
          width={48}
        />
        <Tooltip
          formatter={(value: number) => [
            new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value),
          ]}
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
          labelStyle={{ color: '#f8fafc' }}
        />
        <Line
          type="monotone"
          dataKey="netWorth"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          name="Net Worth"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
