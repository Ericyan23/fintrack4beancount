'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ newCount?: number; error?: string } | null>(null)
  const router = useRouter()

  async function handleSync() {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = (await res.json()) as { success: boolean; newCount?: number; error?: string }
      setResult(data)
      if (data.success) router.refresh()
    } catch {
      setResult({ error: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className={`text-xs ${result.error ? 'text-red-400' : 'text-green-400'}`}>
          {result.error ? `Error: ${result.error}` : `+${result.newCount} new`}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md transition-colors"
      >
        {loading ? (
          <>
            <span className="animate-spin">↻</span>
            同步中...
          </>
        ) : (
          <>
            ↻ 同步
          </>
        )}
      </button>
    </div>
  )
}
