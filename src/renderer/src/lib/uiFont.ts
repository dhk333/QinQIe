export type FontSizeId = 'sm' | 'md' | 'lg'

export const FONT_SIZES: { id: FontSizeId; name: string; desc: string; zoom: number }[] = [
  { id: 'sm', name: '小', desc: '默认，适合 1080P 及更小屏幕', zoom: 1 },
  { id: 'md', name: '中', desc: '界面整体放大一档', zoom: 1.1 },
  { id: 'lg', name: '大', desc: '高分屏或远距离阅读', zoom: 1.25 }
]

const KEY = 'qingqie.ui-font'

export function loadFontSize(): FontSizeId {
  try {
    const saved = localStorage.getItem(KEY)
    return FONT_SIZES.some((f) => f.id === saved) ? (saved as FontSizeId) : 'sm'
  } catch {
    return 'sm'
  }
}

export function applyFontSize(id: FontSizeId): void {
  const zoom = FONT_SIZES.find((f) => f.id === id)?.zoom ?? 1
  document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom)
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // 存储不可用时仅本次会话生效
  }
}
