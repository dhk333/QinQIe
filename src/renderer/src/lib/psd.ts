import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { PsdDoc, PsdLayer } from '@/types'

export interface ParseResult {
  doc: PsdDoc
  tree: PsdLayer[]
  canvasMap: Map<number, HTMLCanvasElement>
}

let nextId = 1

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
    fontWeight: isBold ? 'bold' : 'normal'
  }
}

// ag-psd 的 mask.canvas 用 RGB 明度编码蒙版（alpha 恒为 255），
// 这里转成 alpha 并烘焙进图层 canvas，mask 矩形之外的区域用 defaultColor 填充
function bakeMask(layer: Layer): HTMLCanvasElement | null {
  const mask = layer.mask
  if (!mask || mask.disabled || !layer.canvas) return null
  const l = layer.left ?? 0
  const t = layer.top ?? 0
  const mL = mask.left ?? 0
  const mT = mask.top ?? 0
  const uL = Math.min(mL, l)
  const uT = Math.min(mT, t)
  const uR = Math.max(mask.right ?? mL, (layer.right ?? 0))
  const uB = Math.max(mask.bottom ?? mT, (layer.bottom ?? 0))
  const uw = Math.max(1, uR - uL)
  const uh = Math.max(1, uB - uT)

  const plane = document.createElement('canvas')
  plane.width = uw
  plane.height = uh
  const pctx = plane.getContext('2d')!
  const def = mask.defaultColor ?? 0
  pctx.fillStyle = `rgb(${def},${def},${def})`
  pctx.fillRect(0, 0, uw, uh)
  if (mask.canvas) pctx.drawImage(mask.canvas, mL - uL, mT - uT)

  const img = pctx.getImageData(0, 0, uw, uh)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i]
    d[i] = 255
    d[i + 1] = 255
    d[i + 2] = 255
  }
  pctx.putImageData(img, 0, 0)

  const out = document.createElement('canvas')
  out.width = layer.canvas.width
  out.height = layer.canvas.height
  const octx = out.getContext('2d')!
  octx.drawImage(layer.canvas, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(plane, uL - l, uT - t)
  return out
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

function toNode(layer: Layer, canvasMap: Map<number, HTMLCanvasElement>): PsdLayer {
  const id = nextId++
  const canvas = layer.canvas
  if (canvas) canvasMap.set(id, canvas)
  const baked = bakeMask(layer)
  if (baked) canvasMap.set(id, baked)
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const children = layer.children?.length ? layer.children.map((c) => toNode(c, canvasMap)) : undefined
  const gb = children ? groupBounds(children) : null
  return {
    id,
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

export function parsePsd(buffer: Uint8Array, fileName: string, structureOnly = false): ParseResult {
  const psd: Psd = readPsd(buffer, {
    skipLinkedFilesData: true,
    skipThumbnail: true,
    // 结构阶段跳过全部图层位图，仅取树/文本/显隐/bounds（~50ms）
    ...(structureOnly ? { skipLayerImageData: true, skipCompositeImageData: true } : {})
  })
  // 无图层树的扁平 PSD 只能靠合成图，结构阶段跳过合成会取不到位图，直接全量解析
  if (structureOnly && (psd.children ?? []).length === 0) return parsePsd(buffer, fileName)
  const canvasMap = new Map<number, HTMLCanvasElement>()
  let tree: PsdLayer[] = (psd.children ?? []).map((l) => toNode(l, canvasMap))
  if (tree.length === 0 && psd.canvas) {
    const id = nextId++
    canvasMap.set(id, psd.canvas)
    tree = [
      {
        id,
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
  }
  return { doc: { fileName, width: psd.width, height: psd.height }, tree, canvasMap }
}

// 两阶段加载的第二步：全量解码位图，按 parsePsd(structureOnly) 生成的树位置对齐，
// 把 canvas 填进以既有节点 id 为键的 canvasMap，保证选中/显隐状态不失效
export function decodeLayerCanvases(
  buffer: Uint8Array,
  tree: PsdLayer[]
): Map<number, HTMLCanvasElement> {
  const psd: Psd = readPsd(buffer, { skipLinkedFilesData: true, skipThumbnail: true })
  const canvasMap = new Map<number, HTMLCanvasElement>()
  const attach = (layers: Layer[], nodes: PsdLayer[]) => {
    for (let i = 0; i < layers.length && i < nodes.length; i++) {
      const layer = layers[i]
      const node = nodes[i]
      if (node.type === 'group') {
        if (layer.children?.length && node.children) attach(layer.children, node.children)
        continue
      }
      if (layer.canvas) {
        const baked = bakeMask(layer)
        canvasMap.set(node.id, baked ?? layer.canvas)
      }
    }
  }
  attach(psd.children ?? [], tree)
  return canvasMap
}

export function flattenLayers(nodes: PsdLayer[], out: PsdLayer[] = []): PsdLayer[] {
  for (const n of nodes) {
    out.push(n)
    if (n.children) flattenLayers(n.children, out)
  }
  return out
}

// ========== 画布合成（CanvasView 与切片导出共用） ==========
// children 为自底向上顺序（背景层在前），按数组原序绘制
const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'lighter'
}

export interface DrawContext {
  canvasMap: Map<number, HTMLCanvasElement>
  hiddenIds: Set<number>
}

function drawSingleLayer(ctx: CanvasRenderingContext2D, node: PsdLayer, dc: DrawContext, blend = true) {
  if (node.hidden || dc.hiddenIds.has(node.id)) return
  const canvas = dc.canvasMap.get(node.id)
  if (!canvas || node.width === 0 || node.height === 0) return
  ctx.save()
  ctx.globalAlpha = node.opacity
  if (blend) ctx.globalCompositeOperation = BLEND_MAP[node.blendMode] ?? 'source-over'
  ctx.drawImage(canvas, node.left, node.top, node.width, node.height)
  ctx.restore()
}

export function drawSiblings(ctx: CanvasRenderingContext2D, nodes: PsdLayer[], dc: DrawContext) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.children) {
      drawSiblings(ctx, node.children, dc)
      continue
    }
    if (node.hidden || dc.hiddenIds.has(node.id)) continue

    // 剪贴蒙版：连续 clipping 的图层被裁切到其下方基础图层的不透明区域
    const clipped: PsdLayer[] = []
    let j = i + 1
    while (j < nodes.length && nodes[j].clipping && !nodes[j].children) {
      clipped.push(nodes[j])
      j++
    }

    if (clipped.length === 0) {
      drawSingleLayer(ctx, node, dc)
      continue
    }

    const visibleClipped = clipped.filter(
      (c) => !c.hidden && !dc.hiddenIds.has(c.id) && dc.canvasMap.has(c.id)
    )
    if (visibleClipped.length === 0) {
      drawSingleLayer(ctx, node, dc)
      i = j - 1
      continue
    }

    const left = Math.min(node.left, ...visibleClipped.map((c) => c.left))
    const top = Math.min(node.top, ...visibleClipped.map((c) => c.top))
    const right = Math.max(node.left + node.width, ...visibleClipped.map((c) => c.left + c.width))
    const bottom = Math.max(node.top + node.height, ...visibleClipped.map((c) => c.top + c.height))
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, right - left)
    tmp.height = Math.max(1, bottom - top)
    const tctx = tmp.getContext('2d')!

    const base = { ...node, left: node.left - left, top: node.top - top }
    drawSingleLayer(tctx, base, dc, false)
    for (const c of visibleClipped) {
      drawSingleLayer(tctx, { ...c, left: c.left - left, top: c.top - top }, dc)
    }
    tctx.globalCompositeOperation = 'destination-in'
    tctx.globalAlpha = 1
    const baseCanvas = dc.canvasMap.get(node.id)!
    tctx.drawImage(baseCanvas, node.left - left, node.top - top, node.width, node.height)

    ctx.save()
    ctx.globalAlpha = node.opacity
    ctx.drawImage(tmp, left, top)
    ctx.restore()
    i = j - 1
  }
}

