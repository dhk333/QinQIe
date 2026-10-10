import type { RNode } from './compositor'
import { measureLayerContent, type LayerBitmap } from './psd'

/** 文档坐标下的矩形 */
export interface ClipBox {
  left: number
  top: number
  width: number
  height: number
}

export interface ClipInfo {
  /** 节点「所见即所得」的可见框：图层蒙版与剪贴链都生效后的矩形（无内容的节点不入表） */
  boxes: Map<number, ClipBox>
  /** clipping 节点 → 它的剪贴基底节点（同组内它下面最近的非 clipping 兄弟） */
  bases: Map<number, RNode>
}

interface Rect {
  l: number
  t: number
  r: number
  b: number
}

function nodeRect(n: RNode): Rect {
  return { l: n.left, t: n.top, r: n.right, b: n.bottom }
}

/** 蒙版框：ag-psd 的 mask 矩形是文档坐标；defaultColor=255 的坏蒙版数据按「不裁」处理 */
function maskRect(n: RNode): Rect | null {
  const m = n.mask
  if (!m || m.disabled) return null
  if (m.right <= m.left || m.bottom <= m.top) return null
  return { l: m.left, t: m.top, r: m.right, b: m.bottom }
}

function intersect(a: Rect, b: Rect): Rect | null {
  const l = Math.max(a.l, b.l)
  const t = Math.max(a.t, b.t)
  const r = Math.min(a.r, b.r)
  const b2 = Math.min(a.b, b.b)
  if (r - l < 1 || b2 - t < 1) return null
  return { l, t, r, b: b2 }
}

function toBox(rc: Rect): ClipBox {
  return { left: rc.l, top: rc.t, width: Math.round(rc.r - rc.l), height: Math.round(rc.b - rc.t) }
}

/** 叶子自身的内容框：位图 alpha 包围盒（透明留白不算内容），没位图就用图层矩形 */
function leafRect(n: RNode): Rect | null {
  const base = nodeRect(n)
  if (base.r - base.l < 1 || base.b - base.t < 1) return null
  const img = n.canvas as LayerBitmap | null | undefined
  const m = img ? measureLayerContent(img) : null
  if (!m || !(m.bw > 0) || !(m.bh > 0)) return base
  const sx = (base.r - base.l) / m.bw
  const sy = (base.b - base.t) / m.bh
  return {
    l: base.l + m.padL * sx,
    t: base.t + m.padT * sy,
    r: base.l + (m.padL + m.cw) * sx,
    b: base.t + (m.padT + m.ch) * sy
  }
}

/**
 * 一次遍历算出全部节点的可见框与剪贴基底。
 * 顺序约定与合成器一致：children 自底向上，clipping 图层紧跟在它的基底之后。
 */
function build(nodes: RNode[], info: ClipInfo): void {
  let chainBase: RNode | null = null
  for (const n of nodes) {
    let rect: Rect | null = null
    if (n.kind === 'group') {
      const kids = n.children ?? []
      build(kids, info)
      for (const c of kids) {
        const cb = info.boxes.get(c.id)
        if (!cb) continue
        const cr: Rect = { l: cb.left, t: cb.top, r: cb.left + cb.width, b: cb.top + cb.height }
        rect = rect
          ? {
              l: Math.min(rect.l, cr.l),
              t: Math.min(rect.t, cr.t),
              r: Math.max(rect.r, cr.r),
              b: Math.max(rect.b, cr.b)
            }
          : cr
      }
    } else {
      rect = leafRect(n)
    }
    const own = maskRect(n)
    if (rect && own) rect = intersect(rect, own)
    if (rect && n.clipping) {
      // 无基底的孤儿剪贴层不落笔（与合成器 paintList 同一语义），不能给它一个可见框
      if (!chainBase) rect = null
      else {
        const bb = info.boxes.get(chainBase.id)
        info.bases.set(n.id, chainBase)
        rect = bb
          ? intersect(rect, { l: bb.left, t: bb.top, r: bb.left + bb.width, b: bb.top + bb.height })
          : null
      }
    }
    if (rect) info.boxes.set(n.id, toBox(rect))
    if (!n.clipping) chainBase = n
  }
}

const cache = new WeakMap<RNode[], ClipInfo>()

/** 剪贴链与蒙版生效后的可见区域（画布选框、尺寸读数、导出/预览共用同一口径） */
export function clipInfoOf(rnodes: RNode[]): ClipInfo {
  const hit = cache.get(rnodes)
  if (hit) return hit
  const info: ClipInfo = { boxes: new Map(), bases: new Map() }
  build(rnodes, info)
  cache.set(rnodes, info)
  return info
}

/** 某个图层被剪贴到哪个基底；未被剪贴返回 null */
export function clipBaseOf(rnodes: RNode[], id: number): RNode | null {
  return clipInfoOf(rnodes).bases.get(id) ?? null
}
