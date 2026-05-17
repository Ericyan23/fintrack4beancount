'use client'

import { useState, useEffect } from 'react'

interface Settings {
  simplefin_access_url: string | null
  sync_hour: string | null
  gemini_api_key: string | null
  claude_api_key: string | null
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    simplefin_access_url: null,
    sync_hour: null,
    gemini_api_key: null,
    claude_api_key: null,
  })
  const [form, setForm] = useState({
    simplefin_access_url: '',
    sync_hour: '3',
    gemini_api_key: '',
    claude_api_key: '',
  })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Settings) => {
        setSettings(data)
        setForm(prev => ({
          ...prev,
          sync_hour: data.sync_hour ?? '3',
        }))
        setLoading(false)
      })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    setError(null)

    const payload: Record<string, string> = {}
    if (form.simplefin_access_url) payload.simplefin_access_url = form.simplefin_access_url
    payload.sync_hour = form.sync_hour
    if (form.gemini_api_key) payload.gemini_api_key = form.gemini_api_key
    if (form.claude_api_key) payload.claude_api_key = form.claude_api_key

    try {
      const saveRes = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!saveRes.ok) {
        const data = (await saveRes.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? '保存失败。请检查设置后重试')
        return
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      // Refresh settings display
      const res = await fetch('/api/settings')
      const data = (await res.json()) as Settings
      setSettings(data)
      setForm(prev => ({ ...prev, simplefin_access_url: '', gemini_api_key: '', claude_api_key: '' }))
    } catch {
      setError('保存失败。请检查服务状态后重试')
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-500">加载中...</div>

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-bold">设置</h1>
      {error && (
        <div className="bg-red-900/40 border border-red-800 text-red-200 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={save} className="space-y-5">
        {/* SimpleFIN */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
          <h2 className="text-sm font-medium text-slate-300">SimpleFIN 配置</h2>

          <div>
            <label className="text-xs text-slate-400 block mb-1">访问 URL</label>
            {settings.simplefin_access_url && (
              <p className="text-xs text-green-400 mb-1">
                ✓ 已配置
              </p>
            )}
              <input
                type="password"
                placeholder="粘贴 SimpleFIN 访问 URL"
              value={form.simplefin_access_url}
              onChange={e => setForm(prev => ({ ...prev, simplefin_access_url: e.target.value }))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              留空则保留现有配置
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">每日同步小时（0-23）</label>
            <input
              type="number"
              min={0}
              max={23}
              value={form.sync_hour}
              onChange={e => setForm(prev => ({ ...prev, sync_hour: e.target.value }))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            />
          </div>
        </div>

        {/* AI Classification */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-slate-300">AI Ledger 账户建议（可选）</h2>
            <p className="text-xs text-slate-500 mt-0.5">配置任意一个即可。优先使用 Gemini，Claude 作为备用。</p>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Gemini API Key
              <span className="ml-2 text-emerald-500">可用免费额度</span>
            </label>
            {settings.gemini_api_key && (
              <p className="text-xs text-green-400 mb-1">✓ 已配置</p>
            )}
              <input
                type="password"
                placeholder="Gemini API key"
              value={form.gemini_api_key}
              onChange={e => setForm(prev => ({ ...prev, gemini_api_key: e.target.value }))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Claude API Key（备用）</label>
            {settings.claude_api_key && (
              <p className="text-xs text-green-400 mb-1">✓ 已配置</p>
            )}
              <input
                type="password"
                placeholder="Claude API key"
              value={form.claude_api_key}
              onChange={e => setForm(prev => ({ ...prev, claude_api_key: e.target.value }))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </div>

          <p className="text-xs text-slate-500">两个都留空则跳过 AI Ledger 账户建议</p>
        </div>

        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-slate-300">数据导入 / 导出</h2>
            <p className="text-xs text-slate-500 mt-0.5">导出不包含 SimpleFIN URL 或 API keys</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a
              href="/api/export/transactions"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md text-center"
            >
              交易 CSV
            </a>
            <a
              href="/api/export/accounts"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md text-center"
            >
              账户 CSV
            </a>
            <a
              href="/api/export/networth"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md text-center"
            >
              净资产 CSV
            </a>
            <a
              href="/api/export/backup"
              className="px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-md text-center"
            >
              JSON 备份
            </a>
          </div>
          <a
            href="/import"
            className="block w-full px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded-md text-center"
          >
            导入 CSV
          </a>
        </div>

        <button
          type="submit"
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-md"
        >
          {saved ? '✓ 已保存' : '保存设置'}
        </button>
      </form>
    </div>
  )
}
