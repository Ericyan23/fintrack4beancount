'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type ImportField =
  | 'date'
  | 'amount'
  | 'description'
  | 'account'
  | 'category'
  | 'notes'
  | 'tags'
  | 'status'
  | 'externalId'

type ImportMapping = Partial<Record<ImportField, string>>

interface AccountInfo {
  id: string
  name: string
}

interface PreviewRow {
  rowNumber: number
  date: string
  amount: string
  description: string
  account: string
  category: string
  status: string
  error?: string
}

interface PreviewResult {
  columns: string[]
  mapping: ImportMapping
  rows: PreviewRow[]
  totalRows: number
  validRows: number
  errorRows: number
}

interface StageImportResult {
  importRunId: string
  totalRows: number
  rawInserted: number
  staged: number
  duplicates: number
  errors: Array<{ rowNumber: number; error: string }>
}

const FIELD_LABELS: Array<[ImportField, string, boolean]> = [
  ['date', 'Date', true],
  ['amount', 'Amount', true],
  ['description', 'Description', true],
  ['account', 'Account column', false],
  ['category', 'Category', false],
  ['notes', 'Notes', false],
  ['tags', 'Tags', false],
  ['status', 'Status', false],
  ['externalId', 'External ID', false],
]

export default function ImportPage() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('')
  const [defaultAccountId, setDefaultAccountId] = useState('')
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<StageImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/accounts')
      .then(res => res.json())
      .then((payload: { accounts?: AccountInfo[] }) => setAccounts(payload.accounts ?? []))
  }, [])

  async function runPreview(
    nextMapping = mapping,
    nextDefaultAccountId = defaultAccountId,
    clearResult = true,
  ) {
    if (!csv.trim()) return
    setLoading(true)
    setError(null)
    if (clearResult) setResult(null)
    try {
      const res = await fetch('/api/import/transactions/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, mapping: nextMapping, defaultAccountId: nextDefaultAccountId || undefined }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'Preview failed')
        return
      }
      const payload = (await res.json()) as PreviewResult
      setPreview(payload)
      setMapping(payload.mapping)
    } finally {
      setLoading(false)
    }
  }

  async function stageRows() {
    if (!csv.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/import/transactions/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, mapping, defaultAccountId: defaultAccountId || undefined }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'Staging failed')
        return
      }
      setResult((await res.json()) as StageImportResult)
      await runPreview(mapping, defaultAccountId, false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">CSV Import</h1>
        <Link href="/settings" className="text-sm text-slate-400 hover:text-slate-200">Back to settings</Link>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-800 text-red-200 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-2 rounded-md border border-emerald-800 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200 md:flex-row md:items-center md:justify-between">
          <span>
            Staged {result.staged}, archived {result.rawInserted} raw rows, skipped {result.duplicates} duplicates,
            {' '}{result.errors.length} errors. Import run {result.importRunId} is ready for review.
          </span>
          <Link
            href={`/import/runs/${encodeURIComponent(result.importRunId)}`}
            className="self-start rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 md:self-auto"
          >
            Review staged rows
          </Link>
        </div>
      )}

      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-3">
          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async e => {
                const file = e.target.files?.[0]
                if (!file) return
                setFilename(file.name)
                const text = await file.text()
                setCsv(text)
                setPreview(null)
                setResult(null)
                setMapping({})
              }}
              className="w-full text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400 block mb-1">Default account</span>
            <select
              value={defaultAccountId}
              onChange={e => {
                setDefaultAccountId(e.target.value)
                if (csv) runPreview(mapping, e.target.value)
              }}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Use CSV account column</option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 truncate">{filename || 'No file selected'}</p>
          <button
            onClick={() => runPreview()}
            disabled={!csv || loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-md"
          >
            {loading ? 'Processing...' : 'Preview'}
          </button>
        </div>
      </div>

      {preview && (
        <>
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-slate-400">Total rows</p>
                <p className="text-xl font-bold text-slate-100 mt-1">{preview.totalRows}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Stageable</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{preview.validRows}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Errors</p>
                <p className="text-xl font-bold text-red-400 mt-1">{preview.errorRows}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {FIELD_LABELS.map(([field, label, required]) => (
                <label key={field} className="block">
                  <span className="text-xs text-slate-400 block mb-1">
                    {label}{required ? ' *' : ''}
                  </span>
                  <select
                    value={mapping[field] ?? ''}
                    onChange={e => {
                      const next = { ...mapping, [field]: e.target.value || undefined }
                      setMapping(next)
                      runPreview(next)
                    }}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="">Do not map</option>
                    {preview.columns.map(column => (
                      <option key={`${field}-${column}`} value={column}>{column}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[70px_110px_100px_1fr_160px_120px] gap-3 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
              <span>Row</span>
              <span>Date</span>
              <span>Amount</span>
              <span>Description</span>
              <span>Account</span>
              <span>Status</span>
            </div>
            {preview.rows.map(row => (
              <div
                key={row.rowNumber}
                className={`grid grid-cols-[70px_110px_100px_1fr_160px_120px] gap-3 px-4 py-2 text-sm border-b border-slate-700 last:border-b-0 ${
                  row.error ? 'bg-red-950/30' : ''
                }`}
              >
                <span className="text-slate-500">{row.rowNumber}</span>
                <span className="text-slate-300">{row.date}</span>
                <span className="text-slate-100">{row.amount}</span>
                <span className="text-slate-300 truncate">{row.description}</span>
                <span className="text-slate-400 truncate">{row.account}</span>
                <span className={row.error ? 'text-red-300' : 'text-slate-400'}>
                  {row.error ?? row.status}
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={stageRows}
              disabled={loading || !mapping.date || !mapping.amount || !mapping.description}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm rounded-md"
            >
              {loading ? 'Staging...' : 'Stage import'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
