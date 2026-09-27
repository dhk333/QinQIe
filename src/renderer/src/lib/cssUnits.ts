// 导出 CSS 的长度单位换算：px 原样，rem 按基准字号折算，vw 按画布宽度折算。
// 偏好值本身存在 lib/uiPrefs.ts（设置页与属性面板共用一份）。
export type CssUnit = 'px' | 'rem' | 'vw'

export interface CssUnitsPrefs {
  unit: CssUnit
  /** rem 基准：1rem 等于多少 px */
  remBase: number
  /** vw 基准兜底值：优先用当前文档实际宽度 */
  vwBase: number
}

/** 把 PSD 的 px 数值格式化成当前单位的 CSS 长度 */
export function fmtLen(px: number, prefs: CssUnitsPrefs, docWidth?: number | null): string {
  if (prefs.unit === 'px') return `${n1(px)}px`
  const base = cssUnitBase(prefs, docWidth)
  // 100vw = 画布宽，所以 vw 还要再乘 100
  const v = prefs.unit === 'vw' ? (px / base) * 100 : px / base
  if (Math.abs(v) < 0.0005) return '0'
  return prefs.unit === 'rem' ? `${n3(v)}rem` : `${n4(v)}vw`
}

/** vw 基准优先用实际画布宽度，缺失或非法时才退回设置值 */
export function cssUnitBase(prefs: CssUnitsPrefs, docWidth?: number | null): number {
  if (prefs.unit === 'rem') return clamp(prefs.remBase, 1, 200)
  return clamp(docWidth && docWidth > 0 ? docWidth : prefs.vwBase, 1, 20000)
}

const clamp = (v: number, min: number, max: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min

const n1 = (v: number) => Math.round(v * 10) / 10
const n3 = (v: number) => Math.round(v * 1000) / 1000
const n4 = (v: number) => Math.round(v * 10000) / 10000
