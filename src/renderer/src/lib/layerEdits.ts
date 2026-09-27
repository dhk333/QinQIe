import type { LayerEdit, PsdLayer } from '@/types'
import type { EffectInfo, RNode, ShadowInfo, StrokeInfo } from './compositor'

/** 一份 PSD 的全部图层编辑量，按 PsdLayer.key 索引，随项目 JSON 持久化 */
export type LayerEdits = Record<string, LayerEdit>

export const NO_EDITS: LayerEdits = {}

const EMPTY_RECT = { x: 0, y: 0, w: 0, h: 0 }

function rgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace('#', '')
  const s = v.length === 3 ? v[0] + v[0] + v[1] + v[1] + v[2] + v[2] : v
  const n = Number.parseInt(s.slice(0, 6), 16) || 0
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** 用户自定的边框/投影以追加条目的形式挂进既有的图层样式通道，复用合成器里现成的描边与投影绘制 */
function withUserFx(base: EffectInfo | null | undefined, e: LayerEdit): EffectInfo {
  const fx: EffectInfo = { ...(base ?? {}) }
  const b = e.border
  if (b && b.size > 0) {
    const stroke: StrokeInfo = {
      enabled: true,
      blendMode: 'normal',
      color: rgb(b.color),
      opacity: b.opacity,
      size: b.size,
      position: b.position
    }
    fx.stroke = [...(base?.stroke ?? []), stroke]
  }
  const s = e.shadow
  if (s && (s.size > 0 || s.distance > 0)) {
    const shadow: ShadowInfo = {
      enabled: true,
      blendMode: 'normal',
      color: rgb(s.color),
      opacity: s.opacity,
      angle: s.angle,
      distance: s.distance,
      choke: s.choke,
      size: s.size
    }
    fx.dropShadow = [...(base?.dropShadow ?? []), shadow]
  }
  return fx
}

/** 圆角半径超过短边一半会自交，按内切半径钳制 */
function clampRadius(r: number | undefined, w: number, h: number): number | undefined {
  if (!r || r <= 0) return undefined
  return Math.min(r, Math.min(w, h) / 2)
}

function unionOfRects(nodes: RNode[]): { x: number; y: number; w: number; h: number } {
  let x = Infinity
  let y = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const n of nodes) {
    if (n.right <= n.left || n.bottom <= n.top) continue
    x = Math.min(x, n.left)
    y = Math.min(y, n.top)
    r = Math.max(r, n.right)
    b = Math.max(b, n.bottom)
  }
  return x === Infinity ? EMPTY_RECT : { x, y, w: r - x, h: b - y }
}

function unionOfLayers(nodes: PsdLayer[]): { left: number; top: number; width: number; height: number } {
  let x = Infinity
  let y = Infinity
  let r = -Infinity
  let b = -Infinity
  for (const n of nodes) {
    if (!(n.width > 0) || !(n.height > 0)) continue
    x = Math.min(x, n.left)
    y = Math.min(y, n.top)
    r = Math.max(r, n.left + n.width)
    b = Math.max(b, n.top + n.height)
  }
  return x === Infinity ? { left: 0, top: 0, width: 0, height: 0 } : { left: x, top: y, width: r - x, height: b - y }
}

/**
 * 把一棵子树投影成「应用编辑后」的样子。
 * 返回 null 表示这一支完全没变，调用方直接复用原对象——原对象的位图缓存因此保持有效。
 * 祖先只要有位移，整支都必须重建（缓存里记的是文档坐标），所以 inX/inY 非零时永不返回 null。
 */
