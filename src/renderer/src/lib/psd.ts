import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { PsdDoc, PsdLayer } from '@/types'
import { compositeDocument, renderIsolated, type Env, type RNode } from './compositor'
import { toRNodes, type LayerBitmap } from './psdDecode'

export type { LayerBitmap } from './psdDecode'
export { decodeLayerCanvases } from './psdDecode'

// PSD 字节读取：走主进程注册的 psdfile:// 流式协议直取，
// 替代旧的 ipcRenderer.invoke('psd:read')（240MB 结构化克隆双拷贝 ≈2.3s）。
// 固定 host 段 f + 路径分段编码：standard scheme 会把首段当 host，盘符编码后解析失败
export async function fetchPsdFile(path: string): Promise<{ name: string; buffer: Uint8Array }> {
  const segs = path.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join('/')
  const res = await fetch(`psdfile://f/${segs}`)
  if (!res.ok) throw new Error(`psdfile ${res.status}`)
  const buffer = new Uint8Array(await res.arrayBuffer())
  const name = path.split(/[\\/]/).pop() ?? path
  return { name, buffer }
}

export interface ParseResult {
  doc: PsdDoc
  tree: PsdLayer[]
  /** 图层原始位图（未烘焙蒙版/样式），供取色与命中测试使用 */
  canvasMap: Map<number, LayerBitmap>
  /** 与 tree 同 id 的合成器节点树，预览与导出都以它为准 */
  rnodes: RNode[]
  /** PSD 内嵌合成图：两阶段加载中解码完成前画布的即时预览源 */
  composite?: HTMLCanvasElement | null
}

let nextId = 1

/** 浏览器侧的合成器环境：所有离屏画布都用 DOM canvas 实现 */
export const browserEnv: Env = {
  createCanvas(w, h) {
    const c = document.createElement('canvas')
    c.width = Math.max(1, w)
    c.height = Math.max(1, h)
    // 先按 willReadFrequently 建上下文：合成器会大量 getImageData/putImageData，
    // 让 Chrome 把这些离屏画布放在 CPU 后端，避免每次读回像素都走 GPU 同步回读
    c.getContext('2d', { willReadFrequently: true })
    return c
  },
}

// ag-psd 的文本内容在 text.text，字体名在 text.style.font.name，
// fillColor 一般为 0~255，个别文件为 0~1，统一归一化
function readTextInfo(text: unknown): PsdLayer['textInfo'] {
  if (!text || typeof text !== 'object') return undefined
  const t = text as {
    text?: string
    content?: string
    style?: Record<string, unknown>
    styles?: Record<string, unknown>[]
  }
  const st = t.style ?? t.styles?.[0] ?? {}
  const fc = st.fillColor as { r?: number; g?: number; b?: number } | undefined
  let color: string | undefined
  if (fc && typeof fc.r === 'number') {
    const to255 = (v: number) => (v <= 1 ? Math.round(v * 255) : Math.round(v))
    color = `#${[fc.r ?? 0, fc.g ?? 0, fc.b ?? 0]
      .map((v) => to255(v).toString(16).padStart(2, '0'))
      .join('')}`.toUpperCase()
  }
  const fontName = (st.fontName ?? (st.font as { name?: string } | undefined)?.name) as
    | string
    | undefined
  const weight = (st.fontWeight ?? st.syntheticBold) as number | boolean | undefined
  const isBold =
    weight === true ||
    (typeof weight === 'number' && weight >= 700) ||
    /bold|heavy|black|-b\b/i.test(fontName ?? '')
  return {
    content: t.text ?? t.content ?? '',
    fontSize: typeof st.fontSize === 'number' ? Math.round(st.fontSize) : undefined,
    color,
    fontFamily: fontName,
    fontWeight: isBold ? 'bold' : 'normal',
    leading: typeof st.leading === 'number' ? st.leading : undefined,
    tracking: typeof st.tracking === 'number' ? st.tracking : undefined
  }
}

