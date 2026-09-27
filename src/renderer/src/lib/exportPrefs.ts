import type { ExportFormat } from '@/types'

export interface ExportPrefs {
  format: ExportFormat
  scales: number[]
  quality: number
  /** 导出文件名模板，变量：{名称} {倍数} {格式} {序号} */
  template: string
}

const KEY = 'qingqie.export-prefs'
const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp']
export const DEFAULT_TEMPLATE = '{名称}@{倍数}x.{格式}'
const DEFAULTS: ExportPrefs = { format: 'png', scales: [2], quality: 0.92, template: DEFAULT_TEMPLATE }

export function loadExportPrefs(): ExportPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '') as ExportPrefs
    if (
      p &&
      FORMATS.includes(p.format) &&
      Array.isArray(p.scales) &&
      p.scales.length &&
      p.scales.every((s) => [1, 2, 3].includes(s)) &&
      typeof p.quality === 'number' &&
      p.quality > 0 &&
      p.quality <= 1 &&
      typeof p.template === 'string' &&
      p.template.trim().length > 0
    )
      return { ...DEFAULTS, ...p }
  } catch {
    // 无存储或损坏时用默认
  }
  return DEFAULTS
}

export function saveExportPrefs(p: ExportPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // 存储不可用时仅本次会话生效
  }
}