export function buildCompositeCanvas(
  doc: PsdDoc,
  tree: PsdLayer[],
  canvasMap: Map<number, HTMLCanvasElement>,
  hiddenIds: Set<number>
): HTMLCanvasElement | null {
  const c = document.createElement('canvas')
  c.width = Math.max(1, doc.width)
  c.height = Math.max(1, doc.height)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  drawSiblings(ctx, tree, { canvasMap, hiddenIds })
  return c
}

// 图层（或组合成图）→ 以图层自身范围裁剪的画布，供预览与导出共用
export function renderLayerCanvas(
  layer: PsdLayer,
  doc: PsdDoc,
  canvasMap: Map<number, HTMLCanvasElement>,
  hiddenIds: Set<number>
): HTMLCanvasElement | null {
  if (!layer.children?.length) return canvasMap.get(layer.id) ?? null
  if (!(layer.width > 0) || !(layer.height > 0)) return null
  const comp = buildCompositeCanvas(doc, layer.children, canvasMap, hiddenIds)
  if (!comp) return null
  const out = document.createElement('canvas')
  out.width = Math.round(layer.width)
  out.height = Math.round(layer.height)
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(comp, layer.left, layer.top, out.width, out.height, 0, 0, out.width, out.height)
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
  const canvasMap = new Map<number, HTMLCanvasElement>()

  // webtoon 的 children 是自上而下（顶层在前），与 ag-psd 相反；
  // 逆序遍历，统一成自底向上，保证绘制顺序与剪贴链语义一致
  const walk = async (nodes: any[]): Promise<PsdLayer[]> => {
    const out: PsdLayer[] = []
    for (let k = nodes.length - 1; k >= 0; k--) {
      const node = nodes[k]
      const id = nextId++
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
      const children = node.children ? await walk(node.children) : undefined
      const gb = children?.length ? groupBounds(children) : null
      out.push({
        id,
        name: node.name || (node.type === 'Group' ? '未命名组' : '未命名图层'),
        type: node.type === 'Group' ? 'group' : 'layer',
        left: gb?.left ?? left,
        top: gb?.top ?? top,
        width: gb?.width ?? width,
        height: gb?.height ?? height,
        opacity: typeof node.opacity === 'number' ? node.opacity / 255 : 1,
        hidden: !!node.isHidden,
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
        clipping: node.clipping === 1,
        blendMode: WEBTOON_BLEND_TO_AG[(node.blendMode as string) ?? 'norm'] ?? 'normal',
        // 必须复用上面已 walk 的结果：再 walk 一次会生成新 id，与 canvasMap 错位
        children
      })
    }
    return out
  }

  const tree = await walk(psd.children ?? [])
  if (tree.length === 0) throw new Error('备用解析器：未找到图层')
  return {
    doc: { fileName, width: psd.width, height: psd.height },
    tree,
    canvasMap
  }
}
