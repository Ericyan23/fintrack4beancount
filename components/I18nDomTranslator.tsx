'use client'

import { useEffect } from 'react'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
  translateText,
} from '@/lib/i18n/catalog'

const translatedTextNodes = new WeakMap<Text, string>()
const originalTextNodes = new WeakMap<Text, string>()
const translatedAttributes = new WeakMap<Element, Map<string, string>>()

const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label']
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA'])

function readLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE

  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored) return normalizeLocale(stored)

  const cookieLocale = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${LOCALE_COOKIE_NAME}=`))
    ?.split('=')[1]

  return cookieLocale ? normalizeLocale(decodeURIComponent(cookieLocale)) : DEFAULT_LOCALE
}

function shouldSkipElement(element: Element | null): boolean {
  for (let current = element; current; current = current.parentElement) {
    if (SKIP_TAGS.has(current.tagName)) return true
    if (current.hasAttribute('data-no-i18n')) return true
  }
  return false
}

function applyTextNode(node: Text, locale: Locale): void {
  if (shouldSkipElement(node.parentElement)) return

  const current = node.nodeValue ?? ''
  if (!current.trim()) return

  if (locale === 'en') {
    const original = originalTextNodes.get(node)
    if (original !== undefined && current !== original) node.nodeValue = original
    return
  }

  const previousTranslated = translatedTextNodes.get(node)
  let source = originalTextNodes.get(node)

  if (source === undefined || (current !== source && current !== previousTranslated)) {
    source = current
    originalTextNodes.set(node, source)
  }

  const leading = source.match(/^\s*/)?.[0] ?? ''
  const trailing = source.match(/\s*$/)?.[0] ?? ''
  const body = source.trim()
  const translated = `${leading}${translateText(body, locale)}${trailing}`

  if (translated !== current) {
    node.nodeValue = translated
    translatedTextNodes.set(node, translated)
  }
}

function applyElementAttributes(element: Element, locale: Locale): void {
  if (shouldSkipElement(element)) return

  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attr)
    if (!current) continue

    if (locale === 'en') {
      const original = element.getAttribute(`data-i18n-original-${attr}`)
      if (original !== null && current !== original) element.setAttribute(attr, original)
      continue
    }

    const previousTranslated = translatedAttributes.get(element)?.get(attr)
    let source = element.getAttribute(`data-i18n-original-${attr}`)
    if (source === null || (current !== source && current !== previousTranslated)) {
      source = current
      element.setAttribute(`data-i18n-original-${attr}`, source)
    }

    const translated = translateText(source, locale)
    if (translated !== current) {
      element.setAttribute(attr, translated)
      const attrs = translatedAttributes.get(element) ?? new Map<string, string>()
      attrs.set(attr, translated)
      translatedAttributes.set(element, attrs)
    }
  }
}

function walk(root: Node, locale: Locale): void {
  if (root.nodeType === Node.TEXT_NODE) {
    applyTextNode(root as Text, locale)
    return
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return

  if (root.nodeType === Node.ELEMENT_NODE) {
    const element = root as Element
    applyElementAttributes(element, locale)
    if (shouldSkipElement(element)) return
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      applyTextNode(node as Text, locale)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      applyElementAttributes(node as Element, locale)
    }
    node = walker.nextNode()
  }
}

export default function I18nDomTranslator() {
  useEffect(() => {
    let locale = readLocale()

    function apply(localeToApply = locale) {
      locale = localeToApply
      document.documentElement.lang = localeToApply
      walk(document.body, localeToApply)
    }

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          applyTextNode(mutation.target as Text, locale)
        } else if (mutation.type === 'attributes') {
          applyElementAttributes(mutation.target as Element, locale)
        } else {
          mutation.addedNodes.forEach(node => walk(node, locale))
        }
      }
    })

    apply(locale)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
      characterData: true,
      childList: true,
      subtree: true,
    })

    function onLocaleChange(event: Event) {
      apply(normalizeLocale((event as CustomEvent<string>).detail))
    }

    window.addEventListener('fintrack:locale-change', onLocaleChange)
    return () => {
      observer.disconnect()
      window.removeEventListener('fintrack:locale-change', onLocaleChange)
    }
  }, [])

  return null
}
