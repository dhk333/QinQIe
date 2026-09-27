/// <reference types="vite/client" />
import { useSyncExternalStore } from 'react'

export type Lang = 'zh-CN' | 'zh-TW' | 'en'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' }
]

const KEY = 'qingqie.lang'

function detect(): Lang {
  const nav = navigator.language.replace('-', '_')
  if (/zh_(TW|HK|MO)/.test(nav)) return 'zh-TW'
  if (/^en/i.test(nav)) return 'en'
  return 'zh-CN'
}

let lang: Lang = (() => {
  const saved = localStorage.getItem(KEY) as Lang | null
  return saved && LANGS.some((l) => l.id === saved) ? saved : detect()
})()

const subs = new Set<() => void>()

type Dict = Record<string, string>
function merge(mods: Record<string, unknown>): Dict {
  return Object.assign({}, ...Object.values(mods).map((m) => (m as { default: Dict }).default))
}
const enDict = merge(import.meta.glob('./locales/en/*.ts', { eager: true }) as Record<string, unknown>)
const twDict = merge(import.meta.glob('./locales/zh-TW/*.ts', { eager: true }) as Record<string, unknown>)

export function getLang(): Lang {
  return lang
}

export function setLang(l: Lang): void {
  lang = l
  localStorage.setItem(KEY, l)
  subs.forEach((f) => f())
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const s =
    (lang === 'en' ? enDict[text] : lang === 'zh-TW' ? twDict[text] : undefined) ?? text
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : s
}

/** 组件内使用：语言切换时自动重渲染 */
export function useT(): typeof t {
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    getLang
  )
  return t
}
