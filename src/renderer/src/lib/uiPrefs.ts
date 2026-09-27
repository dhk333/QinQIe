import { useSyncExternalStore } from 'react'
import type { CssUnitsPrefs } from './cssUnits'

// 界面行为偏好：设置页改一次，画布 / 属性面板 / 顶栏即时跟随，
// 故做成极简订阅 store 而非裸 localStorage（同一份真源，避免两处状态打架）。
export interface UiPrefs {
  /** 启动时自动检查新版本 */
  autoUpdateCheck: boolean
  /** 选择工具下悬停绘制 Figma 式间距标签 */
  hoverMeasure: boolean
  /** 缩略图缓存上限（MB），0 = 不限制 */
  thumbCapMB: number
  /** 启动后自动打开上次编辑的 PSD */
  lastPsdOnStartup: boolean
  /** 重开同一 PSD 时恢复上次的缩放与位置 */
  restoreViewport: boolean
  /** 导出 CSS 的长度单位与基准值 */
  cssUnits: CssUnitsPrefs
}

const KEY = 'qingqie.ui-prefs'

const DEFAULTS: UiPrefs = {
  autoUpdateCheck: true,
  hoverMeasure: true,
  thumbCapMB: 0,
  lastPsdOnStartup: true,
  restoreViewport: true,
  cssUnits: { unit: 'px', remBase: 16, vwBase: 1920 }
}

const clamp = (v: number, min: number, max: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min

function normalize(p: Partial<UiPrefs> | null): UiPrefs {
  const u = p?.cssUnits
  return {
    autoUpdateCheck: p?.autoUpdateCheck !== false,
    hoverMeasure: p?.hoverMeasure !== false,
    thumbCapMB: clamp(p?.thumbCapMB ?? 0, 0, 102400),
    lastPsdOnStartup: p?.lastPsdOnStartup !== false,
    restoreViewport: p?.restoreViewport !== false,
    cssUnits: {
      unit: u?.unit === 'rem' || u?.unit === 'vw' ? u.unit : 'px',
      remBase: clamp(u?.remBase ?? 16, 1, 200),
      // vw 基准实际取画布宽度，这里存的是画布宽度未知时的兜底值
      vwBase: clamp(u?.vwBase ?? 1920, 1, 20000)
    }
  }
}

let prefs: UiPrefs = (() => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw) as Partial<UiPrefs>) : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
})()

const subs = new Set<() => void>()

export function getUiPrefs(): UiPrefs {
  return prefs
}

export function setUiPrefs(patch: Partial<UiPrefs>): void {
  prefs = { ...prefs, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 存储不可用时仅本次会话生效
  }
  subs.forEach((f) => f())
}

function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getUiPrefs)
}
