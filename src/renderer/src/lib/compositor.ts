// 统一的 PSD 合成器。浏览器（document.createElement）与 Node 像素回归脚本
// （@napi-rs/canvas）共用这一份实现，保证「预览所见」「导出所得」「回归基线」三者一致。
// 只依赖注入的 createCanvas 工厂，不出现任何 DOM 全局。

export interface RasterCanvas {
  width: number
  height: number
  // DOM 的 HTMLCanvasElement 与 @napi-rs/canvas 的 Canvas 重载签名互不兼容，
  // 这里宽松返回让两边都能塞进来，真正的类型安全由 Env 工厂保证
  getContext(type: '2d'): any
}

export interface RasterGradient {
  addColorStop(offset: number, color: string): void
}

export interface RasterCtx {
  save(): void
  restore(): void
  drawImage(img: RasterCanvas, ...args: number[]): void
  createImageData(w: number, h: number): RasterImageData
  getImageData(x: number, y: number, w: number, h: number): RasterImageData
  putImageData(data: RasterImageData, x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  fillStyle: string | RasterGradient
  globalAlpha: number
  globalCompositeOperation: string
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RasterGradient
}

export interface RasterImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Env {
  createCanvas(w: number, h: number): RasterCanvas
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface MaskInfo {
  left: number
  top: number
  right: number
  bottom: number
  defaultColor: number
  disabled: boolean
  canvas?: RasterCanvas | null
}

export interface ShadowInfo {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number }
  opacity: number
  angle: number
  distance: number
  choke: number
  size: number
}

export interface GlowInfo {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number }
  opacity: number
  choke: number
  size: number
}

export interface StrokeInfo {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number }
  opacity: number
  size: number
  position: 'inside' | 'center' | 'outside'
}

export interface SolidFillInfo {
  enabled: boolean
  blendMode: string
  color: { r: number; g: number; b: number }
  opacity: number
}

export interface GradientStop {
  color: { r: number; g: number; b: number }
  location: number
  midpoint: number
}

export interface GradientInfo {
  enabled: boolean
  blendMode: string
  opacity: number
  angle: number
  reverse: boolean
  scale: number
  type: string
  stops: GradientStop[]
  opacityStops: { opacity: number; location: number }[]
}

export interface EffectInfo {
  dropShadow?: ShadowInfo[]
  innerShadow?: ShadowInfo[]
  outerGlow?: GlowInfo
  innerGlow?: GlowInfo
  stroke?: StrokeInfo[]
  solidFill?: SolidFillInfo[]
  gradientOverlay?: GradientInfo[]
}

export interface RNode {
  id: number
  name: string
  kind: 'group' | 'layer'
  left: number
  top: number
  right: number
  bottom: number
  opacity: number
  /** 填充不透明度：只削弱图层自身像素，不影响图层样式 */
  fillOpacity: number
  hidden: boolean
  clipping: boolean
  blendMode: string
  /** 图层原始位图（未烘焙蒙版、未叠加样式） */
  canvas?: RasterCanvas | null
  mask?: MaskInfo | null
  /** 形状图层：PS 存的内嵌位图已按矢量蒙版裁切，重复裁切只会引入边缘误差 */
  shapeLayer?: boolean
  effects?: EffectInfo | null
  children?: RNode[]
  /** 叶子位图的惰性缓存（蒙版+样式烘焙结果） */
  bitmap?: { canvas: RasterCanvas; rect: Rect } | null
}

const BLEND_MAP: Record<string, string> = {
  normal: 'source-over',
  'pass through': 'source-over',
  dissolve: 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  'color burn': 'color-burn',
  'linear burn': 'multiply',
  'darker color': 'darken',
  lighten: 'lighten',
  screen: 'screen',
  'color dodge': 'color-dodge',
  'linear dodge': 'lighter',
  'lighter color': 'lighten',
  overlay: 'overlay',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'vivid light': 'hard-light',
  'linear light': 'overlay',
  'pin light': 'hard-light',
  'hard mix': 'hard-light',
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'multiply',
  divide: 'screen',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity'
}

const MAX_PAD = 512

function blendOf(mode: string | undefined): string {
  return BLEND_MAP[mode ?? 'normal'] ?? 'source-over'
}

function normRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(0, Math.round(r.w)), h: Math.max(0, Math.round(r.h)) }
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y
  }
}

/** 两矩形交集，用于把离屏缓冲限制在真正会落笔的范围内 */
function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y }
}

const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 }

function isEmpty(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0
}

function contentRect(n: RNode): Rect {
  return normRect({ x: n.left, y: n.top, w: n.right - n.left, h: n.bottom - n.top })
}

function childUnion(n: RNode): Rect {
  let acc: Rect | null = null
  for (const c of n.children ?? []) {
    const r = nodeRect(c)
    if (isEmpty(r)) continue
    acc = acc ? unionRect(acc, r) : r
  }
  return acc ?? EMPTY
}

