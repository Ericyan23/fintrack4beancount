'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
  translateText,
} from '@/lib/i18n/catalog'

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE

  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored) return normalizeLocale(stored)

  const cookieLocale = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.split('=')[1]
  if (cookieLocale) return normalizeLocale(decodeURIComponent(cookieLocale))

  return DEFAULT_LOCALE
}

function persistLocale(locale: Locale): void {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; max-age=31536000; samesite=lax`
  window.dispatchEvent(new CustomEvent('fintrack:locale-change', { detail: locale }))
}

export default function LanguageSwitcher() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    const next = readInitialLocale()
    setLocale(next)
    persistLocale(next)
  }, [])

  function changeLocale(next: Locale) {
    setLocale(next)
    persistLocale(next)
  }

  return (
    <div
      className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/70 p-1"
      aria-label={translateText('Language', locale)}
    >
      {([
        ['en', 'EN'],
        ['zh-CN', '中文'],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => changeLocale(value)}
          className={`min-w-10 rounded px-2 py-1 text-xs font-medium transition-colors ${
            locale === value
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
