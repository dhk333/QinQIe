// PSD 逐层位图全量解码 Worker：ag-psd 的 240MB 级解码从主线程挪到这里。
// ag-psd 在 Worker 内落在 OffscreenCanvas 上；带渲染上下文的 OffscreenCanvas 不可
// transfer，统一经 transferToImageBitmap() 转成 ImageBitmap（零拷贝）回传主线程。
import { initializeCanvas } from 'ag-psd'
import type { PsdLayer } from '@/types'
import type { RNode } from './compositor'
import { decodeLayerCanvases, type LayerBitmap } from './psdDecode'

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

// 同一 OffscreenCanvas 实例（layer.canvas 与 canvasMap 共享）只转换一次，保持引用一致
function toBitmaps(rnodes: RNode[], canvasMap: Map<number, LayerBitmap>): ImageBitmap[] {
  const map = new Map<OffscreenCanvas, ImageBitmap>()
  const get = (c: OffscreenCanvas): ImageBitmap => {
    let b = map.get(c)
    if (!b) {
      b = c.transferToImageBitmap()
      map.set(c, b)
    }
    return b
  }
  const walk = (nodes: RNode[]): void => {
    for (const n of nodes) {
      if (n.canvas instanceof OffscreenCanvas) n.canvas = get(n.canvas)
      if (n.mask?.canvas instanceof OffscreenCanvas) n.mask.canvas = get(n.mask.canvas)
      if (n.children) walk(n.children)
    }
  }
  walk(rnodes)
  for (const [id, c] of canvasMap) {
    if (c instanceof OffscreenCanvas) canvasMap.set(id, get(c))
  }
  return [...map.values()]
}

ctx.onmessage = (e: MessageEvent) => {
  const { seq, buffer, tree } = e.data as DecodeRequest
  try {
    const { canvasMap, rnodes } = decodeLayerCanvases(new Uint8Array(buffer), tree)
    const bitmaps = toBitmaps(rnodes, canvasMap)
    ctx.postMessage(
      {
        seq,
        ok: true,
        canvasEntries: [...canvasMap.entries()].map(
          ([id, c]) => [id, c as ImageBitmap] as [number, ImageBitmap]
        ),
        rnodes
      },
      bitmaps
    )
  } catch (err) {
    // 断言失败/解码异常：原 buffer 随错误回传，主线程据此走备用解析器兜底
    ctx.postMessage(
      { seq, ok: false, message: err instanceof Error ? err.message : String(err), buffer },
      [buffer]
    )
  }
}