/** 节点在文档空间中实际会占用的区域（含外扩的投影/发光） */
export function nodeRect(n: RNode): Rect {
  const pad = outerPad(n.effects)
  if (n.kind === 'group') {
    const u = childUnion(n)
    if (!pad || isEmpty(u)) return u
    return normRect({ x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 })
  }
  const base = contentRect(n)
  if (!pad) return base
  return normRect({ x: base.x - pad, y: base.y - pad, w: base.w + pad * 2, h: base.h + pad * 2 })
}

function outerPad(effects?: EffectInfo | null): number {
  if (!effects) return 0
  let pad = 0
  const grow = (size: number, distance = 0) => {
    pad = Math.max(pad, Math.round(size + distance))
  }
  for (const s of effects.dropShadow ?? []) if (s.enabled) grow(s.size, s.distance)
  if (effects.outerGlow?.enabled) grow(effects.outerGlow.size)
  for (const s of effects.stroke ?? []) if (s.enabled && s.position === 'outside') grow(s.size)
  return Math.min(pad, MAX_PAD)
}

function px(v: number): string {
  return String(Math.round(v))
}

function rgba(c: { r: number; g: number; b: number }, a: number): string {
  return `rgba(${px(c.r)},${px(c.g)},${px(c.b)},${a})`
}

// ---------------------------------------------------------------- 形态学与模糊
// 全部在 ImageData 上实现，避免依赖 ctx.filter（Node 与浏览器实现不一致）。

function alphaPlane(data: Uint8ClampedArray, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h)
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = data[i + 3]
  return out
}

/** 一维滑动窗口 min/max（单调队列），用于可分离的方结构元形态学 */
function lineFilter(src: Float64Array, dst: Float64Array, start: number, count: number, stride: number, r: number, min: boolean): void {
  const idx = (i: number) => (i < 0 ? 0 : i >= count ? count - 1 : i)
  const val = (i: number) => src[start + idx(i) * stride]
  const deq = new Int32Array(count + 2 * r + 4)
  let head = 0
  let tail = 0
  for (let i = -r; i <= r; i++) {
    const v = val(i)
    while (tail > head && (min ? val(deq[tail - 1]) >= v : val(deq[tail - 1]) <= v)) tail--
    deq[tail++] = i
  }
  for (let i = 0; i < count; i++) {
    while (tail > head && deq[head] < i - r) head++
    dst[start + i * stride] = val(deq[head])
    const v = val(i + r + 1)
    while (tail > head && (min ? val(deq[tail - 1]) >= v : val(deq[tail - 1]) <= v)) tail--
    deq[tail++] = i + r + 1
  }
}

/** 腐蚀（min）/膨胀（max），r 为半径 */
function morph(plane: Float64Array, w: number, h: number, r: number, min: boolean): Float64Array {
  if (r <= 0) return plane
  const tmp = new Float64Array(plane.length)
  const out = new Float64Array(plane.length)
  for (let y = 0; y < h; y++) lineFilter(plane, tmp, y * w, w, 1, r, min)
  for (let x = 0; x < w; x++) lineFilter(tmp, out, x, h, w, r, min)
  return out
}

function lineBlur(src: Float64Array, dst: Float64Array, start: number, count: number, stride: number, r: number): void {
  const idx = (i: number) => (i < 0 ? 0 : i >= count ? count - 1 : i)
  const val = (i: number) => src[start + idx(i) * stride]
  const win = r * 2 + 1
  let acc = 0
  for (let i = -r; i <= r; i++) acc += val(i)
  for (let x = 0; x < count; x++) {
    dst[start + x * stride] = acc / win
    acc += val(x + r + 1) - val(x - r)
  }
}

/** 三次箱式模糊逼近高斯；总方差 = (w^2-1)/4，故 r = (sqrt(4*sigma^2+1)-1)/2 */
function blurPlane(plane: Float64Array, w: number, h: number, sigma: number): Float64Array {
  if (sigma <= 0.3) return plane
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2))
  let cur = plane
  for (let pass = 0; pass < 3; pass++) {
    const mid = new Float64Array(plane.length)
    const next = new Float64Array(plane.length)
    for (let y = 0; y < h; y++) lineBlur(cur, mid, y * w, w, 1, r)
    for (let x = 0; x < w; x++) lineBlur(mid, next, x, h, w, r)
    cur = next
  }
  return cur
}

/** sigma: PS 的模糊半径按 sigma = radius/2 折算 */
function blurAlpha(plane: Float64Array, w: number, h: number, psRadius: number): Float64Array {
  return blurPlane(plane, w, h, psRadius / 2)
}

function canvasAlpha(env: Env, src: RasterCanvas): { plane: Float64Array; w: number; h: number } {
  const w = src.width
  const h = src.height
  const d = src.getContext('2d').getImageData(0, 0, w, h).data
  return { plane: alphaPlane(d, w, h), w, h }
}