// ag-psd 的组节点 bounds 常常是 0，需要由子图层并集推算
function groupBounds(children: PsdLayer[]): { left: number; top: number; width: number; height: number } | null {
  let l = Infinity
  let t = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const c of children) {
    if (!(c.width > 0) || !(c.height > 0)) continue
    l = Math.min(l, c.left)
    t = Math.min(t, c.top)
    r = Math.max(r, c.left + c.width)
    b = Math.max(b, c.top + c.height)
  }
  if (l === Infinity) return null
  return { left: l, top: t, width: r - l, height: b - t }
}

/**
 * 图层的跨会话标识。PSD 内部 id 只在 ag-psd 主解析器里有，
 * 所以缺 lyid 的文件退回「同级序号路径」——序号在两个解析器里都按自底向上计，
 * 保证同一图层两边算出同一个 key；类型从 i 变 p 时旧编辑会整体失效而不是贴错图层。
 */
function layerKey(lyid: number | undefined, path: string): string {
  return typeof lyid === 'number' ? `i${lyid}` : `p${path}`
}

function toNode(
  layer: Layer,
  canvasMap: Map<number, LayerBitmap>,
  ids: WeakMap<Layer, number>,
  path: string
): PsdLayer {
  const id = nextId++
  ids.set(layer, id)
  if (layer.canvas) canvasMap.set(id, layer.canvas)
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const children = layer.children?.length
    ? layer.children.map((c, i) => toNode(c, canvasMap, ids, `${path}.${i}`))
    : undefined
  const gb = children ? groupBounds(children) : null
  return {
    id,
    key: layerKey(layer.id, path),
    name: layer.name?.trim() || (layer.children ? '未命名组' : '未命名图层'),
    type: layer.children ? 'group' : 'layer',
    left: gb?.left ?? left,
    top: gb?.top ?? top,
    width: gb?.width ?? (layer.right ?? left) - left,
    height: gb?.height ?? (layer.bottom ?? top) - top,
    // ag-psd v29 的 opacity 已归一化为 0~1，不要再除以 255
    opacity: layer.opacity ?? 1,
    hidden: !!layer.hidden,
    isText: !!layer.text,
    textInfo: readTextInfo(layer.text),
    clipping: !!layer.clipping,
    blendMode: layer.blendMode ?? 'normal',
    children
  }
}

// toRNodes / decodeLayerCanvases 在 psdDecode.ts（Worker 侧共用）

export function indexRNodes(nodes: RNode[], out = new Map<number, RNode>()): Map<number, RNode> {
  for (const n of nodes) {
    out.set(n.id, n)
    if (n.children) indexRNodes(n.children, out)
  }
  return out
}

