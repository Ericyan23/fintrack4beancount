'use client'

import { useState, useEffect, useRef, useMemo, useId } from 'react'
import { categoryGroupName } from '@/lib/category-format'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  onBlur?: () => void
  searchable?: boolean
}

interface CategoryStat {
  name: string
  beancount_status?: 'open' | 'missing' | 'not_yet_open' | 'closed' | 'not_applicable' | 'unavailable'
}

interface BeancountAccountOption {
  account: string
  root: string
  status: 'open' | 'closed' | 'not_yet_open'
}

interface BeancountAccountsResponse {
  accounts?: BeancountAccountOption[]
}

const EXTERNAL_ACCOUNT_ROOTS = ['Assets', 'Liabilities'] as const

function categoryStatsByName(stats: CategoryStat[], externalAccounts: string[]): Record<string, CategoryStat> {
  const byName = Object.fromEntries(stats.map(stat => [stat.name, stat]))
  for (const account of externalAccounts) {
    byName[account] = { name: account, beancount_status: 'open' }
  }
  return byName
}

function optionGroupName(category: string): string {
  const parts = category.split(':')
  const root = parts[0]
  if (root === 'Assets' || root === 'Liabilities') {
    return parts[1] ? `${root}:${parts[1]}` : root
  }
  if (root === 'Expenses' || root === 'Income' || root === 'Equity') {
    return `${root}:${categoryGroupName(category)}`
  }
  return categoryGroupName(category)
}

function beancountStatusLabel(status: CategoryStat['beancount_status']): string {
  switch (status) {
    case 'open':
      return 'open'
    case 'missing':
      return 'missing'
    case 'not_yet_open':
      return 'not yet open'
    case 'closed':
      return 'closed'
    case 'unavailable':
      return 'unavailable'
    case 'not_applicable':
    default:
      return 'local'
  }
}

function beancountStatusClass(status: CategoryStat['beancount_status']): string {
  switch (status) {
    case 'open':
      return 'text-emerald-300'
    case 'missing':
      return 'text-red-300'
    case 'not_yet_open':
    case 'closed':
      return 'text-amber-300'
    case 'unavailable':
      return 'text-slate-400'
    case 'not_applicable':
    default:
      return 'text-slate-500'
  }
}