/** 把 alpha 面搬进外扩后的画布，投影/外发光才能溢出图层自身边界 */
function padPlane(src: { plane: Float64Array; w: number; h: number }, w: number, h: number, ox: number, oy: number) {
  if (ox === 0 && oy === 0 && w === src.w && h === src.h) return src
  const out = new Float64Array(w * h)
  for (let y = 0; y < src.h; y++) {
    const dy = y + oy
    if (dy < 0 || dy >= h) continue
    for (let x = 0; x < src.w; x++) {
      const dx = x + ox
      if (dx < 0 || dx >= w) continue
      out[dy * w + dx] = src.plane[y * src.w + x]
    }
  }
  return { plane: out, w, h }
}

function planeToCanvas(env: Env, plane: Float64Array, w: number, h: number): RasterCanvas {
  const c = env.createCanvas(w, h)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let p = 0; p < plane.length; p++) {
    const i = p * 4
    const v = plane[p] < 0 ? 0 : plane[p] > 255 ? 255 : plane[p]
    d[i] = 255
    d[i + 1] = 255
    d[i + 2] = 255
    d[i + 3] = v
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// ---------------------------------------------------------------- 蒙版

function applyMask(env: Env, src: RasterCanvas, mask: MaskInfo, layerLeft: number, layerTop: number): RasterCanvas {
  if (mask.disabled || !mask.canvas) return src
  const mL = mask.left
  const mT = mask.top
  const uL = Math.min(mL, layerLeft)
  const uT = Math.min(mT, layerTop)
  const uR = Math.max(mask.right, layerLeft + src.width)
  const uB = Math.max(mask.bottom, layerTop + src.height)
  const uw = Math.max(1, uR - uL)
  const uh = Math.max(1, uB - uT)

  const plane = env.createCanvas(uw, uh)
  const pctx = plane.getContext('2d')
  const def = mask.defaultColor ?? 0
  pctx.fillStyle = `rgb(${def},${def},${def})`
  pctx.fillRect(0, 0, uw, uh)
  pctx.drawImage(mask.canvas, mL - uL, mT - uT)
  // ag-psd 的蒙版画布用 RGB 明度承载（alpha 恒为 255），转成 alpha 通道
  const img = pctx.getImageData(0, 0, uw, uh)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i]
    d[i] = 255
    d[i + 1] = 255
    d[i + 2] = 255
  }
  pctx.putImageData(img, 0, 0)

  const out = env.createCanvas(src.width, src.height)
  const octx = out.getContext('2d')
  octx.drawImage(src, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(plane, uL - layerLeft, uT - layerTop)
  return out
}

// ---------------------------------------------------------------- 图层样式

/** PS 的 angle 是「光源方向」，阴影朝光源的反方向偏移；屏幕坐标 y 轴向下 */
function shadowOffset(angleDeg: number, distance: number): { dx: number; dy: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { dx: -Math.cos(rad) * distance, dy: Math.sin(rad) * distance }
}

