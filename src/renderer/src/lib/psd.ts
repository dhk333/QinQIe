import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { PsdDoc, PsdLayer } from '@/types'
import {
  buildRNode,
  compositeDocument,
  renderIsolated,
  type Env,
  type RNode
} from './compositor'

export interface ParseResult {
  doc: PsdDoc
  tree: PsdLayer[]
  /** 图层原始位图（未烘焙蒙版/样式），供取色与命中测试使用 */
  canvasMap: Map<number, HTMLCanvasElement>
  /** 与 tree 同 id 的合成器节点树，预览与导出都以它为准 */
  rnodes: RNode[]
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
  }
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

function toNode(layer: Layer, canvasMap: Map<number, HTMLCanvasElement>, ids: WeakMap<Layer, number>): PsdLayer {
  const id = nextId++
  ids.set(layer, id)
  if (layer.canvas) canvasMap.set(id, layer.canvas)
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const children = layer.children?.length ? layer.children.map((c) => toNode(c, canvasMap, ids)) : undefined
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

/** 用 PsdLayer 树的 id 反推合成器节点树，保证选中/显隐状态两边通用 */
function toRNodes(layers: Layer[], ids: WeakMap<Layer, number>): RNode[] {
  return layers.map((l) =>
    buildRNode(l as unknown as Parameters<typeof buildRNode>[0], (x) => ids.get(x as Layer) ?? 0)
  )
}

export function indexRNodes(nodes: RNode[], out = new Map<number, RNode>()): Map<number, RNode> {
  for (const n of nodes) {
    out.set(n.id, n)
    if (n.children) indexRNodes(n.children, out)
  }
  return out
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
  const ids = new WeakMap<Layer, number>()
  const layers = psd.children ?? []
  let tree: PsdLayer[] = layers.map((l) => toNode(l, canvasMap, ids))
  let rnodes = toRNodes(layers, ids)
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
  return { doc: { fileName, width: psd.width, height: psd.height }, tree, canvasMap, rnodes }
}

// 两阶段加载的第二步：全量解码位图，按 parsePsd(structureOnly) 生成的树位置对齐，
// 把 canvas 填进以既有节点 id 为键的 canvasMap，并用同一批 id 重建合成器节点树
export function decodeLayerCanvases(
  buffer: Uint8Array,
  tree: PsdLayer[]
): { canvasMap: Map<number, HTMLCanvasElement>; rnodes: RNode[] } {
  const psd: Psd = readPsd(buffer, { skipLinkedFilesData: true, skipThumbnail: true })
  const canvasMap = new Map<number, HTMLCanvasElement>()
  const ids = new WeakMap<Layer, number>()
  const attach = (layers: Layer[], nodes: PsdLayer[]) => {
    for (let i = 0; i < layers.length && i < nodes.length; i++) {
      const layer = layers[i]
      const node = nodes[i]
      ids.set(layer, node.id)
      if (node.type === 'group') {
        if (layer.children?.length && node.children) attach(layer.children, node.children)
        continue
      }
      if (layer.canvas) canvasMap.set(node.id, layer.canvas)
    }
  }
  const layers = psd.children ?? []
  attach(layers, tree)
  return { canvasMap, rnodes: toRNodes(layers, ids) }
}

export function flattenLayers(nodes: PsdLayer[], out: PsdLayer[] = []): PsdLayer[] {
  for (const n of nodes) {
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

// 图层（或组合成图）→ 以图层自身范围裁剪的画布，供预览与导出共用
export function renderLayerCanvas(
  layer: PsdLayer,
  rnodes: RNode[],
  hiddenIds: Set<number>
): HTMLCanvasElement | null {
  const node = indexRNodes(rnodes).get(layer.id)
  if (!node) return null
  const r = renderIsolated(node, { env: browserEnv, hiddenIds })
  if (!r) return null
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(layer.width))
  out.height = Math.max(1, Math.round(layer.height))
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(r.canvas as unknown as HTMLCanvasElement, Math.round(r.rect.x - layer.left), Math.round(r.rect.y - layer.top))
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
  const walk = async (nodes: any[]): Promise<{ layers: PsdLayer[]; rnodes: RNode[] }> => {
    const out: PsdLayer[] = []
    const rnodes: RNode[] = []
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
      const sub = node.children ? await walk(node.children) : null
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

  const { layers: tree, rnodes } = await walk(psd.children ?? [])
  if (tree.length === 0) throw new Error('备用解析器：未找到图层')
  return {
    doc: { fileName, width: psd.width, height: psd.height },
    tree,
    canvasMap,
    rnodes
  }
}