function CategorySelectInner({
  value, onChange, placeholder = '-- Select category --',
  className = '', autoFocus, onBlur, searchable = false,
}: Props) {
  const [categories, setCategories] = useState<string[]>([])
  const [externalAccounts, setExternalAccounts] = useState<string[]>([])
  const [categoryStats, setCategoryStats] = useState<Record<string, CategoryStat>>({})
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  useEffect(() => {
    let cancelled = false

    async function loadOptions() {
      const categoryResponse = await fetch('/api/categories')
      const categoryData = (await categoryResponse.json()) as { categories: string[]; stats?: CategoryStat[] }

      const accountSets = await Promise.all(EXTERNAL_ACCOUNT_ROOTS.map(async root => {
        try {
          const response = await fetch(`/api/beancount/accounts?status=open&root=${root}`)
          if (!response.ok) return [] as BeancountAccountOption[]
          const data = (await response.json()) as BeancountAccountsResponse
          return data.accounts ?? []
        } catch {
          return [] as BeancountAccountOption[]
        }
      }))

      if (cancelled) return

      const accountNames = Array.from(new Set(
        accountSets
          .flat()
          .filter(account => account.root === 'Assets' || account.root === 'Liabilities')
          .map(account => account.account),
      )).sort((a, b) => a.localeCompare(b))

      setCategories(categoryData.categories)
      setExternalAccounts(accountNames)
      setCategoryStats(categoryStatsByName(categoryData.stats ?? [], accountNames))
    }

    loadOptions().catch(() => {
      if (!cancelled) {
        setCategories([])
        setExternalAccounts([])
        setCategoryStats({})
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (!open) setQuery(value)
  }, [open, value])

  async function addCategory() {
    const trimmed = newName.trim()
    if (!trimmed) return
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    const data = (await res.json()) as { categories: string[]; stats?: CategoryStat[] }
    setCategories(data.categories)
    setCategoryStats(categoryStatsByName(data.stats ?? [], externalAccounts))
    onChange(trimmed)
    setNewName('')
    setAdding(false)
  }

  if (adding) {
    return (
      <div className="flex gap-1">
        <input
          ref={inputRef}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); addCategory() }
            if (e.key === 'Escape') setAdding(false)
          }}
          placeholder="Expenses:Food:Restaurants"
          className="flex-1 bg-slate-700 border border-blue-500 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-500 min-w-0"
        />
        <button onClick={addCategory} className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded">Add</button>
        <button onClick={() => setAdding(false)} className="px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded">✕</button>
      </div>
    )
  }

  function searchText(category: string): string {
    const aliases: string[] = []
    if (/Travel:Flight/i.test(category)) aliases.push('airline airfare plane')
    if (/Travel:Hotel/i.test(category)) aliases.push('lodging')
    if (/Fees:Government/i.test(category)) aliases.push('tax taxes irs government')
    if (/Home:Utilities/i.test(category)) aliases.push('utility electric gas water')
    if (/Transport:Gas/i.test(category)) aliases.push('fuel')
    if (category.startsWith('Assets:') || category.startsWith('Liabilities:')) {
      aliases.push('account external transfer wallet')
    }
    if (/paypal/i.test(category)) aliases.push('paypal')
    return `${category} ${categoryGroupName(category)} ${aliases.join(' ')}`.toLowerCase()
  }

  const optionNames = useMemo(() => {
    const names = new Set([...categories, ...externalAccounts])
    if (value) names.add(value)
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [categories, externalAccounts, value])

  const filteredCategories = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return optionNames
    return optionNames.filter(category => {
      const haystack = searchText(category)
      return terms.every(term => haystack.includes(term))
    })
  }, [optionNames, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, filteredCategories.length])

  useEffect(() => {
    if (!open) return
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, listboxId, open])

  const groups: Record<string, string[]> = {}
  for (const cat of searchable ? filteredCategories : optionNames) {
    const group = optionGroupName(cat)
    const prefix = group || 'Other'
    if (!groups[prefix]) groups[prefix] = []
    groups[prefix].push(cat)
  }

  if (searchable) {
    const activeCategory = filteredCategories[activeIndex]

    function selectCategory(category: string) {
      onChange(category)
      setQuery(category)
      setOpen(false)
    }

    return (
      <div
        className="relative w-full min-w-0"
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false)
            onBlur?.()
          }
        }}
      >
        <input
          ref={inputRef}
          value={open ? query : value}
          autoFocus={autoFocus}
          onFocus={event => {
            setOpen(true)
            setQuery(value)
            event.currentTarget.select()
          }}
          onChange={event => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActiveIndex(index => Math.min(index + 1, Math.max(filteredCategories.length - 1, 0)))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              setActiveIndex(index => Math.max(index - 1, 0))
              return
            }
            if (event.key === 'Home' && open) {
              event.preventDefault()
              setActiveIndex(0)
              return
            }
            if (event.key === 'End' && open) {
              event.preventDefault()
              setActiveIndex(Math.max(filteredCategories.length - 1, 0))
              return
            }
            if (event.key === 'Escape') {
              setOpen(false)
              setQuery(value)
              return
            }
            if (event.key === 'Enter' && activeCategory) {
              event.preventDefault()
              selectCategory(activeCategory)
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeCategory ? `${listboxId}-${activeIndex}` : undefined}
          className={`w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 placeholder-slate-500 ${className}`}
        />
        {open && (
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-80 overflow-auto rounded-md border border-slate-600 bg-slate-800 shadow-xl"
          >
            {filteredCategories.length === 0 ? (
              <div className="space-y-2 p-2">
                <p className="px-2 py-1 text-xs text-slate-500">No matching categories</p>
                <button
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    setNewName(query.trim())
                    setAdding(true)
                    setOpen(false)
                  }}
                  className="w-full rounded px-2 py-2.5 text-left text-xs text-blue-300 hover:bg-slate-700"
                >
                  + Create {query.trim() || 'category'}
                </button>
              </div>
            ) : (
              <>
                {Object.entries(groups).sort().map(([group, cats]) => (
                  <div key={group}>
                    <div className="sticky top-0 bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-500">
                      {group}
                    </div>
                    {cats.map(category => {
                      const optionIndex = filteredCategories.indexOf(category)
                      const isActive = optionIndex === activeIndex

                      return (
                        <button
                          key={category}
                          id={`${listboxId}-${optionIndex}`}
                          role="option"
                          aria-selected={category === value}
                          type="button"
                          onMouseDown={event => event.preventDefault()}
                          onMouseEnter={() => setActiveIndex(optionIndex)}
                          onClick={() => selectCategory(category)}
                          className={`w-full px-3 py-2.5 text-left text-sm ${
                            isActive ? 'bg-slate-700' : 'hover:bg-slate-700'
                          } ${category === value ? 'text-blue-300' : 'text-slate-200'}`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate">{category}</span>
                            <span className={`shrink-0 text-[11px] ${beancountStatusClass(categoryStats[category]?.beancount_status)}`}>
                              {beancountStatusLabel(categoryStats[category]?.beancount_status)}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
                <button
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    setNewName(query.trim())
                    setAdding(true)
                    setOpen(false)
                  }}
                  className="w-full border-t border-slate-700 px-3 py-2.5 text-left text-xs text-blue-300 hover:bg-slate-700"
                >
                  + Create category...
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <select
      value={value}
      autoFocus={autoFocus}
      onBlur={onBlur}
      onChange={e => {
        if (e.target.value === '__add__') setAdding(true)
        else onChange(e.target.value)
      }}
      className={`bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 ${className}`}
    >
      <option value="">{placeholder}</option>
      {Object.entries(groups).sort().map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </optgroup>
      ))}
      <option value="__add__">+ Create category...</option>
    </select>
  )
}

// Wrap client-only rendering to avoid SSR hydration mismatches.
export default function CategorySelect(props: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <select
        value={props.value}
        onChange={() => {}}
        className={`bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 ${props.className ?? ''}`}
      >
        <option value="">{props.placeholder ?? '-- Select category --'}</option>
      </select>
    )
  }

  return <CategorySelectInner {...props} />
}
