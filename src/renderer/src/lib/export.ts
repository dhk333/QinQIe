import type { ExportFormat, PsdLayer } from '@/types'
import type { RNode } from './compositor'

function canvasToBlob(canvas: HTMLCanvasElement, format: ExportFormat, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), `image/${format}`, quality ?? 0.92)
  })
}

/**
 * 缩放 + 编码一步到位；srcRect 用于从大画布（整图合成）裁出区域再放大。
 * 返回字节而非 base64，交给主进程直接落盘。
 */
export async function exportCanvasBytes(
  src: HTMLCanvasElement,
  opts: { scale: number; format: ExportFormat; quality?: number; srcRect?: { x: number; y: number; w: number; h: number } }
): Promise<Uint8Array | null> {
  const { scale, format, quality, srcRect } = opts
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round((srcRect?.w ?? src.width) * scale))
  c.height = Math.max(1, Math.round((srcRect?.h ?? src.height) * scale))
  const ctx = c.getContext('2d')!
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.scale(scale, scale)
  if (srcRect) ctx.drawImage(src, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, srcRect.w, srcRect.h)
  else ctx.drawImage(src, 0, 0)
  const blob = await canvasToBlob(c, format, quality)
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

export function sampleColor(canvas: HTMLCanvasElement): string | null {
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null
    const d = ctx.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    ).data
    if (d[3] === 0) return null
    return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  } catch {
    return null
  }
}

/** PS 混合模式 → 精确等价的 CSS mix-blend-mode；无等价的走注释 */
const BLEND_CSS: Record<string, string | undefined> = {
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity'
}

const BLEND_LABELS: Record<string, string> = {
  normal: '正常',
  'pass through': '穿透',
  dissolve: '溶解',
  darken: '变暗',
  multiply: '正片叠底',
  'color burn': '颜色加深',
  'linear burn': '线性加深',
  'darker color': '变暗(颜色)',
  lighten: '变亮',
  screen: '滤色',
  'color dodge': '颜色减淡',
  'linear dodge': '线性减淡',
  'lighter color': '变亮(颜色)',
  overlay: '叠加',
  'soft light': '柔光',
  'hard light': '强光',
  'vivid light': '亮光',
  'linear light': '线性光',
  'pin light': '点光',
  'hard mix': '硬光',
  difference: '差值',
  exclusion: '排除',
  subtract: '减去',
  divide: '划分',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度'
}

export function blendLabel(mode: string): string {
  return BLEND_LABELS[mode] ?? mode
}

