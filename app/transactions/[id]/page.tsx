'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Transaction } from '@/lib/db/schema'
import CategorySelect from '@/components/CategorySelect'

interface AccountInfo {
  id: string
  name: string
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [txn, setTxn] = useState<Transaction | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState('')
  const [notes, setNotes] = useState('')
  const router = useRouter()

  useEffect(() => {
    params.then(({ id }) => {
      fetch(`/api/transactions/${encodeURIComponent(id)}`)
        .then(res => res.json())
        .then(async (data: Transaction) => {
          setTxn(data)
          setCategory(data.category ?? '')
          setNotes(data.notes ?? '')
          const accountsRes = await fetch('/api/accounts')
          const accountsData = (await accountsRes.json()) as { accounts?: AccountInfo[] }
          setAccount(accountsData.accounts?.find(a => a.id === data.accountId) ?? null)
          setLoading(false)
        })
        .catch(() => setLoading(false))
    })
  }, [params])

  const save = useCallback(async () => {
    if (!txn) return
    setSaving(true)
    await fetch(`/api/transactions/${encodeURIComponent(txn.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: category || null,
        notes: notes || null,
      }),
    })
    setSaving(false)
    router.back()
  }, [txn, category, notes, router])

  if (loading) {
    return <div className="text-center py-12 text-slate-500">加载中...</div>
  }
  if (!txn) {
    return <div className="text-center py-12 text-slate-500">未找到交易</div>
  }

  const amount = parseFloat(txn.amount)
  const isPositive = amount > 0

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm text-slate-400 hover:text-slate-300"
      >
        ← 返回
      </button>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h1 className="text-lg font-semibold text-slate-100 break-words">{txn.description}</h1>
        <p
          className={`text-3xl font-bold mt-2 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {isPositive ? '+' : ''}
          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)}
        </p>
        <div className="mt-3 space-y-1 text-sm text-slate-400">
          <p>日期：{new Date(txn.posted * 1000).toLocaleDateString('zh-CN')}</p>
          {txn.transactedAt && (
            <p>交易时间：{new Date(txn.transactedAt * 1000).toLocaleDateString('zh-CN')}</p>
          )}
          <p>账户：{account?.name ?? txn.accountId}</p>
          {txn.status === 'pending' && <p className="text-amber-400">⚠ 待结算</p>}
          {txn.status === 'cancelled' && <p className="text-slate-500">✕ 已取消</p>}
          <p>来源：{txn.source}</p>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <h2 className="text-sm font-medium text-slate-300">编辑信息</h2>

        <div>
          <label className="text-xs text-slate-400 block mb-1">分类</label>
          {txn.suggestedCat && !txn.category && (
            <p className="text-xs text-blue-400 mb-1">AI建议: {txn.suggestedCat}</p>
          )}
          <CategorySelect
            value={category}
            onChange={setCategory}
            placeholder="-- 未分类 --"
            className="w-full py-2"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">备注</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="添加备注..."
            className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-md"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}
