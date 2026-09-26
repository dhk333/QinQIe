export interface ThemeDef {
  id: string
  name: string
  desc: string
  dark: boolean
  /** 预览色：[背景, 面板, 主色] */
  preview: [string, string, string]
}

export const THEMES: ThemeDef[] = [
  { id: 'light', name: '晴空', desc: '默认亮色', dark: false, preview: ['#f3f5f9', '#ffffff', '#4c7bf3'] },
  { id: 'dark', name: '墨夜', desc: '默认暗色', dark: true, preview: ['#0a0a0b', '#121214', '#4c7bf3'] },
  { id: 'celadon', name: '青瓷', desc: '淡青绿 · 亮色', dark: false, preview: ['#f2f6f3', '#ffffff', '#2f9e6e'] },
  { id: 'sand', name: '暖沙', desc: '米棕护眼 · 亮色', dark: false, preview: ['#f6f2ea', '#fffdf8', '#c2703a'] },
  { id: 'plum', name: '绛紫', desc: '紫罗兰 · 暗色', dark: true, preview: ['#0d0a12', '#15111c', '#8b5cf6'] },
  { id: 'forest', name: '松墨', desc: '墨绿沉稳 · 暗色', dark: true, preview: ['#080d0b', '#101713', '#2fbf71'] }
]

export const CUSTOM_ID = 'custom'

export interface CustomTheme {
  name: string
  base: 'light' | 'dark'
  bg: string
  panel: string
  txt: string
  accent: string
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
export function isHex(s: string): boolean {
  return HEX_RE.test(s)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
/** a 向 b 混合 t（0~1） */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)
}
function alpha(c: string, a: number): string {
  const [r, g, b] = hexToRgb(c)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** 由 4 个基色推导整套 token，生成 body[data-theme='custom'] 覆盖块 */
export function customCss(t: CustomTheme): string {
  const d = t.base === 'dark'
  const p2 = d ? mix(t.panel, t.txt, 0.05) : mix(t.panel, t.bg, 0.5)
  const p3 = d ? mix(t.panel, t.txt, 0.1) : mix(t.panel, t.bg, 0.85)
  const line = d ? mix(t.panel, t.txt, 0.1) : mix(t.panel, t.txt, 0.08)
  const line2 = d ? mix(t.panel, t.txt, 0.2) : mix(t.panel, t.txt, 0.16)
  const txt2 = mix(t.txt, t.bg, d ? 0.45 : 0.42)
  const txt3 = mix(t.txt, t.bg, d ? 0.65 : 0.62)
  const tb1 = d ? mix(t.panel, t.bg, 0.35) : t.panel
  const tb2 = d ? t.bg : mix(t.panel, t.bg, 0.35)
  return `body[data-theme='${CUSTOM_ID}'] {
  --bg: ${t.bg}; --panel: ${t.panel}; --panel-2: ${p2}; --panel-3: ${p3};
  --line: ${line}; --line-2: ${line2};
  --txt: ${t.txt}; --txt-2: ${txt2}; --txt-3: ${txt3};
  --accent: ${t.accent}; --accent-2: ${mix(t.accent, '#ffffff', d ? 0.2 : 0.18)};
  --accent-dim: ${alpha(t.accent, d ? 0.16 : 0.12)};
  --accent-grad: linear-gradient(135deg, ${mix(t.accent, '#000000', 0.12)}, ${t.accent} 55%, ${mix(t.accent, '#ffffff', 0.15)});
  --accent-glow: ${alpha(t.accent, 0.35)};
  --titlebar-bg: linear-gradient(180deg, ${tb1}, ${tb2});
  --overlay: ${alpha(t.panel, 0.92)};
  --checker-1: ${mix(t.panel, t.txt, 0.08)}; --checker-2: ${mix(t.panel, t.txt, 0.03)};
}`
}

const STORE_KEY = 'qingqie.theme'
const CUSTOM_KEY = 'qingqie.custom-theme'

let customCache: CustomTheme | null | undefined

export function loadCustomTheme(): CustomTheme | null {
  if (customCache !== undefined) return customCache
  try {
    const p = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '') as CustomTheme
    customCache =
      p && typeof p.name === 'string' && isHex(p.bg) && isHex(p.panel) && isHex(p.txt) && isHex(p.accent)
        ? p
        : null
  } catch {
    customCache = null
  }
  return customCache
}

function syncCustomStyle(): void {
  const t = loadCustomTheme()
  let el = document.getElementById('custom-theme-css') as HTMLStyleElement | null
  if (!t) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = 'custom-theme-css'
    document.head.appendChild(el)
  }
  el.textContent = customCss(t)
}

export function saveCustomTheme(t: CustomTheme | null): void {
  customCache = t
  try {
    if (t) localStorage.setItem(CUSTOM_KEY, JSON.stringify(t))
    else localStorage.removeItem(CUSTOM_KEY)
  } catch {
    // 存储不可用时仅本次会话生效
  }
  syncCustomStyle()
}

export function loadTheme(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved === CUSTOM_ID && loadCustomTheme()) return CUSTOM_ID
    return saved && THEMES.some((t) => t.id === saved) ? saved : 'light'
  } catch {
    return 'light'
  }
}

export function themeIsDark(id: string): boolean {
  if (id === CUSTOM_ID) return loadCustomTheme()?.base === 'dark'
  return THEMES.find((t) => t.id === id)?.dark ?? false
}

export function applyTheme(id: string): void {
  syncCustomStyle()
  const custom = id === CUSTOM_ID ? loadCustomTheme() : null
  const def = THEMES.find((t) => t.id === id) ?? THEMES[0]
  const dark = custom ? custom.base === 'dark' : def.dark
  const applied = custom ? CUSTOM_ID : def.id
  document.body.classList.toggle('dark', dark)
  document.body.dataset.theme = applied
  try {
    localStorage.setItem(STORE_KEY, applied)
  } catch {
    // 存储不可用时仅本次会话生效
  }
}