/** 生成一份「按颜色+不透明度着色」的 alpha 蒙版画布 */
function tinted(env: Env, plane: Float64Array, w: number, h: number, color: { r: number; g: number; b: number }, opacity: number): RasterCanvas {
  const c = env.createCanvas(w, h)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let p = 0; p < plane.length; p++) {
    const i = p * 4
    const v = plane[p] < 0 ? 0 : plane[p] > 255 ? 255 : plane[p]
    d[i] = color.r
    d[i + 1] = color.g
    d[i + 2] = color.b
    d[i + 3] = v * opacity
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function drawShadowLayer(ctx: RasterCtx, env: Env, s: ShadowInfo, alpha: { plane: Float64Array; w: number; h: number }, ox: number, oy: number): void {
  let plane = alpha.plane
  if (s.choke > 0) plane = morph(plane, alpha.w, alpha.h, Math.round(s.choke), true)
  if (s.size > 0) plane = blurAlpha(plane, alpha.w, alpha.h, s.size)
  const tint = tinted(env, plane, alpha.w, alpha.h, s.color, s.opacity)
  const { dx, dy } = shadowOffset(s.angle, s.distance)
  ctx.save()
  ctx.globalCompositeOperation = blendOf(s.blendMode)
  ctx.drawImage(tint, Math.round(ox + dx), Math.round(oy + dy))
  ctx.restore()
}

function drawGlowLayer(ctx: RasterCtx, env: Env, g: GlowInfo, alpha: { plane: Float64Array; w: number; h: number }, ox: number, oy: number): void {
  let plane = alpha.plane
  if (g.choke > 0) plane = morph(plane, alpha.w, alpha.h, Math.round(g.choke), true)
  if (g.size > 0) plane = blurAlpha(plane, alpha.w, alpha.h, g.size)
  const tint = tinted(env, plane, alpha.w, alpha.h, g.color, g.opacity)
  ctx.save()
  ctx.globalCompositeOperation = blendOf(g.blendMode)
  ctx.drawImage(tint, ox, oy)
  ctx.restore()
}

/** 内阴影/内发光：内容 alpha 与「反向偏移形状」补集的交集 */
function drawInnerLayer(ctx: RasterCtx, env: Env, s: { blendMode: string; color: { r: number; g: number; b: number }; opacity: number; size: number; choke: number }, alpha: { plane: Float64Array; w: number; h: number }, ox: number, oy: number, dx: number, dy: number): void {
  const { w, h } = alpha
  const shifted = new Float64Array(w * h)
  const ix = Math.round(dx)
  const iy = Math.round(dy)
  for (let y = 0; y < h; y++) {
    const sy = y - iy
    for (let x = 0; x < w; x++) {
      const sx = x - ix
      shifted[y * w + x] = sx >= 0 && sx < w && sy >= 0 && sy < h ? alpha.plane[sy * w + sx] : 0
    }
  }
  let plane = s.size > 0 ? blurAlpha(shifted, w, h, s.size) : shifted
  const out = new Float64Array(w * h)
  for (let p = 0; p < plane.length; p++) out[p] = (alpha.plane[p] * (255 - plane[p])) / 255
  const band = s.choke > 0 ? morph(out, w, h, Math.round(s.choke), true) : out
  const tint = tinted(env, band, w, h, s.color, s.opacity)
  ctx.save()
  ctx.globalCompositeOperation = blendOf(s.blendMode)
  ctx.drawImage(tint, ox, oy)
  ctx.restore()
}

function drawStroke(ctx: RasterCtx, env: Env, s: StrokeInfo, alpha: { plane: Float64Array; w: number; h: number }, ox: number, oy: number): void {
  const { plane, w, h } = alpha
  const r = Math.max(1, Math.round(s.size))
  let band: Float64Array
  if (s.position === 'outside') {
    const d = morph(plane, w, h, r, false)
    band = new Float64Array(w * h)
    for (let p = 0; p < band.length; p++) band[p] = Math.max(0, d[p] - plane[p])
  } else if (s.position === 'center') {
    const half = Math.max(1, Math.round(r / 2))
    const d = morph(plane, w, h, half, false)
    const e = morph(plane, w, h, half, true)
    band = new Float64Array(w * h)
    for (let p = 0; p < band.length; p++) band[p] = Math.max(0, d[p] - e[p])
  } else {
    const e = morph(plane, w, h, r, true)
    band = new Float64Array(w * h)
    for (let p = 0; p < band.length; p++) band[p] = Math.max(0, plane[p] - e[p])
  }
  const tint = tinted(env, band, w, h, s.color, s.opacity)
  ctx.save()
  ctx.globalCompositeOperation = blendOf(s.blendMode)
  ctx.drawImage(tint, ox, oy)
  ctx.restore()
}

function gradientCanvas(env: Env, g: GradientInfo, w: number, h: number): RasterCanvas {
  const c = env.createCanvas(w, h)
  const ctx = c.getContext('2d')
  const angle = ((g.angle || 0) * Math.PI) / 180
  const cx = w / 2
  const cy = h / 2
  const len = (Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) / 2
  const scale = g.scale && g.scale > 0 ? 100 / g.scale : 1
  const half = (len / 2) * scale
  const grad = ctx.createLinearGradient(cx - Math.cos(angle) * half, cy - Math.sin(angle) * half, cx + Math.cos(angle) * half, cy + Math.sin(angle) * half)
  const stops = [...g.stops].sort((a, b) => a.location - b.location)
  for (const st of stops) {
    const loc = g.reverse ? 1 - st.location : st.location
    grad.addColorStop(Math.min(1, Math.max(0, loc)), `rgb(${px(st.color.r)},${px(st.color.g)},${px(st.color.b)})`)
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  if (g.opacityStops?.length) {
    const oc = env.createCanvas(w, h)
    const octx = oc.getContext('2d')
    const og = octx.createLinearGradient(cx - Math.cos(angle) * half, cy - Math.sin(angle) * half, cx + Math.cos(angle) * half, cy + Math.sin(angle) * half)
    for (const st of g.opacityStops) {
      const loc = g.reverse ? 1 - st.location : st.location
      og.addColorStop(Math.min(1, Math.max(0, loc)), `rgba(0,0,0,${1 - st.opacity})`)
    }
    octx.fillStyle = og
    octx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(oc, 0, 0)
  }
  return c
}

// ---------------------------------------------------------------- 叶子渲染

function hasEffects(e?: EffectInfo | null): boolean {
  return !!e && !!(e.dropShadow?.some((s) => s.enabled) || e.innerShadow?.some((s) => s.enabled) || e.outerGlow?.enabled || e.innerGlow?.enabled || e.stroke?.some((s) => s.enabled) || e.solidFill?.some((s) => s.enabled) || e.gradientOverlay?.some((s) => s.enabled))
}

/** 内容位图 + 图层样式 → 最终位图；(cx,cy) 为内容左上角的文档坐标，rect 为目标区域（含外扩） */
function bake(env: Env, content: RasterCanvas, cx: number, cy: number, rect: Rect, e: EffectInfo | null | undefined, fill: number): RasterCanvas {
  const c = env.createCanvas(rect.w, rect.h)
  const ctx = c.getContext('2d')
  const ox = cx - rect.x
  const oy = cy - rect.y

  if (!hasEffects(e)) {
    ctx.globalAlpha = fill
    ctx.drawImage(content, ox, oy)
    return c
  }

  // 内容先画进临时画布，便于取「内容 alpha」作为各样式的作用域
  const inner = env.createCanvas(content.width, content.height)
  inner.getContext('2d').drawImage(content, 0, 0)
  const alpha = canvasAlpha(env, inner)
  const outer = padPlane(alpha, rect.w, rect.h, ox, oy)

  for (const s of e!.dropShadow ?? []) if (s.enabled) drawShadowLayer(ctx, env, s, outer, 0, 0)
  if (e!.outerGlow?.enabled) drawGlowLayer(ctx, env, e!.outerGlow, outer, 0, 0)
  ctx.save()
  ctx.globalAlpha = fill
  ctx.drawImage(inner, ox, oy)
  ctx.restore()

  for (const s of e!.innerShadow ?? []) {
    if (!s.enabled) continue
    const { dx, dy } = shadowOffset(s.angle, s.distance)
    drawInnerLayer(ctx, env, s, alpha, ox, oy, dx, dy)
  }
  const ig = e!.innerGlow
  if (ig?.enabled) drawInnerLayer(ctx, env, { ...ig, size: ig.size, choke: ig.choke }, alpha, ox, oy, 0, 0)
  for (const f of e!.solidFill ?? []) {
    if (!f.enabled) continue
    const tint = tinted(env, alpha.plane, alpha.w, alpha.h, f.color, f.opacity)
    ctx.save()
    ctx.globalCompositeOperation = blendOf(f.blendMode)
    ctx.drawImage(tint, ox, oy)
    ctx.restore()
  }
  for (const g of e!.gradientOverlay ?? []) {
    if (!g.enabled) continue
    const grad = gradientCanvas(env, g, alpha.w, alpha.h)
    const gc = env.createCanvas(alpha.w, alpha.h)
    const gctx = gc.getContext('2d')
    gctx.drawImage(grad, 0, 0)
    gctx.globalCompositeOperation = 'destination-in'
    gctx.drawImage(inner, 0, 0)
    gctx.globalCompositeOperation = 'source-atop'
    gctx.globalAlpha = g.opacity
    ctx.save()
    ctx.globalCompositeOperation = blendOf(g.blendMode)
    ctx.drawImage(gc, ox, oy)
    ctx.restore()
  }
  for (const s of e!.stroke ?? []) if (s.enabled) drawStroke(ctx, env, s, alpha, ox, oy)
  return c
}

/** 叶子图层位图（含蒙版与图层样式），带外扩；结果缓存在节点上 */
export function leafBitmap(n: RNode, env: Env): { canvas: RasterCanvas; rect: Rect } | null {
  if (n.bitmap) return n.bitmap
  const base = n.canvas
  if (!base || base.width === 0 || base.height === 0) return null
  const rect = nodeRect(n)
  if (isEmpty(rect)) return null
  let content = base
  if (n.mask) content = applyMask(env, content, n.mask, n.left, n.top)
  n.bitmap = { canvas: bake(env, content, n.left, n.top, rect, n.effects, n.fillOpacity), rect }
  return n.bitmap
}

export function invalidateBitmaps(nodes: RNode[]): void {
  for (const n of nodes) {
    n.bitmap = null
    if (n.children) invalidateBitmaps(n.children)
  }
}

// ---------------------------------------------------------------- 组与列表合成

interface PaintTarget {
  ctx: RasterCtx
  /** 目标画布左上角在文档空间中的位置 */
  ox: number
  oy: number
  /** 目标画布覆盖的文档区域，离屏缓冲不得超出 */
  clip: Rect
}

/** 渲染上下文：画布工厂 + UI 侧的显隐集合（组显隐已由调用方传导到后代叶子） */
export interface RenderCtx {
  env: Env
  hiddenIds?: Set<number>
}

function isHidden(n: RNode, rc: RenderCtx): boolean {
  return !!n.hidden || (!!rc.hiddenIds && rc.hiddenIds.has(n.id))
}

/** 叶子图层是否可见（组内可能整支被隐藏） */
function hasVisibleContent(n: RNode, rc: RenderCtx): boolean {
  if (isHidden(n, rc)) return false
  if (n.kind === 'layer') return !!n.canvas
  return (n.children ?? []).some((c) => hasVisibleContent(c, rc))
}

function paintLeaf(t: PaintTarget, n: RNode, rc: RenderCtx): void {
  const bmp = leafBitmap(n, rc.env)
  if (!bmp) return
  t.ctx.save()
  t.ctx.globalAlpha = n.opacity
  t.ctx.globalCompositeOperation = blendOf(n.blendMode)
  t.ctx.drawImage(bmp.canvas, bmp.rect.x - t.ox, bmp.rect.y - t.oy)
  t.ctx.restore()
}

/** 剪贴裁切用的 alpha：基底的内容区域（不含投影，含描边） */
function clipAlpha(n: RNode, rc: RenderCtx, within?: Rect | null): { canvas: RasterCanvas; x: number; y: number } | null {
  if (n.kind === 'group') {
    const r = renderGroup(n, rc, within ?? null)
    if (!r) return null
    return { canvas: r.canvas, x: r.rect.x, y: r.rect.y }
  }
  if (!n.canvas) return null
  if (n.effects?.stroke?.some((s) => s.enabled) || n.effects?.solidFill?.some((s) => s.enabled)) {
    const bmp = leafBitmap(n, rc.env)
    if (bmp) return { canvas: bmp.canvas, x: bmp.rect.x, y: bmp.rect.y }
  }
  let content: RasterCanvas = n.canvas
  if (n.mask) content = applyMask(rc.env, content, n.mask, n.left, n.top)
  if (n.fillOpacity < 1) {
    const f = rc.env.createCanvas(content.width, content.height)
    const fctx = f.getContext('2d')
    fctx.globalAlpha = n.fillOpacity
    fctx.drawImage(content, 0, 0)
    content = f
  }
  return { canvas: content, x: n.left, y: n.top }
}

/** 剪贴链：基底 + 其后连续的 clipping 图层，先离屏合成再按基底 alpha 裁切 */
function paintClipChain(t: PaintTarget, base: RNode, clippees: RNode[], rc: RenderCtx): void {
  const visible = clippees.filter((c) => hasVisibleContent(c, rc))
  if (!visible.length) {
    paintNode(t, base, rc)
    return
  }
  let rect = visible.reduce((acc, c) => unionRect(acc, nodeRect(c)), nodeRect(base))
  rect = intersectRect(rect, t.clip)
  if (isEmpty(rect)) return
  const buf = rc.env.createCanvas(rect.w, rect.h)
  const inner: PaintTarget = { ctx: buf.getContext('2d'), ox: rect.x, oy: rect.y, clip: rect }
  const bmp = base.kind === 'group' ? renderGroup(base, rc, rect) : leafBitmap(base, rc.env)
  if (bmp) inner.ctx.drawImage(bmp.canvas, bmp.rect.x - rect.x, bmp.rect.y - rect.y)
  for (const c of visible) paintLeafOrGroup(inner, c, rc)
  const alpha = clipAlpha(base, rc, rect)
  if (alpha) {
    inner.ctx.globalCompositeOperation = 'destination-in'
    inner.ctx.globalAlpha = 1
    inner.ctx.drawImage(alpha.canvas, alpha.x - rect.x, alpha.y - rect.y)
  }
  t.ctx.save()
  t.ctx.globalAlpha = base.opacity
  t.ctx.globalCompositeOperation = blendOf(base.blendMode)
  t.ctx.drawImage(buf, rect.x - t.ox, rect.y - t.oy)
  t.ctx.restore()
}

function paintLeafOrGroup(t: PaintTarget, n: RNode, rc: RenderCtx): void {
  if (n.kind === 'group') {
    paintGroup(t, n, rc)
    return
  }
  paintLeaf(t, n, rc)
}

function paintNode(t: PaintTarget, n: RNode, rc: RenderCtx): void {
  if (n.kind === 'group') paintGroup(t, n, rc)
  else paintLeaf(t, n, rc)
}

function paintList(t: PaintTarget, nodes: RNode[], rc: RenderCtx): void {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    let j = i + 1
    const clippees: RNode[] = []
    while (j < nodes.length && nodes[j].clipping) {
      if (hasVisibleContent(nodes[j], rc)) clippees.push(nodes[j])
      j++
    }
    // 基底被隐藏或链条无基底时，整条剪贴链都不落笔（PS 行为：剪贴层随基底一起消失）
    if (!n.clipping && !isHidden(n, rc)) {
      if (clippees.length) paintClipChain(t, n, clippees, rc)
      else paintNode(t, n, rc)
    }
    i = j - 1
  }
}

/** 组只有在需要离屏时才建缓冲：带蒙版、不透明度 <1、非正常混合模式、带图层样式 */
function needsOffscreen(n: RNode): boolean {
  if (n.kind !== 'group') return false
  if (n.mask) return true
  if (n.opacity < 1) return true
  if (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'pass through') return true
  if (hasEffects(n.effects)) return true
  return false
}

function paintGroup(t: PaintTarget, n: RNode, rc: RenderCtx): void {
  if (needsOffscreen(n)) {
    const rect = intersectRect(nodeRect(n), t.clip)
    if (isEmpty(rect)) return
    const r = renderGroup(n, rc, rect)
    if (!r) return
    const out = hasEffects(n.effects) ? bake(rc.env, r.canvas, r.rect.x, r.rect.y, r.rect, n.effects, 1) : r.canvas
    t.ctx.save()
    t.ctx.globalAlpha = n.opacity
    t.ctx.globalCompositeOperation = blendOf(n.blendMode)
    t.ctx.drawImage(out, r.rect.x - t.ox, r.rect.y - t.oy)
    t.ctx.restore()
    return
  }
  paintList(t, n.children ?? [], rc)
}

/** 把一个组离屏合成为一张画布（含组蒙版） */
export function renderGroup(n: RNode, rc: RenderCtx, sizeTo?: Rect | null): { canvas: RasterCanvas; rect: Rect } | null {
  const rect = normRect(sizeTo ?? nodeRect(n))
  if (isEmpty(rect)) return null
  const buf = rc.env.createCanvas(rect.w, rect.h)
  const t: PaintTarget = { ctx: buf.getContext('2d'), ox: rect.x, oy: rect.y, clip: rect }
  paintList(t, n.children ?? [], rc)
  if (n.mask) return { canvas: applyMask(rc.env, buf, n.mask, rect.x, rect.y), rect }
  return { canvas: buf, rect }
}

/** 整篇文档合成，返回文档尺寸画布 */
export function compositeDocument(nodes: RNode[], rc: RenderCtx, doc: { width: number; height: number }): RasterCanvas {
  const canvas = rc.env.createCanvas(Math.max(1, doc.width), Math.max(1, doc.height))
  const clip = { x: 0, y: 0, w: doc.width, h: doc.height }
  const t: PaintTarget = { ctx: canvas.getContext('2d'), ox: 0, oy: 0, clip }
  paintList(t, nodes, rc)
  return canvas
}

/** 区域合成：只渲染文档中某块矩形（画布可视区/切片导出），避免整篇离屏 */
export function compositeRegion(nodes: RNode[], rc: RenderCtx, region: Rect): RasterCanvas {
  const r = normRect(region)
  const canvas = rc.env.createCanvas(Math.max(1, r.w), Math.max(1, r.h))
  const t: PaintTarget = { ctx: canvas.getContext('2d'), ox: r.x, oy: r.y, clip: r }
  paintList(t, nodes, rc)
  return canvas
}

/** 图层/组单独出图（隔离预览与导出），含蒙版与图层样式，外扩区域会保留 */
export function renderIsolated(n: RNode, rc: RenderCtx): { canvas: RasterCanvas; rect: Rect } | null {
  const r =
    n.kind !== 'group'
      ? leafBitmap(n, rc.env)
      : (() => {
          const g = renderGroup(n, rc, null)
          if (!g) return null
          return hasEffects(n.effects)
            ? { canvas: bake(rc.env, g.canvas, g.rect.x, g.rect.y, g.rect, n.effects, 1), rect: g.rect }
            : g
        })()
  if (!r || n.opacity >= 1) return r
  // leafBitmap/renderGroup 都不乘图层不透明度（合成时由 blit 负责），单出需要自己补上
  const out = rc.env.createCanvas(r.canvas.width, r.canvas.height)
  const ctx = out.getContext('2d')
  ctx.globalAlpha = n.opacity
  ctx.drawImage(r.canvas, 0, 0)
  return { canvas: out, rect: r.rect }
}

// ---------------------------------------------------------------- ag-psd → RNode

type UnitsValue = number | { value?: number; units?: string } | undefined

function unit(v: UnitsValue): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object') return typeof v.value === 'number' ? v.value : 0
  return 0
}

