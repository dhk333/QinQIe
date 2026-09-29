// PSD 逐层位图全量解码 Worker：ag-psd 的 240MB 级解码从主线程挪到这里。
// ag-psd 在 Worker 内落在 OffscreenCanvas 上；带渲染上下文的 OffscreenCanvas 不可
// transfer/clone，而 ImageBitmap 的解码缓存实测数秒内会被丢弃（位图变全透明但
// width/height 不变）。故统一在 Worker 内读出原始像素字节回传——惰性数据不存在
// 衰减问题，主线程再慢的分帧固化也不会拷出透明层。
import { initializeCanvas } from 'ag-psd'
import type { PsdLayer } from '@/types'
import type { RNode } from './compositor'
import { decodeLayerCanvases, type LayerBitmap, type PixelEntry } from './psdDecode'

// initializeCanvas 的签名按 DOM 环境写死 HTMLCanvasElement，运行时接受任何画布
initializeCanvas(
  (w, h) => new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) as unknown as HTMLCanvasElement
)

interface DecodeRequest {
  seq: number
  buffer: ArrayBuffer
  tree: PsdLayer[]
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

// 像素读出：同一 OffscreenCanvas 实例（layer.canvas 与 canvasMap 共享）只读一次；
// 读完立即把底稿清零释放，Worker 峰值内存接近减半
function toPixelEntries(
  rnodes: RNode[],
  canvasMap: Map<number, LayerBitmap>
): { canvasEntries: [number, PixelEntry][]; maskEntries: [number, PixelEntry][]; transfers: ArrayBuffer[] } {
  const pixels = new Map<OffscreenCanvas, PixelEntry>()
  const transfers: ArrayBuffer[] = []
  const readOut = (c: OffscreenCanvas): PixelEntry => {
    const hit = pixels.get(c)
    if (hit) return hit
    const w = c.width
    const h = c.height
    const img = c.getContext('2d')!.getImageData(0, 0, w, h)
    c.width = 0
    c.height = 0
    const entry: PixelEntry = { w, h, data: img.data }
    pixels.set(c, entry)
    transfers.push(img.data.buffer as ArrayBuffer)
    return entry
  }
  // 蒙版画布不在 canvasMap 里，按节点 id 单独收集
  const maskEntries: [number, PixelEntry][] = []
  const walk = (ns: RNode[]): void => {
    for (const n of ns) {
      if (n.canvas instanceof OffscreenCanvas) readOut(n.canvas)
      if (n.mask?.canvas instanceof OffscreenCanvas) maskEntries.push([n.id, readOut(n.mask.canvas)])
      if (n.children) walk(n.children)
    }
  }
  walk(rnodes)
  const canvasEntries: [number, PixelEntry][] = [...canvasMap.entries()].map(([id, c]) => [
    id,
    readOut(c as unknown as OffscreenCanvas)
  ])
  return { canvasEntries, maskEntries, transfers }
}

// 带上下文的 OffscreenCanvas 既不能 clone 也不能 transfer，回传前必须把画布引用清空，
// 主线程按 id 用回传的像素重建（与 canvasMap 同一实例策略保持一致）
function stripCanvases(nodes: RNode[]): RNode[] {
  return nodes.map((n) => ({
    ...n,
    canvas: null,
    bitmap: null,
    seg: null,
    mask: n.mask ? { ...n.mask, canvas: null } : n.mask,
    children: n.children ? stripCanvases(n.children) : undefined
  }))
}

ctx.onmessage = (e: MessageEvent) => {
  const { seq, buffer, tree } = e.data as DecodeRequest
  try {
    const { canvasMap, rnodes } = decodeLayerCanvases(new Uint8Array(buffer), tree)
    const { canvasEntries, maskEntries, transfers } = toPixelEntries(rnodes, canvasMap)
    ctx.postMessage(
      { seq, ok: true, canvasEntries, maskEntries, rnodes: stripCanvases(rnodes) },
      transfers
    )
  } catch (err) {
    // 断言失败/解码异常：原 buffer 随错误回传，主线程据此走备用解析器兜底
    ctx.postMessage(
      { seq, ok: false, message: err instanceof Error ? err.message : String(err), buffer },
      [buffer]
    )
  }
}