// 图层位图像素读取：DOM canvas 直读；Worker 回传的 ImageBitmap 借一块复用小画布中转。
// 仅主线程命中测试/取色用，区域都很小，中转成本可忽略
let readScratch: HTMLCanvasElement | null = null
export function readLayerPixels(
  img: LayerBitmap,
  x: number,
  y: number,
  w: number,
  h: number
): ImageData | null {
  if (img instanceof HTMLCanvasElement) {
    try {
      return img.getContext('2d')?.getImageData(x, y, w, h) ?? null
    } catch {
      return null
    }
  }
  if (!readScratch) {
    readScratch = document.createElement('canvas')
    readScratch.getContext('2d', { willReadFrequently: true })
  }
  readScratch.width = w
  readScratch.height = h
  const ctx = readScratch.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * 图层位图的「可见内容」度量：PSD 位图边界常比真实图形大一圈（透明留白/抗锯齿），
 * 面板要显示用户眼中的实际尺寸、还要显示 PSD 自带的圆角，都只能从 alpha 反推。
 * 只扫四条边缘带（≤64px）与左上角一小段，大层也是毫秒级；结果按位图对象 WeakMap 缓存。
 */
export interface LayerContent {
  /** 位图原始宽高（编辑重采样时的换算基准） */
  bw: number
  bh: number
  /** 不透明内容包围盒：宽 / 高 / 距位图左沿 / 距位图顶沿 */
  cw: number
  ch: number
  padL: number
  padT: number
  /** 左上角圆角半径估算（<3px 视为 0） */
  radius: number
}

const contentCache = new WeakMap<LayerBitmap, LayerContent | null>()

export function measureLayerContent(img: LayerBitmap): LayerContent | null {
  const hit = contentCache.get(img)
  if (hit !== undefined) return hit
  const computed = computeLayerContent(img)
  contentCache.set(img, computed)
  return computed
}

/** 图层「可见内容」的文档坐标矩形：位图边界常含透明留白，UI 展示/选框统一用这个 */
export function measureContentRect(
  layer: PsdLayer,
  canvasMap: Map<number, LayerBitmap>
): { left: number; top: number; width: number; height: number } | null {
  if (layer.children) return null
  const c = canvasMap.get(layer.id)
  const m = c ? measureLayerContent(c) : null
  if (!m || !(m.bw > 0) || !(m.bh > 0)) return null
  const sx = layer.width / m.bw
  const sy = layer.height / m.bh
  return {
    left: layer.left + m.padL * sx,
    top: layer.top + m.padT * sy,
    width: Math.max(1, Math.round(m.cw * sx)),
    height: Math.max(1, Math.round(m.ch * sy))
  }
}

function computeLayerContent(img: LayerBitmap): LayerContent | null {
  const ALPHA_T = 8
  const BAND = 64
  const bw = img.width
  const bh = img.height
  if (!(bw > 0 && bh > 0)) return null
  const strip = (x: number, y: number, w: number, h: number): Uint8ClampedArray | null => {
    const d = readLayerPixels(img, x, y, w, h)
    return d ? d.data : null
  }
  const alphaAt = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3]
  const rowOpaque = (d: Uint8ClampedArray, w: number, y: number) => {
    for (let x = 0; x < w; x++) if (alphaAt(d, w, x, y) > ALPHA_T) return true
    return false
  }
  const colOpaque = (d: Uint8ClampedArray, w: number, x: number, y0: number, y1: number) => {
    for (let y = y0; y <= y1; y++) if (alphaAt(d, w, x, y) > ALPHA_T) return true
    return false
  }
  const bandH = Math.min(bh, BAND)
  const topStrip = strip(0, 0, bw, bandH)
  if (!topStrip) return null
  let padT = 0
  while (padT < bandH && !rowOpaque(topStrip, bw, padT)) padT++
  let padB = 0
  if (padT < bh) {
    const botH = Math.min(bh - padT, bandH)
    const botStrip = strip(0, bh - botH, bw, botH)
    if (botStrip) {
      padB = botH - 1
      while (padB > 0 && !rowOpaque(botStrip, bw, padB)) padB--
      padB = botH - 1 - padB
    }
  }
  const contentH = bh - padT - padB
  if (contentH <= 0) return null
  const bandW = Math.min(bw, BAND)
  let padL = 0
  const leftStrip = strip(0, padT, bandW, contentH)
  if (leftStrip) {
    while (padL < bandW && !colOpaque(leftStrip, bandW, padL, 0, contentH - 1)) padL++
  }
  let padR = 0
  const rightW = Math.min(bw - padL, bandW)
  if (rightW > 0) {
    const rightStrip = strip(bw - rightW, padT, rightW, contentH)
    if (rightStrip) {
      padR = rightW - 1
      while (padR > 0 && !colOpaque(rightStrip, rightW, padR, 0, contentH - 1)) padR--
      padR = rightW - 1 - padR
    }
  }
  const contentW = bw - padL - padR
  if (contentW <= 0) return null
  // 圆角估算：PS 的半径值 = 圆弧与两条直边的切点距离，也就是「内容框顶行的第一个不透明像素离左缘多远」
  // （等价地，「左列第一个不透明像素离顶缘多远」）。柔边/平滑圆角会让弧中段比标准圆更满，
  // 但两个切点读数与 PS 面板里的半径一致，所以只量切点、不做弧拟合。
  let radius = 0
  const cornerW = Math.min(contentW, BAND)
  const cornerH = Math.min(contentH, BAND)
  const corner = strip(padL, padT, cornerW, cornerH)
  if (corner) {
    let xt = -1
    for (let x = 0; x < cornerW; x++)
      if (alphaAt(corner, cornerW, x, 0) > 128) {
        xt = x
        break
      }
    let yt = -1
    for (let y = 0; y < cornerH; y++)
      if (alphaAt(corner, cornerW, 0, y) > 128) {
        yt = y
        break
      }
    const cuts = [xt, yt].filter((v) => v >= 0)
    if (cuts.length) {
      const est = Math.round(cuts.reduce((a, b) => a + b, 0) / cuts.length)
      radius = est >= 3 ? est : 0
    }
  }
  return { bw, bh, cw: contentW, ch: contentH, padL, padT, radius }
}

