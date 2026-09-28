// psd.worker.ts 的主线程侧封装：一次性 Worker，任务级生命周期
import PsdDecodeWorker from './psd.worker?worker'
import type { PsdLayer } from '@/types'
import type { RNode } from './compositor'
import type { LayerBitmap } from './psdDecode'

/** Worker 内解码失败时携带回传的原始字节（buffer 已转移给 Worker，主线程本地副本失效） */
export class WorkerDecodeError extends Error {
  returnedBuffer?: ArrayBuffer
}

/** 主动取消（换文件/离开页面）：调用方据此静默放弃，不走备用解析器 */
export class WorkerCancelledError extends Error {}

interface WorkerResponse {
  seq: number
  ok: boolean
  canvasEntries?: [number, ImageBitmap][]
  rnodes?: RNode[]
  message?: string
  buffer?: ArrayBuffer
}

export interface DecodeJob {
  result: Promise<{ canvasMap: Map<number, LayerBitmap>; rnodes: RNode[] }>
  /** 终止 Worker 并让 result 以 WorkerCancelledError 拒绝；已结束时为空操作 */
  cancel(): void
}

export function decodeLayersInWorker(buffer: Uint8Array, tree: PsdLayer[]): DecodeJob {
  let settled = false
  let worker: Worker | null = null
  let settle: ((e: Error) => void) | null = null
  const result = new Promise<{ canvasMap: Map<number, LayerBitmap>; rnodes: RNode[] }>(
    (resolve, reject) => {
      settle = reject
      const full = buffer.buffer as ArrayBuffer
      const ab =
        buffer.byteOffset === 0 && buffer.byteLength === full.byteLength
          ? full
          : full.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      worker = new PsdDecodeWorker()
      worker.onmessage = (e: MessageEvent) => {
        if (settled) return
        settled = true
        worker?.terminate()
        const msg = e.data as WorkerResponse
        if (msg.ok && msg.canvasEntries && msg.rnodes) {
          resolve({
            canvasMap: new Map<number, LayerBitmap>(msg.canvasEntries),
            rnodes: msg.rnodes
          })
        } else {
          const err = new WorkerDecodeError(msg.message ?? 'worker 解码失败')
          if (msg.buffer) err.returnedBuffer = msg.buffer
          reject(err)
        }
      }
      worker.onerror = (e) => {
        if (settled) return
        settled = true
        worker?.terminate()
        // 脚本级崩溃拿不回 buffer，调用方按原路径重读文件兜底
        reject(new WorkerDecodeError(e.message || 'worker crashed'))
      }
      worker.postMessage({ seq: 1, buffer: ab, tree }, [ab])
    }
  )
  return {
    result,
    cancel() {
      if (settled) return
      settled = true
      worker?.terminate()
      settle?.(new WorkerCancelledError('解码已取消'))
    }
  }
}
