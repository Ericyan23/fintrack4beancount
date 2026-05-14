'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Rule } from '@/lib/db/schema'
import CategorySelect from '@/components/CategorySelect'
import CategoryManager from '@/components/CategoryManager'

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
          setTestResult(`Matched rule #${rule.id} -> ${rule.category}`)
          return
        }
      } catch {
        // skip invalid
      }
    }
    setTestResult('No matching rule (no ledger account)')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold shrink-0">Ledger Account Rules</h1>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              onClick={applyRules}
              disabled={applying || rules.length === 0}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded-md whitespace-nowrap"
            >
              {applying ? 'Applying...' : '▶ Apply rules'}
            </button>
            <button
              onClick={runAIClassify}
              disabled={classifying}
              className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm rounded-md whitespace-nowrap"
            >
              {classifying ? 'AI analyzing...' : '✦ Batch AI suggestions'}
            </button>
          </div>
          {applyResult && (
            <span className="text-xs text-green-400 text-right">
              Rules: assigned {applyResult.applied}, {applyResult.remaining} remaining
            </span>
          )}
          {classifyProgress && (
            <div className="w-full max-w-xs space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>
                  AI analyzing {classifyProgress.current}/{classifyProgress.total}
                  {classifyProgress.grouped ? ' groups' : ''}
                </span>
                <span>Suggested {classifyProgress.suggested}</span>
              </div>
              {classifyProgress.grouped && classifyProgress.transactionTotal !== undefined && (
                <p className="text-[11px] text-slate-500 text-right">
                  Processing {classifyProgress.transactionTotal} grouped transactions
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
                : `AI: ✦ suggested ${classifyResult.suggested}, ${classifyResult.remaining} without ledger account remaining`}
            </span>
          )}
        </div>
      </div>

      {/* New rule form */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h2 className="text-sm font-medium text-slate-300 mb-4">New rule</h2>
        <form onSubmit={createRule} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Regex pattern</label>
              <input
                type="text"
                placeholder="e.g. WHOLE.*FOODS"
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                required
                className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Ledger account</label>
              <CategorySelect
                value={category}
                onChange={setCategory}
                className="w-full py-2"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Priority (higher runs first)</label>
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
            + New rule
          </button>
        </form>
      </div>

      {/* Rule tester */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <h2 className="text-sm font-medium text-slate-300 mb-3">Rule tester</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Enter a transaction description to test rules..."
            value={testInput}
            onChange={e => setTestInput(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
          />
          <button
            onClick={testRule}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-md"
          >
            Test
          </button>
        </div>
        {testResult && (
          <p className={`mt-2 text-sm ${testResult.includes('Matched') ? 'text-green-400' : 'text-amber-400'}`}>
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
          <span>Ledger account management ({catStats.length})</span>
          <span>{showCatManager ? '▲ Collapse' : '▼ Expand'}</span>
        </button>
        {showCatManager && <div className="mt-3"><CategoryManager initialStats={catStats} /></div>}
      </div>

      {/* Rules list */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 mb-3">Existing rules ({rules.length})</h2>
        {loading ? (
          <p className="text-slate-500 text-sm">Loading...</p>
        ) : rules.length === 0 ? (
          <div className="bg-slate-800 rounded-xl p-6 text-center text-slate-500 border border-slate-700">
            No rules yet. Create one to start automatic assignment.
          </div>
        ) : (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="hidden md:grid grid-cols-[60px_1fr_1fr_60px_80px] gap-4 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
              <span>Priority</span>
              <span>Pattern (regex)</span>
              <span>Ledger account</span>
              <span>ID</span>
              <span>Actions</span>
            </div>
            {rules.map((rule, i) => (
              <div
                key={rule.id}
                className={`flex flex-col md:grid md:grid-cols-[60px_1fr_1fr_60px_80px] gap-2 md:gap-4 px-4 py-3 ${
                  i > 0 ? 'border-t border-slate-700' : ''
                }`}
              >
                <span className="text-blue-400 font-mono text-sm">{rule.priority}</span>
                <code className="text-amber-300 text-sm font-mono break-all">{rule.pattern}</code>
                <span className="text-slate-300 text-sm">{rule.category}</span>
                <span className="text-slate-500 text-xs">#{rule.id}</span>
                <button
                  onClick={() => deleteRule(rule.id!)}
                  className="text-red-400 hover:text-red-300 text-xs"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
