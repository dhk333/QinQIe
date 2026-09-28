// 自定义画布光标：Chromium 的 cursor: url() 不认 SVG，只能把 SVG 画进 canvas 再转 PNG data URL。
// 图形数据全部来自 lib/toolGlyphs（与工具栏按钮同一份），显示尺寸也和按钮里的 svg 一模一样（14px），
// 这样「按钮上长什么样，鼠标就长什么样」。本机 AppliedDPI=96（100% 缩放），所以位图 1px = 1 DIP；
// 位图整张必须 ≤32，超过就会被 Chromium 整体降采样，尺寸就不再是我们算出来的那个。
// 模块加载时一次性光栅化四枚，未就绪期间调用方回落到系统光标，不会闪空白。
import { useEffect, useState } from 'react'
import { CURSOR_TOOLS, TOOL_GLYPHS, type CursorTool, type ToolGlyph } from './toolGlyphs'

/** 位图边长：正好卡在 Chromium 的 32 DIP 上限，保证 1px = 1 DIP 不被缩放 */
const IMAGE = 32
/** 图形外扩的留白，够画下深色描边又不超出位图 */
const MARGIN = 3
/** 与 styles.css 的 `.zoombar .zb svg { width: 14px }` 同一个数：光标图形 = 工具栏图标大小 */
const GLYPH = 14

/** viewBox 长边缩到 GLYPH，图形框贴在 (MARGIN,MARGIN)，笔尖由此推出热点坐标 */
function geom(g: ToolGlyph): { w: number; h: number; x: number; y: number; hx: number; hy: number } {
  const [vx, vy, vw, vh] = g.viewBox.split(' ').map(Number)
  const scale = GLYPH / Math.max(vw, vh)
  const w = vw * scale
  const h = vh * scale
  const x = MARGIN
  const y = MARGIN
  return {
    w,
    h,
    x,
    y,
    hx: Math.round(x + (g.tip.x - vx) * scale),
    hy: Math.round(y + (g.tip.y - vy) * scale)
  }
}

function svgFor(g: ToolGlyph): string {
  const { w, h } = geom(g)
  const unitsPerPx = Math.max(...g.viewBox.split(' ').slice(2).map(Number)) / GLYPH
  const parts: string[] = []
  for (const d of g.solid ?? []) {
    parts.push(`<path d="${d}" fill="#141418" stroke="#141418" stroke-width="${2 * unitsPerPx}"/>`)
    parts.push(`<path d="${d}" fill="#ffffff"/>`)
  }
  const light = g.stroke ?? 1.6
  const dark = light + 2 * (g.halo ?? 0.4) * unitsPerPx
  for (const d of g.line ?? []) {
    parts.push(`<path d="${d}" fill="none" stroke="#141418" stroke-width="${dark}"/>`)
    parts.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${light}"/>`)
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.viewBox}" width="${w}" height="${h}">` +
    `<g stroke-linejoin="round" stroke-linecap="round">${parts.join('')}</g></svg>`
  )
}

const values = new Map<string, string>()
const listeners = new Set<() => void>()

function build(name: CursorTool): void {
  const g = TOOL_GLYPHS[name]
  const { w, h, x, y, hx, hy } = geom(g)
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = IMAGE
    c.height = IMAGE
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.drawImage(img, x, y, w, h)
      values.set(name, `url(${c.toDataURL('image/png')}) ${hx} ${hy}, crosshair`)
    }
    listeners.forEach((f) => f())
  }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgFor(g))
}

CURSOR_TOOLS.forEach(build)

/** 当前工具的自绘光标 CSS；PNG 还没光栅化好时返回 null，调用方回落到系统光标 */
export function toolCursorCss(tool: string): string | null {
  return values.get(tool) ?? null
}

export function useToolCursor(tool: string): string | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((v) => v + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  return toolCursorCss(tool)
}

/** 8 个控制柄 → 系统双向箭头光标：自研图标做不出各方向的清晰度，原生光标语义又与全平台一致 */
export const HANDLE_CURSORS: Record<'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w', string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
}