function project(
  t: PsdLayer,
  r: RNode,
  edits: LayerEdits,
  inX: number,
  inY: number
): [PsdLayer, RNode] | null {
  const found = edits[t.key]
  // baseName 对不上说明 PSD 结构变了、key 已经指向别的图层，宁可让编辑失效也不贴错内容
  const e = found && found.baseName === t.name ? found : undefined
  const dx = inX + (e?.dx ?? 0)
  const dy = inY + (e?.dy ?? 0)

  let kids: PsdLayer[] | null = null
  let rkids: RNode[] | null = null
  let kidsChanged = false
  if (t.children && r.children) {
    kids = []
    rkids = []
    for (let i = 0; i < t.children.length; i++) {
      const kt = t.children[i]
      const kr = r.children[i]
      const p = project(kt, kr, edits, dx, dy)
      kidsChanged ||= !!p
      kids.push(p ? p[0] : kt)
      rkids.push(p ? p[1] : kr)
    }
  }
  if (!e && !kidsChanged && !dx && !dy) return null

  const isLeaf = t.type === 'layer'
  const w0 = r.right - r.left
  const h0 = r.bottom - r.top
  const nw = isLeaf && e?.width ? Math.max(1, Math.round(e.width)) : w0
  const nh = isLeaf && e?.height ? Math.max(1, Math.round(e.height)) : h0
  const sx = w0 > 0 ? nw / w0 : 1
  const sy = h0 > 0 ? nh / h0 : 1

  const rt: RNode = { ...r, bitmap: null, seg: null }
  if (rkids) rt.children = rkids
  if (rkids && !isLeaf) {
    const u = unionOfRects(rkids)
    rt.left = u.x
    rt.top = u.y
    rt.right = u.x + u.w
    rt.bottom = u.y + u.h
  } else {
    rt.left = r.left + dx
    rt.top = r.top + dy
    if (isLeaf) {
      rt.right = rt.left + nw
      rt.bottom = rt.top + nh
    } else {
      rt.right = r.right + dx
      rt.bottom = r.bottom + dy
    }
  }
  // 蒙版矩形跟随图层：先按宽高倍率缩放，再整体平移到新位置
  if (r.mask) {
    const m = r.mask
    rt.mask = {
      ...m,
      left: (m.left - r.left) * sx + r.left + dx,
      top: (m.top - r.top) * sy + r.top + dy,
      right: (m.right - r.left) * sx + r.left + dx,
      bottom: (m.bottom - r.top) * sy + r.top + dy
    }
  }
  if (isLeaf && (e?.width || e?.height)) {
    rt.destW = nw
    rt.destH = nh
  }
  const radius = clampRadius(e?.radius, rt.right - rt.left, rt.bottom - rt.top)
  if (radius !== undefined) rt.radius = radius
  if (e?.border || e?.shadow) rt.effects = withUserFx(r.effects, e)
  if (e?.opacity !== undefined) rt.opacity = e.opacity
  if (e?.blendMode) rt.blendMode = e.blendMode

  const et: PsdLayer = { ...t, name: e?.name || t.name, edit: e }
  if (kids) et.children = kids
  if (kids && !isLeaf) {
    Object.assign(et, unionOfLayers(kids))
  } else {
    et.left = t.left + dx
    et.top = t.top + dy
    et.width = isLeaf ? nw : t.width
    et.height = isLeaf ? nh : t.height
  }
  if (e?.opacity !== undefined) et.opacity = e.opacity
  if (e?.blendMode) et.blendMode = e.blendMode
  return [et, rt]
}

/**
 * 将编辑量投影到「UI 图层树 + 合成器节点树」。两棵树由同一次解析按同一顺序构建，因此下标严格对齐。
 * 入参必须是原始解析结果：本函数只做只读叠加，不写回任何字段，所以重复调用不会累积描边或位移。
 * 无编辑或全部编辑失效时原样返回入参引用，避免下游重复合成。
 */
export function applyLayerEdits(
  tree: PsdLayer[],
  rnodes: RNode[],
  edits: LayerEdits
): { tree: PsdLayer[]; rnodes: RNode[] } {
  if (!Object.keys(edits).length) return { tree, rnodes }
  const outTree: PsdLayer[] = []
  const outR: RNode[] = []
  let changed = false
  for (let i = 0; i < tree.length; i++) {
    const t = tree[i]
    const r = rnodes[i]
    if (!t || !r) continue
    const p = project(t, r, edits, 0, 0)
    if (p) {
      changed = true
      outTree.push(p[0])
      outR.push(p[1])
    } else {
      outTree.push(t)
      outR.push(r)
    }
  }
  return changed ? { tree: outTree, rnodes: outR } : { tree, rnodes }
}

const FIELDS: (keyof LayerEdit)[] = [
  'name',
  'dx',
  'dy',
  'width',
  'height',
  'opacity',
  'blendMode',
  'radius',
  'border',
  'shadow'
]

function isEditable(e: LayerEdit): boolean {
  return FIELDS.some((f) => e[f] !== undefined)
}

/**
 * 写回编辑时要登记的原始图层名。投影后的层若已改名，layer.name 是新名，
 * 只有 layer.edit.baseName 还留着 PSD 里的原名——续上它才不会另起一条贴错图层的编辑。
 */
export function editBaseName(layer: PsdLayer): string {
  return layer.edit?.baseName ?? layer.name
}

/** 局部改写一条编辑：patch 里显式传 undefined 即清掉该项，整条空了就删掉 */export function patchEdit(
  edits: LayerEdits,
  key: string,
  baseName: string,
  patch: Partial<LayerEdit>
): LayerEdits {
  const next: LayerEdit = { ...(edits[key] ?? { baseName }), ...patch }
  const out: LayerEdits = { ...edits }
  if (isEditable(next)) out[key] = next
  else delete out[key]
  return out
}

export function dropEdit(edits: LayerEdits, key: string): LayerEdits {
  if (!(key in edits)) return edits
  const out: LayerEdits = { ...edits }
  delete out[key]
  return out
}
