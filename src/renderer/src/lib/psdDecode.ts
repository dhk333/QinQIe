// Worker 与主线程共用的解码核心：只依赖 ag-psd 与纯逻辑合成器，
// 不得引入 DOM/动态 import（@webtoon 兜底等），保证能被打包进 Web Worker。
import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { PsdLayer } from '@/types'
import { buildRNode, type RNode } from './compositor'

/** 图层位图：主线程解析产出 DOM canvas；Worker 解码产出 ImageBitmap（transferToImageBitmap 零拷贝转移） */
export type LayerBitmap = HTMLCanvasElement | ImageBitmap

/** Worker 回传的逐层像素（RGBA 原始字节）。原始字节是惰性数据，不存在
 *  ImageBitmap 解码缓存数秒内被丢弃（变全透明）的问题，主线程可以任意分帧固化 */
export interface PixelEntry {
  w: number
  h: number
  data: Uint8ClampedArray
}

/** 用 PsdLayer 树的 id 反推合成器节点树，保证选中/显隐状态两边通用 */
export function toRNodes(layers: Layer[], ids: WeakMap<Layer, number>): RNode[] {
  return layers.map((l) =>
    buildRNode(l as unknown as Parameters<typeof buildRNode>[0], (x) => ids.get(x as Layer) ?? 0)
  )
}

// 两阶段加载的第二步：全量解码位图，按 parsePsd(structureOnly) 生成的树位置对齐，
// 把 canvas 填进以既有节点 id 为键的 canvasMap，并用同一批 id 重建合成器节点树
export function decodeLayerCanvases(
  buffer: Uint8Array,
  tree: PsdLayer[]
): { canvasMap: Map<number, LayerBitmap>; rnodes: RNode[] } {
  // skipCompositeImageData：主线程结构阶段已留下内嵌合成图做预览，
  // Worker 这次全量解析再把整篇合成一遍纯属白干（大文档 ≈ 数百毫秒 + 一份文档尺寸画布）
  const psd: Psd = readPsd(buffer, {
    skipLinkedFilesData: true,
    skipThumbnail: true,
    skipCompositeImageData: true
  })
  const canvasMap = new Map<number, LayerBitmap>()
  const ids = new WeakMap<Layer, number>()
  const attach = (layers: Layer[], nodes: PsdLayer[]) => {
    // 两遍解析结果必须严格同构：任何数量/类型/边界不一致都视为 id 错位，
    // 立即抛错让上层回落到备用解析器，宁可慢也不给图层贴错名字和位图。
    // 组判定与 toNode 对齐：layer.children 数组存在（哪怕为空）即为组。
    if (layers.length !== nodes.length) {
      throw new Error(`两阶段解析节点数不一致: ${layers.length} vs ${nodes.length}`)
    }
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const node = nodes[i]
      ids.set(layer, node.id)
      if (node.type === 'group') {
        const subs = layer.children ?? []
        if (subs.length !== (node.children?.length ?? 0)) {
          throw new Error(`两阶段解析子节点数错位: #${node.id} ${node.name}`)
        }
        if (subs.length) attach(subs, node.children!)
        continue
      }
      if (layer.children?.length) {
        throw new Error(`两阶段解析图层类型错位: #${node.id} ${node.name}`)
      }
      const l = layer.left ?? 0
      const t = layer.top ?? 0
      const w = (layer.right ?? l) - l
      const h = (layer.bottom ?? t) - t
      if (
        Math.abs(l - node.left) > 1 ||
        Math.abs(t - node.top) > 1 ||
        Math.abs(w - node.width) > 1 ||
        Math.abs(h - node.height) > 1
      ) {
        throw new Error(
          `两阶段解析边界错位: #${node.id} ${node.name} [${l},${t},${w},${h}] vs [${node.left},${node.top},${node.width},${node.height}]`
        )
      }
      if (layer.canvas) canvasMap.set(node.id, layer.canvas)
    }
  }
  const layers = psd.children ?? []
  attach(layers, tree)
  return { canvasMap, rnodes: toRNodes(layers, ids) }
}