type AgColor = { r?: number; g?: number; b?: number } | undefined

function col(c: AgColor): { r: number; g: number; b: number } {
  return { r: c?.r ?? 0, g: c?.g ?? 0, b: c?.b ?? 0 }
}

interface AgShadow {
  enabled?: boolean
  blendMode?: string
  color?: AgColor
  opacity?: number
  angle?: number
  distance?: UnitsValue
  choke?: UnitsValue
  size?: UnitsValue
}

function toShadow(s: AgShadow): ShadowInfo {
  return {
    enabled: !!s.enabled,
    blendMode: s.blendMode ?? 'normal',
    color: col(s.color),
    opacity: s.opacity ?? 1,
    angle: s.angle ?? 120,
    distance: unit(s.distance),
    choke: unit(s.choke),
    size: unit(s.size)
  }
}

function toGlow(s: AgShadow): GlowInfo {
  return {
    enabled: !!s.enabled,
    blendMode: s.blendMode ?? 'screen',
    color: col(s.color),
    opacity: s.opacity ?? 1,
    choke: unit(s.choke),
    size: unit(s.size)
  }
}

interface AgGradientOverlay {
  enabled?: boolean
  blendMode?: string
  opacity?: number
  angle?: number
  reverse?: boolean
  scale?: number
  type?: string
  gradient?: {
    colorStops?: { color?: AgColor; location?: number; midpoint?: number }[]
    opacityStops?: { opacity?: number; location?: number; midpoint?: number }[]
  }
}

