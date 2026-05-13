'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Account } from '@/lib/db/schema'
import {
  ACCOUNT_TYPES,
  accountInstitution,
  accountTypeLabel,
  effectiveAccountType,
  isLiabilityAccount,
} from '@/lib/accounts'

type EditableAccount = Account

type BeancountAccountStatus = 'open' | 'closed' | 'not_yet_open'

interface BeancountAccountView {
  account: string
  root: string
  status: BeancountAccountStatus
  openDate: string
  closeDate: string | null
}

interface BeancountAccountsResponse {
  ledgerRevision: string
  accounts: BeancountAccountView[]
  summary: {
    total: number
    open: number
    closed: number
    notYetOpen: number
  }
  error?: string
}

interface Props {
  accounts: EditableAccount[]
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function preferredBeancountRoot(account: EditableAccount): 'Assets' | 'Liabilities' {
  return isLiabilityAccount(account) ? 'Liabilities' : 'Assets'
}

function optionListId(id: string): string {
  return `beancount-options-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

function statusText(account: BeancountAccountView): string {
  if (account.status === 'open') return `open since ${account.openDate}`
  if (account.status === 'not_yet_open') return `opens ${account.openDate}`
  return account.closeDate ? `closed ${account.closeDate}` : 'closed'
}

export default function AccountMappingTable({ accounts }: Props) {
  const [rows, setRows] = useState<EditableAccount[]>(accounts)
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  const [ledgerAccounts, setLedgerAccounts] = useState<BeancountAccountView[]>([])
  const [ledgerStatus, setLedgerStatus] = useState<{
    loading: boolean
    error: string | null
    revision: string | null
    openCount: number
  }>({
    loading: true,
    error: null,
    revision: null,
    openCount: 0,
  })

  useEffect(() => {
    let cancelled = false

    async function loadLedgerAccounts() {
      try {
        const res = await fetch('/api/beancount/accounts?status=all')
        const data = (await res.json().catch(() => ({}))) as Partial<BeancountAccountsResponse>
        if (cancelled) return

        if (!res.ok || !Array.isArray(data.accounts)) {
          setLedgerStatus({
            loading: false,
            error: data.error ?? 'Unable to read Beancount accounts',
            revision: null,
            openCount: 0,
          })
          return
        }

        setLedgerAccounts(data.accounts)
        setLedgerStatus({
          loading: false,
          error: null,
          revision: data.ledgerRevision ?? null,
          openCount: data.summary?.open ?? data.accounts.filter(account => account.status === 'open').length,
        })
      } catch {
        if (!cancelled) {
          setLedgerStatus({
            loading: false,
            error: 'Unable to read Beancount accounts',
            revision: null,
            openCount: 0,
          })
        }
      }
    }

    loadLedgerAccounts()
    return () => {
      cancelled = true
    }
  }, [])

  const ledgerAccountByName = useMemo(() => {
    return new Map(ledgerAccounts.map(account => [account.account, account]))
  }, [ledgerAccounts])

  const openLedgerAccounts = useMemo(() => {
    return ledgerAccounts.filter(account => account.status === 'open')
  }, [ledgerAccounts])

  function updateRow(id: string, patch: Partial<EditableAccount>) {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)))
    setSaveState(prev => ({ ...prev, [id]: 'idle' }))
  }

  async function saveRow(account: EditableAccount) {
    setSaveState(prev => ({ ...prev, [account.id]: 'saving' }))
    const res = await fetch(`/api/accounts/${encodeURIComponent(account.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgName: account.orgName || null,
        accountTypeOverride: account.accountTypeOverride || null,
        beancountAccount: account.beancountAccount || null,
      }),
    })

    if (!res.ok) {
      setSaveState(prev => ({ ...prev, [account.id]: 'error' }))
      return
    }

    const updated = (await res.json()) as EditableAccount
    setRows(prev => prev.map(row => (row.id === updated.id ? updated : row)))
    setSaveState(prev => ({ ...prev, [account.id]: 'saved' }))
  }

  if (rows.length === 0) return null

  function optionsFor(account: EditableAccount): BeancountAccountView[] {
    const root = preferredBeancountRoot(account)
    const preferred = openLedgerAccounts.filter(candidate => candidate.root === root)
    return preferred.length > 0 ? preferred : openLedgerAccounts
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800">
      <div className="grid min-w-[900px] grid-cols-[minmax(180px,1.4fr)_minmax(130px,0.8fr)_minmax(130px,0.7fr)_minmax(280px,1.2fr)_90px] gap-3 px-4 py-2 text-xs text-slate-500 border-b border-slate-700">
        <span>Account</span>
        <span>Institution</span>
        <span>Type</span>
        <span>
          Beancount Account
          {ledgerStatus.loading && <span className="ml-2 text-slate-600">loading</span>}
          {!ledgerStatus.loading && !ledgerStatus.error && (
            <span className="ml-2 text-slate-600">
              {ledgerStatus.openCount} open{ledgerStatus.revision ? ` · ${ledgerStatus.revision}` : ''}
            </span>
          )}
          {ledgerStatus.error && <span className="ml-2 text-amber-400">{ledgerStatus.error}</span>}
        </span>
        <span className="text-right">Save</span>
      </div>

      {rows.map(account => {
        const state = saveState[account.id] ?? 'idle'
        const selectedLedgerAccount = account.beancountAccount
          ? ledgerAccountByName.get(account.beancountAccount)
          : null
        const missingLedgerAccount = Boolean(
          account.beancountAccount
          && !ledgerStatus.loading
          && !ledgerStatus.error
          && !selectedLedgerAccount,
        )
        const unavailableLedgerAccount = selectedLedgerAccount && selectedLedgerAccount.status !== 'open'
        const listId = optionListId(account.id)
        const beancountOptions = optionsFor(account)

        return (
          <div
            key={account.id}
            className="grid min-w-[900px] grid-cols-[minmax(180px,1.4fr)_minmax(130px,0.8fr)_minmax(130px,0.7fr)_minmax(280px,1.2fr)_90px] gap-3 px-4 py-3 text-sm border-b border-slate-700 last:border-b-0 items-center"
          >
            <div className="min-w-0">
              <p className="truncate text-slate-200">{account.name}</p>
              <p className="truncate text-xs text-slate-500">{account.id}</p>
            </div>

            <input
              value={account.orgName ?? ''}
              onChange={e => updateRow(account.id, { orgName: e.target.value })}
              placeholder={accountInstitution(account)}
              className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100 placeholder-slate-600"
            />

            <select
              value={account.accountTypeOverride ?? ''}
              onChange={e => updateRow(account.id, { accountTypeOverride: e.target.value || null })}
              className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100"
            >
              <option value="">Auto: {accountTypeLabel(effectiveAccountType(account))}</option>
              {ACCOUNT_TYPES.map(type => (
                <option key={type} value={type}>{accountTypeLabel(type)}</option>
              ))}
            </select>

            <div className="min-w-0">
              <input
                list={listId}
                value={account.beancountAccount ?? ''}
                onChange={e => updateRow(account.id, { beancountAccount: e.target.value })}
                placeholder={`${preferredBeancountRoot(account)}:...`}
                className={`w-full min-w-0 rounded border bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 placeholder-slate-600 ${
                  missingLedgerAccount || unavailableLedgerAccount
                    ? 'border-amber-600'
                    : 'border-slate-600'
                }`}
              />
              <datalist id={listId}>
                {beancountOptions.map(candidate => (
                  <option key={candidate.account} value={candidate.account}>
                    {statusText(candidate)}
                  </option>
                ))}
              </datalist>
              {selectedLedgerAccount && (
                <p className={`mt-1 truncate text-[11px] ${
                  selectedLedgerAccount.status === 'open' ? 'text-slate-500' : 'text-amber-300'
                }`}>
                  {statusText(selectedLedgerAccount)}
                </p>
              )}
              {missingLedgerAccount && (
                <p className="mt-1 truncate text-[11px] text-amber-300">Not found in ledger</p>
              )}
            </div>

            <button
              onClick={() => saveRow(account)}
              disabled={state === 'saving'}
              className="rounded bg-blue-700 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : state === 'error' ? 'Failed' : 'Save'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
