import type { ExportFormat, PsdLayer } from '@/types'
import type { RNode } from './compositor'
import { readLayerPixels, type LayerBitmap, type LayerContent } from './psd'
import { t } from '@/i18n/core'
import { fmtLen, type CssUnitsPrefs } from './cssUnits'
import { getUiPrefs } from './uiPrefs'

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

export function sampleColor(canvas: LayerBitmap): string | null {
  try {
    if (canvas.width === 0 || canvas.height === 0) return null
    const d = readLayerPixels(
      canvas,
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    )?.data
    if (!d) return null
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

/** 混合模式下拉的候选，顺序即 PS 面板顺序（沿用 BLEND_LABELS 的声明序） */
export const BLEND_MODES: string[] = Object.keys(BLEND_LABELS)

export function blendLabel(mode: string): string {
  const label = BLEND_LABELS[mode]
  return label ? t(label) : mode
}

function fxColor(c: { r: number; g: number; b: number }, opacity: number): string {
  const a = Math.max(0, Math.min(1, opacity))
  const rgb = [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  if (a >= 0.995) return `#${rgb.toUpperCase()}`
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(a * 100) / 100})`
}

/** #RGB / #RRGGBB → rgb 三元组；解析不出来返回 null */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const s = m[1]
  const h = s.length === 3 ? s.replace(/./g, (c) => c + c) : s
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
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
  return names.map((n) => t(n))
}

export function layerCssSnippet(
  layer: PsdLayer,
  color: string | null,
  rnode?: RNode,
  units: CssUnitsPrefs = getUiPrefs().cssUnits,
  docWidth?: number | null,
  content?: LayerContent | null,
  /** 切图基准宽度倍率（见 lib/basis.ts）：CSS 要落在页面上，所以全部长度按基准口径给 */
  basisK = 1,
  /** 剪贴链/图层蒙版生效后的可见区域：CSS 的 width/height 以它为准，才和画布选框一致 */
  clip?: { box: { width: number; height: number } } | null
): string {
  const len = (px: number) => fmtLen(px * basisK, units, docWidth)
  // 写 CSS 要的是「用户眼里的图形」：位图边界常带透明留白，直接照抄会比设计稿宽几个像素。
  // 编辑重采样后位图与内容各自缩放，所以留白按 图层宽/位图宽 的比例换算到文档坐标。
  const sx = content && content.bw > 0 ? layer.width / content.bw : 1
  const sy = content && content.bh > 0 ? layer.height / content.bh : 1
  const rawW = Math.max(1, Math.round(content ? content.cw * sx : layer.width))
  const rawH = Math.max(1, Math.round(content ? content.ch * sy : layer.height))
  // 只给尺寸不给 left/top：定位由使用者的布局决定，绝对坐标写死反而没人会用
  const boxW = Math.max(1, Math.round(clip ? clip.box.width : rawW))
  const boxH = Math.max(1, Math.round(clip ? clip.box.height : rawH))
  // 输出顺序按使用者关心的程度排：尺寸 → 字体 → 圆角 → 投影 → 背景 → 其他 → 说明注释。
  // 面板标题已经写了图层名与类型，片段里不再重复注释头；只有 CSS 表达不了的信息才留行尾说明。
  const width: string[] = [`width: ${len(boxW)};`, `height: ${len(boxH)};`]
  const text: string[] = []
  const round: string[] = []
  const shadows: string[] = []
  const bg: string[] = []
  const extra: string[] = []
  const notes: string[] = []

  // 文本图层的不透明度折进 color 的 alpha（PS 里文字层的「不透明度」就是字色透明度），
  // 比给整层套 opacity 更好抄；折过了就不再重复输出 opacity 行
  const alpha = layer.opacity < 0.999 ? Math.round(layer.opacity * 100) / 100 : 1
  let alphaFolded = false

  if (layer.isText && layer.textInfo) {
    const ti = layer.textInfo
    if (ti.fontFamily) {
      const fam = ti.fontFamily.replace(/-(Bold|Light|Regular|Medium|Thin|Black|Heavy)$/i, '')
      text.push(`font-family: '${fam}', sans-serif;`)
    }
    if (ti.fontSize) text.push(`font-size: ${len(ti.fontSize)};`)
    if (ti.color) {
      const c = parseHex(ti.color)
      if (c) {
        text.push(`color: ${fxColor(c, alpha)};`)
        alphaFolded = true
      } else text.push(`color: ${ti.color};`)
    }
    if (ti.leading && ti.fontSize && Math.abs(ti.leading - ti.fontSize) > 0.5)
      text.push(`line-height: ${len(ti.leading)};`)
    if (ti.fontWeight === 'bold') text.push('font-weight: 700;')
    if (ti.tracking)
      text.push(`letter-spacing: ${Math.round((ti.tracking / 1000) * 1000) / 1000}em;`)
  } else if (color) {
    bg.push(`background-color: ${color};`)
  }

  // 圆角优先取面板编辑值（按短边钳制过写在合成器节点上），没编辑就用位图反推的原值；
  // 文本图层不给圆角——字形外框的圆角是被字形轮廓反推出来的假值，写出去没有意义
  const radius = rnode?.radius ?? (layer.type === 'group' ? 0 : content?.radius ?? 0)
  if (radius && !layer.isText) round.push(`border-radius: ${len(radius)};`)

  const fx = rnode?.effects
  if (fx) {
    const filters: string[] = []
    for (const sh of fx.dropShadow ?? [])
      if (sh.enabled) {
        const rad = (sh.angle * Math.PI) / 180
        filters.push(
          `drop-shadow(${len(-sh.distance * Math.cos(rad))} ${len(sh.distance * Math.sin(rad))} ${len(sh.size)} ${fxColor(sh.color, sh.opacity)})`
        )
      }
    if (fx.outerGlow?.enabled)
      filters.push(`drop-shadow(0 0 ${len(fx.outerGlow.size)} ${fxColor(fx.outerGlow.color, fx.outerGlow.opacity)})`)
    if (filters.length) shadows.push(`filter: ${filters.join(', ')};`)

    const inset: string[] = []
    for (const sh of fx.innerShadow ?? [])
      if (sh.enabled) {
        const rad = (sh.angle * Math.PI) / 180
        inset.push(
          `inset ${len(-sh.distance * Math.cos(rad))} ${len(sh.distance * Math.sin(rad))} ${len(sh.size)} ${fxColor(sh.color, sh.opacity)}`
        )
      }
    if (fx.innerGlow?.enabled)
      inset.push(`inset 0 0 ${len(fx.innerGlow.size)} ${fxColor(fx.innerGlow.color, fx.innerGlow.opacity)}`)
    if (inset.length) shadows.push(`box-shadow: ${inset.join(', ')}; /* 内阴影/内发光（矩形近似） */`)

    for (const st of fx.stroke ?? [])
      if (st.enabled)
        extra.push(
          `border: ${len(st.size)} solid ${fxColor(st.color, st.opacity)}; /* 描边 ${st.position === 'inside' ? '内侧' : st.position === 'center' ? '居中' : '外侧'} */`
        )
    for (const sf of fx.solidFill ?? [])
      if (sf.enabled) {
        if (layer.isText) {
          text.push(`color: ${fxColor(sf.color, sf.opacity * alpha)}; /* 颜色叠加 */`)
          alphaFolded = true
        } else notes.push(`/* 颜色叠加 ${fxColor(sf.color, sf.opacity)}，位图需导出图片 */`)
      }
    for (const g of fx.gradientOverlay ?? [])
      if (g.enabled && g.stops.length) {
        const stops = (g.reverse ? [...g.stops].reverse() : g.stops)
          .map((x) => `${fxColor(x.color, g.opacity)} ${Math.round(x.location * 100)}%`)
          .join(', ')
        bg.push(`background-image: linear-gradient(${n1(((90 - g.angle) % 360 + 360) % 360)}deg, ${stops}); /* 渐变叠加（近似） */`)
      }
  }

  if (layer.opacity < 0.999 && !alphaFolded)
    extra.push(`opacity: ${Math.round(layer.opacity * 1000) / 1000};`)
  const cssBlend = BLEND_CSS[layer.blendMode]
  if (cssBlend) extra.push(`mix-blend-mode: ${cssBlend};`)
  else if (layer.blendMode !== 'normal' && layer.blendMode !== 'pass through')
    notes.push(`/* 混合模式「${blendLabel(layer.blendMode)}」，CSS 无等价实现 */`)
  if (rnode && rnode.fillOpacity < 0.999)
    notes.push(`/* 填充不透明度 ${pct(rnode.fillOpacity)}，CSS 无独立等价 */`)
  if (rnode?.mask && !rnode.mask.disabled) notes.push('/* 含图层蒙版，非矩形区域需导出图片 */')

  return [...width, ...text, ...round, ...shadows, ...bg, ...extra, ...notes].join('\n')
}