function toGradient(g: AgGradientOverlay): GradientInfo {
  return {
    enabled: !!g.enabled,
    blendMode: g.blendMode ?? 'normal',
    opacity: g.opacity ?? 1,
    angle: g.angle ?? 0,
    reverse: !!g.reverse,
    scale: g.scale ?? 100,
    type: g.type ?? 'linear',
    stops: (g.gradient?.colorStops ?? []).map((s) => ({ color: col(s.color), location: s.location ?? 0, midpoint: s.midpoint ?? 0.5 })),
    opacityStops: (g.gradient?.opacityStops ?? []).map((s) => ({ opacity: s.opacity ?? 1, location: s.location ?? 0 }))
  }
}

/** ag-psd 的 Layer 树 → 合成器节点树；id 由 idFor 分配，与 UI 图层树保持一致 */
export function buildRNode(layer: AgLikeLayer, idFor: (l: AgLikeLayer) => number): RNode {
  const children = layer.children?.length ? layer.children.map((c) => buildRNode(c, idFor)) : undefined
  const node: RNode = {
    id: idFor(layer),
    name: layer.name ?? '',
    // 空组仍然是组：ag-psd 只在文件夹节点上给出 children 数组，按数组判断与 UI 图层树的 type 一致
    kind: Array.isArray(layer.children) ? 'group' : 'layer',
    left: layer.left ?? 0,
    top: layer.top ?? 0,
    right: layer.right ?? 0,
    bottom: layer.bottom ?? 0,
    opacity: layer.opacity ?? 1,
    fillOpacity: layer.fillOpacity ?? 1,
    hidden: !!layer.hidden,
    clipping: !!layer.clipping,
    blendMode: layer.blendMode ?? 'normal',
    canvas: (layer.canvas as RasterCanvas | undefined) ?? null,
    mask: layer.mask
      ? {
          left: layer.mask.left ?? 0,
          top: layer.mask.top ?? 0,
          right: layer.mask.right ?? 0,
          bottom: layer.mask.bottom ?? 0,
          defaultColor: layer.mask.defaultColor ?? 0,
          disabled: !!layer.mask.disabled,
          canvas: (layer.mask.canvas as RasterCanvas | undefined) ?? null
        }
      : null,
    shapeLayer: !!layer.vectorFill,
    children
  }
  const e = layer.effects
  if (e) {
    const fx: EffectInfo = {}
    if (e.dropShadow?.length) fx.dropShadow = e.dropShadow.map(toShadow)
    if (e.innerShadow?.length) fx.innerShadow = e.innerShadow.map(toShadow)
    if (e.outerGlow) fx.outerGlow = toGlow(e.outerGlow)
    if (e.innerGlow) fx.innerGlow = toGlow(e.innerGlow)
    if (e.stroke?.length)
      fx.stroke = e.stroke.map((s) => ({
        enabled: !!s.enabled,
        blendMode: s.blendMode ?? 'normal',
        color: col(s.color),
        opacity: s.opacity ?? 1,
        size: unit(s.size),
        position: (s.position ?? 'outside') as 'inside' | 'center' | 'outside'
      }))
    if (e.solidFill?.length)
      fx.solidFill = e.solidFill.map((s) => ({
        enabled: !!s.enabled,
        blendMode: s.blendMode ?? 'normal',
        color: col(s.color),
        opacity: s.opacity ?? 1
      }))
    if (e.gradientOverlay?.length) fx.gradientOverlay = e.gradientOverlay.map(toGradient)
    node.effects = fx
  }
  return node
}

/** buildRNode 需要的 ag-psd Layer 字段子集（避免直接依赖 ag-psd 的具体类型版本） */
export interface AgLikeLayer {
  name?: string
  left?: number
  top?: number
  right?: number
  bottom?: number
  opacity?: number
  fillOpacity?: number
  hidden?: boolean
  clipping?: boolean
  blendMode?: string
  vectorFill?: unknown
  canvas?: unknown
  mask?: {
    left?: number
    top?: number
    right?: number
    bottom?: number
    defaultColor?: number
    disabled?: boolean
    canvas?: unknown
  } | null
  effects?: AgEffects | null
  children?: AgLikeLayer[]
}

export interface AgEffects {
  dropShadow?: AgShadow[]
  innerShadow?: AgShadow[]
  outerGlow?: AgShadow
  innerGlow?: AgShadow
  stroke?: (AgShadow & { position?: string })[]
  solidFill?: { enabled?: boolean; blendMode?: string; color?: AgColor; opacity?: number }[]
  gradientOverlay?: AgGradientOverlay[]
}