function fxColor(c: { r: number; g: number; b: number }, opacity: number): string {
  const a = Math.max(0, Math.min(1, opacity))
  const rgb = [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  if (a >= 0.995) return `#${rgb.toUpperCase()}`
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(a * 100) / 100})`
}

const n1 = (v: number) => Math.round(v * 10) / 10
const pct = (v: number) => `${Math.round(v * 100)}%`

/** 图层样式中与 CSS 近似的部分，返回可展示的效果名列表 */
export function layerEffectNames(rnode?: RNode): string[] {
  const e = rnode?.effects
  if (!e) return []
  const on = (list?: { enabled: boolean }[]) => !!list?.some((x) => x.enabled)
  const names: string[] = []
  if (on(e.dropShadow)) names.push('投影')
  if (on(e.innerShadow)) names.push('内投影')
  if (e.outerGlow?.enabled) names.push('外发光')
  if (e.innerGlow?.enabled) names.push('内发光')
  if (on(e.stroke)) names.push('描边')
  if (on(e.solidFill)) names.push('颜色叠加')
  if (on(e.gradientOverlay)) names.push('渐变叠加')
  return names
}

export function layerCssSnippet(layer: PsdLayer, color: string | null, rnode?: RNode): string {
  const lines: string[] = []
  const kind = layer.type === 'group' ? '图层组' : layer.isText ? '文本图层' : '像素图层'
  const tags = [kind, layer.hidden ? '已隐藏' : null, layer.clipping ? '剪贴蒙版' : null].filter(Boolean)
  lines.push(`/* ${layer.name} · ${tags.join(' · ')} */`)
  lines.push('position: absolute;')
  lines.push(`left: ${layer.left}px;`)
  lines.push(`top: ${layer.top}px;`)
  lines.push(`width: ${layer.width}px;`)
  lines.push(`height: ${layer.height}px;`)
  if (layer.opacity < 0.999) lines.push(`opacity: ${Math.round(layer.opacity * 1000) / 1000};`)
  const cssBlend = BLEND_CSS[layer.blendMode]
  if (cssBlend) lines.push(`mix-blend-mode: ${cssBlend};`)
  else if (layer.blendMode !== 'normal' && layer.blendMode !== 'pass through')
    lines.push(`/* 混合模式「${blendLabel(layer.blendMode)}」，CSS 无等价实现 */`)
  if (rnode && rnode.fillOpacity < 0.999)
    lines.push(`/* 填充不透明度 ${pct(rnode.fillOpacity)}，CSS 无独立等价 */`)
  if (rnode?.mask && !rnode.mask.disabled) lines.push('/* 含图层蒙版，非矩形区域需导出图片 */')

  if (layer.isText && layer.textInfo) {
    const ti = layer.textInfo
    if (ti.fontSize) lines.push(`font-size: ${ti.fontSize}px;`)
    if (ti.fontFamily) {
      const fam = ti.fontFamily.replace(/-(Bold|Light|Regular|Medium|Thin|Black|Heavy)$/i, '')
      lines.push(`font-family: '${fam}', sans-serif;`)
    }
    if (ti.fontWeight === 'bold') lines.push('font-weight: 700;')
    if (ti.color) lines.push(`color: ${ti.color};`)
    if (ti.leading && ti.fontSize && Math.abs(ti.leading - ti.fontSize) > 0.5)
      lines.push(`line-height: ${n1(ti.leading)}px;`)
    if (ti.tracking)
      lines.push(`letter-spacing: ${Math.round((ti.tracking / 1000) * 1000) / 1000}em;`)
  } else if (color) {
    lines.push(`background-color: ${color};`)
  }

  const fx = rnode?.effects
  if (fx) {
    const filters: string[] = []
    for (const s of fx.dropShadow ?? [])
      if (s.enabled) {
        const rad = (s.angle * Math.PI) / 180
        filters.push(
          `drop-shadow(${n1(-s.distance * Math.cos(rad))}px ${n1(s.distance * Math.sin(rad))}px ${n1(s.size)}px ${fxColor(s.color, s.opacity)})`
        )
      }
    if (fx.outerGlow?.enabled)
      filters.push(`drop-shadow(0 0 ${n1(fx.outerGlow.size)}px ${fxColor(fx.outerGlow.color, fx.outerGlow.opacity)})`)
    if (filters.length) lines.push(`filter: ${filters.join(', ')};`)

    const shadows: string[] = []
    for (const s of fx.innerShadow ?? [])
      if (s.enabled) {
        const rad = (s.angle * Math.PI) / 180
        shadows.push(
          `inset ${n1(-s.distance * Math.cos(rad))}px ${n1(s.distance * Math.sin(rad))}px ${n1(s.size)}px ${fxColor(s.color, s.opacity)}`
        )
      }
    if (fx.innerGlow?.enabled)
      shadows.push(`inset 0 0 ${n1(fx.innerGlow.size)}px ${fxColor(fx.innerGlow.color, fx.innerGlow.opacity)}`)
    if (shadows.length) lines.push(`box-shadow: ${shadows.join(', ')}; /* 内阴影/内发光（矩形近似） */`)

    for (const st of fx.stroke ?? [])
      if (st.enabled)
        lines.push(
          `border: ${n1(st.size)}px solid ${fxColor(st.color, st.opacity)}; /* 描边 ${st.position === 'inside' ? '内侧' : st.position === 'center' ? '居中' : '外侧'} */`
        )
    for (const sf of fx.solidFill ?? [])
      if (sf.enabled) {
        if (layer.isText) lines.push(`color: ${fxColor(sf.color, sf.opacity)}; /* 颜色叠加 */`)
        else lines.push(`/* 颜色叠加 ${fxColor(sf.color, sf.opacity)}，位图需导出图片 */`)
      }
    for (const g of fx.gradientOverlay ?? [])
      if (g.enabled && g.stops.length) {
        const stops = (g.reverse ? [...g.stops].reverse() : g.stops)
          .map((s) => `${fxColor(s.color, g.opacity)} ${Math.round(s.location * 100)}%`)
          .join(', ')
        lines.push(`background-image: linear-gradient(${n1(((90 - g.angle) % 360 + 360) % 360)}deg, ${stops}); /* 渐变叠加（近似） */`)
      }
  }
  return lines.join('\n')
}