/**
 * Worker 回传的 ImageBitmap 只能当临时载体：实测其解码缓存会在数秒内被丢弃，
 * 位图变成全透明但 width/height 不变。收到后立刻逐张拷成 DOM canvas 作为长期
 * 像素存储（同一实例只拷一次，保持 rnode 与 canvasMap 的引用一致）。
 * 每张位图先收齐全部引用槽位，拷完立即 close：大文档像素总量可达 GB 级，
 * 若像旧实现那样全部拷完再统一 close，bitmap+canvas 两份像素会同时存在，峰值翻倍直接把渲染进程压崩。
 * 拷贝按像素量分帧：整段同步拷会在解码完成瞬间冻结主线程数百毫秒到数秒，
 * 每拷约 8M 像素（32MB）让出主线程一拍，总耗时不变但入场动画不再被卡住；
 * isDead 返回 true 时提前放弃（页面已离开，剩余位图交给 GC）。
 */
export async function materializeBitmaps(
  rnodes: RNode[],
  canvasMap: Map<number, LayerBitmap>,
  isDead?: () => boolean
): Promise<void> {
  const slots = new Map<ImageBitmap, ((c: HTMLCanvasElement) => void)[]>()
  const add = (b: ImageBitmap, set: (c: HTMLCanvasElement) => void): void => {
    const list = slots.get(b)
    if (list) list.push(set)
    else slots.set(b, [set])
  }
  const walk = (ns: RNode[]): void => {
    for (const n of ns) {
      if (n.canvas instanceof ImageBitmap) {
        const b = n.canvas
        add(b, (c) => (n.canvas = c))
      }
      const mb = n.mask?.canvas
      if (mb instanceof ImageBitmap) {
        const m = n.mask!
        add(mb, (c) => (m.canvas = c))
      }
      if (n.children) walk(n.children)
    }
  }
  walk(rnodes)
  for (const [id, b] of canvasMap) {
    if (b instanceof ImageBitmap) add(b, (c) => void canvasMap.set(id, c))
  }
  const CHUNK_PIXELS = 1 << 23
  let chunk = 0
  for (const [b, sets] of slots) {
    if (isDead?.()) return
    const w = b.width
    const h = b.height
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')?.drawImage(b, 0, 0)
    for (const set of sets) set(c)
    b.close()
    chunk += w * h
    if (chunk >= CHUNK_PIXELS) {
      chunk = 0
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

/**
 * 缓存载入的图层树沿用了历史节点 id：把模块级 nextId 推到其上，
 * 避免同会话内后续解析（备用解析器等）分配出与缓存树冲突的 id。
 */
export function adoptLayerIds(nodes: PsdLayer[]): void {
  const walk = (n: PsdLayer): void => {
    if (n.id >= nextId) nextId = n.id + 1
    n.children?.forEach(walk)
  }
  nodes.forEach(walk)
}

export function parsePsd(buffer: Uint8Array, fileName: string, structureOnly = false): ParseResult {
  const psd: Psd = readPsd(buffer, {
    skipLinkedFilesData: true,
    skipThumbnail: true,
    // 结构阶段跳过逐层位图（大头），但保留内嵌合成图（~76ms）供解码完成前即时预览
    ...(structureOnly ? { skipLayerImageData: true } : {})
  })
  const canvasMap = new Map<number, LayerBitmap>()
  const ids = new WeakMap<Layer, number>()
  const layers = psd.children ?? []
  let tree: PsdLayer[] = layers.map((l, i) => toNode(l, canvasMap, ids, String(i)))
  let rnodes = toRNodes(layers, ids)
  if (tree.length === 0 && psd.canvas) {
    const id = nextId++
    canvasMap.set(id, psd.canvas)
    tree = [
      {
        id,
        key: 'p0',
        name: fileName,
        type: 'layer',
        left: 0,
        top: 0,
        width: psd.width,
        height: psd.height,
        opacity: 1,
        hidden: false,
        isText: false,
        clipping: false,
        blendMode: 'normal'
      }
    ]
    rnodes = [
      {
        id,
        name: fileName,
        kind: 'layer',
        left: 0,
        top: 0,
        right: psd.width,
        bottom: psd.height,
        opacity: 1,
        fillOpacity: 1,
        hidden: false,
        clipping: false,
        blendMode: 'normal',
        canvas: psd.canvas
      }
    ]
  }
  return {
    doc: { fileName, width: psd.width, height: psd.height },
    tree,
    canvasMap,
    rnodes,
    composite: psd.canvas ?? null
  }
}

export function flattenLayers(nodes: PsdLayer[], out: PsdLayer[] = []): PsdLayer[] {  for (const n of nodes) {
    out.push(n)
    if (n.children) flattenLayers(n.children, out)
  }
  return out
}

// ========== 画布合成（CanvasView 与切片导出共用） ==========
// 统一走 compositor.ts：与 Node 侧像素回归同一份实现，保证「所见 = 所导出 = 基线」
export function buildCompositeCanvas(
  doc: PsdDoc,
  rnodes: RNode[],
  hiddenIds: Set<number>
): HTMLCanvasElement {
  return compositeDocument(rnodes, { env: browserEnv, hiddenIds }, {
    width: doc.width,
    height: doc.height
  }) as HTMLCanvasElement
}

// 图层（或组合成图）→ 以图层范围裁剪的画布，供预览与导出共用。
// 裁剪框取「图层 rect ∪ 烘焙 rect」：外描边、投影这类溢出图层边界的效果必须一起出图，
// 没有外扩时两者相同，出图尺寸与旧版逐像素一致。
export function renderLayerCanvas(
  layer: PsdLayer,
  rnodes: RNode[],
  hiddenIds: Set<number>
): HTMLCanvasElement | null {
  const node = indexRNodes(rnodes).get(layer.id)
  if (!node) return null
  const r = renderIsolated(node, { env: browserEnv, hiddenIds })
  if (!r) return null
  const x = Math.min(layer.left, r.rect.x)
  const y = Math.min(layer.top, r.rect.y)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(Math.max(layer.left + layer.width, r.rect.x + r.rect.w) - x))
  out.height = Math.max(1, Math.round(Math.max(layer.top + layer.height, r.rect.y + r.rect.h) - y))
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(r.canvas as unknown as HTMLCanvasElement, Math.round(r.rect.x - x), Math.round(r.rect.y - y))
  return out
}

// ========== 备用解析器（@webtoon/psd）：主解析器失败时兜底，支持 ZIP 压缩等 ag-psd 不支持的文件 ==========
const WEBTOON_BLEND_TO_AG: Record<string, string> = {
  pass: 'normal', norm: 'normal', diss: 'dissolve', dark: 'darken',
  'mul ': 'multiply', idiv: 'color burn', lbrn: 'linear burn', dkCl: 'darker color',
  lite: 'lighten', scrn: 'screen', 'div ': 'color dodge', lddg: 'linear dodge',
  lgCl: 'lighter color', over: 'overlay', sLit: 'soft light', hLit: 'hard light',
  vLit: 'vivid light', lLit: 'linear light', pLit: 'pin light', hMix: 'hard mix',
  diff: 'difference', smud: 'exclusion', fsub: 'subtract', fdiv: 'divide',
  'hue ': 'hue', 'sat ': 'saturation', colr: 'color', 'lum ': 'luminosity'
}

export async function parsePsdFallback(buffer: Uint8Array, fileName: string): Promise<ParseResult> {
  const mod = await import('@webtoon/psd')
  const Psd = mod.default
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
  const psd = Psd.parse(ab)
  const canvasMap = new Map<number, LayerBitmap>()

  // webtoon 的 children 是自上而下（顶层在前），与 ag-psd 相反；
  // 逆序遍历，统一成自底向上，保证绘制顺序与剪贴链语义一致
  const walk = async (nodes: any[], path: string): Promise<{ layers: PsdLayer[]; rnodes: RNode[] }> => {
    const out: PsdLayer[] = []
    const rnodes: RNode[] = []
    for (let k = nodes.length - 1; k >= 0; k--) {
      const node = nodes[k]
      const id = nextId++
      // 同级序号按「自底向上」编号，与主解析器的路径 key 对齐
      const selfPath = path + (nodes.length - 1 - k)
      const left = node.left ?? 0
      const top = node.top ?? 0
      const width = node.width ?? 0
      const height = node.height ?? 0
      let canvas: HTMLCanvasElement | undefined
      if (node.type === 'Layer' && width > 0 && height > 0) {
        try {
          const rgba = await node.composite(false, true)
          canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const cctx = canvas.getContext('2d')!
          cctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
          canvasMap.set(id, canvas)
        } catch {
          // 单层渲染失败时跳过该层位图
        }
      }
      const sub = node.children ? await walk(node.children, selfPath + '.') : null
      const children = sub?.layers
      const name = node.name || (node.type === 'Group' ? '未命名组' : '未命名图层')
      const blendMode = WEBTOON_BLEND_TO_AG[(node.blendMode as string) ?? 'norm'] ?? 'normal'
      const hidden = !!node.isHidden
      const clipping = node.clipping === 1
      const opacity = typeof node.opacity === 'number' ? node.opacity / 255 : 1
      const gb = children?.length ? groupBounds(children) : null
      const bx = gb?.left ?? left
      const by = gb?.top ?? top
      const bw = gb?.width ?? width
      const bh = gb?.height ?? height
      rnodes.push(
        children
          ? { id, name, kind: 'group', left: bx, top: by, right: bx + bw, bottom: by + bh, opacity, fillOpacity: 1, hidden, clipping, blendMode, children: sub!.rnodes }
          : { id, name, kind: 'layer', left, top, right: left + width, bottom: top + height, opacity, fillOpacity: 1, hidden, clipping, blendMode, canvas: canvas ?? null }
      )
      out.push({
        id,
        key: 'p' + selfPath,
        name,
        type: node.type === 'Group' ? 'group' : 'layer',
        left: bx,
        top: by,
        width: bw,
        height: bh,
        opacity,
        hidden,
        isText: !!node.text,
        textInfo: node.text
          ? {
              content: typeof node.text === 'string' ? node.text : (node.text.text ?? ''),
              fontSize: node.text.fontSize,
              color: node.text.color
                ? `#${[node.text.color.r, node.text.color.g, node.text.color.b]
                    .map((v: number) => Math.round((v <= 1 ? v * 255 : v)).toString(16).padStart(2, '0'))
                    .join('')}`.toUpperCase()
                : undefined
            }
          : undefined,
        clipping,
        blendMode,
        // 必须复用上面已 walk 的结果：再 walk 一次会生成新 id，与 canvasMap 错位
        children
      })
    }
    return { layers: out, rnodes }
  }

  const { layers: tree, rnodes } = await walk(psd.children ?? [], '')
  if (tree.length === 0) throw new Error('备用解析器：未找到图层')
  return {
    doc: { fileName, width: psd.width, height: psd.height },
    tree,
    canvasMap,
    rnodes
  }
}

