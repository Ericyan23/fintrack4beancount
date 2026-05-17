'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Rule } from '@/lib/db/schema'
import CategorySelect from '@/components/CategorySelect'
import CategoryManager from '@/components/CategoryManager'

const REVIEW_LEDGER_ACCOUNTS = new Set(['Expenses:Review', 'Income:Review', 'Equity:Review'])

interface CategoryStat {
  name: string
  is_default: number
  usage_count: number
  transactions: number
  suggestions: number
  rules: number
  is_required: number
  is_virtual: number
  beancount_status: 'open' | 'missing' | 'not_yet_open' | 'closed' | 'not_applicable' | 'unavailable'
  beancount_open_date: string | null
  beancount_close_date: string | null
  beancount_error: string | null
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [pattern, setPattern] = useState('')
  const [category, setCategory] = useState('')
  const [priority, setPriority] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ applied: number; remaining: number } | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [classifyProgress, setClassifyProgress] = useState<{
    current: number
    total: number
    suggested: number
    transactionTotal?: number
    grouped?: boolean
  } | null>(null)
  const [classifyResult, setClassifyResult] = useState<{ suggested: number; remaining: number; error?: string; info?: string } | null>(null)
  const [catStats, setCatStats] = useState<CategoryStat[]>([])
  const [showCatManager, setShowCatManager] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [editPattern, setEditPattern] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editPriority, setEditPriority] = useState(0)


  const loadRules = useCallback(async () => {
    const res = await fetch('/api/rules')
    const data = (await res.json()) as { rules: Rule[] }
    setRules(data.rules)
    setLoading(false)
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then((d: { stats: CategoryStat[] }) => setCatStats(d.stats ?? []))
  }, [])

  async function createRule(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, category, priority }),
    })
    const data = (await res.json()) as { rules?: Rule[]; error?: string }
    if (data.error) {
      setError(data.error)
    } else {
      setRules(data.rules ?? [])
      setPattern('')
      setCategory('')
      setPriority(0)
    }
  }

  function startEdit(rule: Rule) {
    if (!rule.id) return
    setEditingRuleId(rule.id)
    setEditPattern(rule.pattern)
    setEditCategory(rule.category)
    setEditPriority(rule.priority)
    setError(null)
  }

  function cancelEdit() {
    setEditingRuleId(null)
    setEditPattern('')
    setEditCategory('')
    setEditPriority(0)
  }

  async function saveRule(id: number) {
    setError(null)
    const res = await fetch('/api/rules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        pattern: editPattern,
        category: editCategory,
        priority: editPriority,
      }),
    })
    const data = (await res.json()) as { rules?: Rule[]; error?: string }
    if (data.error) {
      setError(data.error)
      return
    }
    setRules(data.rules ?? [])
    cancelEdit()
  }

  async function deleteRule(id: number) {
    await fetch(`/api/rules?id=${id}`, { method: 'DELETE' })
    await loadRules()
  }

  async function applyRules() {
    setApplying(true)
    setApplyResult(null)
    const res = await fetch('/api/rules/apply', { method: 'POST' })
    const data = (await res.json()) as { applied: number; remaining: number }
    setApplyResult(data)
    setApplying(false)
  }

  async function runAIClassify() {
    setClassifying(true)
    setClassifyResult(null)
    setClassifyProgress(null)

    const res = await fetch('/api/classify', { method: 'POST' })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const msg = JSON.parse(line.slice(6)) as {
            type: string; current?: number; total?: number; suggested?: number
            remaining?: number; error?: string; info?: string; transactionTotal?: number; grouped?: boolean
          }
          if (msg.type === 'start') {
            setClassifyProgress({
              current: 0,
              total: msg.total!,
              suggested: 0,
              transactionTotal: msg.transactionTotal,
              grouped: msg.grouped,
            })
          } else if (msg.type === 'progress') {
            setClassifyProgress({
              current: msg.current!,
              total: msg.total!,
              suggested: msg.suggested!,
              transactionTotal: msg.transactionTotal,
              grouped: msg.grouped,
            })
          } else if (msg.type === 'done') {
            setClassifyResult({ suggested: msg.suggested!, remaining: msg.remaining!, info: msg.info })
            setClassifyProgress(null)
          } else if (msg.type === 'error') {
            setClassifyResult({ error: msg.error, suggested: msg.suggested ?? 0, remaining: 0 })
            setClassifyProgress(null)
          }
        }
      }
    } finally {
      setClassifying(false)
    }
  }

  function testRule() {
    if (!testInput || rules.length === 0) return
    for (const rule of [...rules].sort((a, b) => b.priority - a.priority)) {
      try {
        if (new RegExp(rule.pattern, 'i').test(testInput)) {
          setTestResult(`匹配规则 #${rule.id} -> ${rule.category}`)
          return
        }
      } catch {
        // skip invalid
      }
    }
    setTestResult('没有匹配规则（没有 Ledger 账户）')
  }

  function reviewStatusLabel(categoryName: string): string {
    return REVIEW_LEDGER_ACCOUNTS.has(categoryName) ? '需审核' : '自动已审核'
  }

  function reviewStatusClass(categoryName: string): string {
    return REVIEW_LEDGER_ACCOUNTS.has(categoryName)
      ? 'border-amber-900/70 bg-amber-950/40 text-amber-300'
      : 'border-emerald-900/70 bg-emerald-950/40 text-emerald-300'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold shrink-0">Ledger 账户规则</h1>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              onClick={applyRules}
              disabled={applying || rules.length === 0}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded-md whitespace-nowrap"
            >
              {applying ? '应用中...' : '▶ 应用规则'}
            </button>
            <button
              onClick={runAIClassify}
              disabled={classifying}
              className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm rounded-md whitespace-nowrap"
            >
              {classifying ? 'AI 分析中...' : '✦ 批量 AI 建议'}
            </button>
          </div>
          {applyResult && (
            <span className="text-xs text-green-400 text-right">
              规则：已分配 {applyResult.applied} 条，剩余 {applyResult.remaining} 条
            </span>
          )}
          {classifyProgress && (
            <div className="w-full max-w-xs space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>
                  AI 分析 {classifyProgress.current}/{classifyProgress.total}
                  {classifyProgress.grouped ? ' 个分组' : ''}
                </span>
                <span>已建议 {classifyProgress.suggested}</span>
              </div>
              {classifyProgress.grouped && classifyProgress.transactionTotal !== undefined && (
                <p className="text-[11px] text-slate-500 text-right">
                  正在处理 {classifyProgress.transactionTotal} 条分组交易
                </p>
              )}
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div
                  className="bg-violet-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(classifyProgress.current / classifyProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {classifyResult && !classifyProgress && (
            <span className={`text-xs text-right ${classifyResult.error ? 'text-red-400' : 'text-violet-400'}`}>
              {classifyResult.error
                ? `✕ ${classifyResult.error}`
                : classifyResult.info
                ? `ℹ ${classifyResult.info}`
                : `AI：✦ 已建议 ${classifyResult.suggested} 条，剩余 ${classifyResult.remaining} 条没有 Ledger 账户`}
            </span>
          )}
        </div>
      </div>

      {/* New rule form */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h2 className="text-sm font-medium text-slate-300 mb-4">新规则</h2>
        <form onSubmit={createRule} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">正则模式</label>
              <input
                type="text"
                placeholder="例如：WHOLE.*FOODS"
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                required
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Ledger 账户</label>
              <CategorySelect
                value={category}
                onChange={setCategory}
                className="w-full py-2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">优先级（越高越先执行）</label>
              <input
                type="number"
                value={priority}
                onChange={e => setPriority(parseInt(e.target.value, 10))}
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md"
          >
            + 新规则
          </button>
        </form>
      </div>

      {/* Rule tester */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h2 className="text-sm font-medium text-slate-300 mb-3">规则测试</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="输入交易描述来测试规则..."
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          />
          <button
            onClick={testRule}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-md"
          >
            测试
          </button>
        </div>
        {testResult && (
          <p className={`mt-2 text-sm ${testResult.includes('匹配') ? 'text-green-400' : 'text-amber-400'}`}>
            {testResult}
          </p>
        )}
      </div>

      {/* Ledger account manager */}
      <div>
        <button
          onClick={() => setShowCatManager(v => !v)}
          className="w-full flex items-center justify-between text-sm font-medium text-slate-400 hover:text-slate-200 py-1"
        >
          <span>Ledger 账户管理（{catStats.length}）</span>
          <span>{showCatManager ? '▲ 收起' : '▼ 展开'}</span>
        </button>
        {showCatManager && <div className="mt-3"><CategoryManager initialStats={catStats} /></div>}
      </div>

      {/* Rules list */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 mb-3">现有规则（{rules.length}）</h2>
        {loading ? (
          <p className="text-slate-500 text-sm">加载中...</p>
        ) : rules.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500 border border-slate-700">
            暂无规则。创建一个规则即可开始自动分配。
          </div>
        ) : (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="hidden md:grid grid-cols-[70px_1fr_1fr_120px_60px_120px] gap-4 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
              <span>优先级</span>
              <span>模式（正则）</span>
              <span>Ledger 账户</span>
              <span>结果</span>
              <span>ID</span>
              <span>操作</span>
            </div>
            {rules.map((rule, i) => (
              <div
                key={rule.id}
                className={`flex flex-col md:grid md:grid-cols-[70px_1fr_1fr_120px_60px_120px] gap-2 md:gap-4 px-4 py-3 ${
                  i > 0 ? 'border-t border-slate-700' : ''
                }`}
              >
                {editingRuleId === rule.id ? (
                  <>
                    <input
                      type="number"
                      value={editPriority}
                      onChange={e => setEditPriority(Number.isFinite(Number(e.target.value)) ? parseInt(e.target.value, 10) : 0)}
                      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                    />
                    <input
                      type="text"
                      value={editPattern}
                      onChange={e => setEditPattern(e.target.value)}
                      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                    />
                    <CategorySelect
                      value={editCategory}
                      onChange={setEditCategory}
                      className="w-full py-1 text-xs"
                    />
                    <span className={`w-fit rounded-full border px-2 py-0.5 text-[11px] ${reviewStatusClass(editCategory)}`}>
                      {reviewStatusLabel(editCategory)}
                    </span>
                    <span className="text-slate-500 text-xs">#{rule.id}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveRule(rule.id!)}
                        className="text-emerald-300 hover:text-emerald-200 text-xs"
                      >
                        保存
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-slate-400 hover:text-slate-300 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-blue-400 font-mono text-sm">{rule.priority}</span>
                    <code className="text-amber-300 text-sm font-mono break-all">{rule.pattern}</code>
                    <span className="text-slate-300 text-sm">{rule.category}</span>
                    <span className={`w-fit rounded-full border px-2 py-0.5 text-[11px] ${reviewStatusClass(rule.category)}`}>
                      {reviewStatusLabel(rule.category)}
                    </span>
                    <span className="text-slate-500 text-xs">#{rule.id}</span>
                    <div className="flex gap-3">
                      <button
                        onClick={() => startEdit(rule)}
                        className="text-blue-300 hover:text-blue-200 text-xs"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => deleteRule(rule.id!)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
