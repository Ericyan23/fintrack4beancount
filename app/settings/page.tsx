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
        setError(data.error ?? 'Save failed. Check your settings and try again')
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
      setError('Save failed. Check service status and try again')
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      {error && (
        <div className="bg-red-900/40 border border-red-800 text-red-200 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={save} className="space-y-5">
        {/* SimpleFIN */}
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
          <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-300">SimpleFIN configuration</h2>
          <a
            href="https://beta-bridge.simplefin.org/my-account"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Manage accounts →
          </a>
        </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Access URL</label>
            {settings.simplefin_access_url && (
              <p className="text-xs text-green-400 mb-1">
                ✓ Configured
              </p>
            )}
              <input
                type="password"
                placeholder="Paste your SimpleFIN access URL"
              value={form.simplefin_access_url}
              onChange={e => setForm(prev => ({ ...prev, simplefin_access_url: e.target.value }))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Leave blank to keep the existing configuration
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Daily sync hour (0-23)</label>
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
            <h2 className="text-sm font-medium text-slate-300">AI categorization (optional)</h2>
            <p className="text-xs text-slate-500 mt-0.5">Configure either one. Gemini is preferred and Claude is the fallback.</p>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Gemini API Key
              <span className="ml-2 text-emerald-500">Free tier available</span>
            </label>
            {settings.gemini_api_key && (
              <p className="text-xs text-green-400 mb-1">✓ Configured</p>
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
            <label className="text-xs text-slate-400 block mb-1">Claude API Key (fallback)</label>
            {settings.claude_api_key && (
              <p className="text-xs text-green-400 mb-1">✓ Configured</p>
            )}
              <input
                type="password"
                placeholder="Claude API key"
              value={form.claude_api_key}
              onChange={e => setForm(prev => ({ ...prev, claude_api_key: e.target.value }))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
            />
          </div>

          <p className="text-xs text-slate-500">Leave both blank to skip AI categorization</p>
        </div>

        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-slate-300">Data import / export</h2>
            <p className="text-xs text-slate-500 mt-0.5">Exports do not include the SimpleFIN URL or API keys</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <a
              href="/api/export/transactions"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md text-center"
            >
              Transactions CSV
            </a>
            <a
              href="/api/export/accounts"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md text-center"
            >
              Accounts CSV
            </a>
            <a
              href="/api/export/networth"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-md text-center"
            >
              Net worth CSV
            </a>
            <a
              href="/api/export/backup"
              className="px-3 py-2 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded-md text-center"
            >
              JSON backup
            </a>
          </div>
          <a
            href="/import"
            className="block w-full px-3 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded-md text-center"
          >
            Import CSV
          </a>
        </div>

        <button
          type="submit"
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-md"
        >
          {saved ? '✓ Saved' : 'Save settings'}
        </button>
      </form>
    </div>
  )
}
