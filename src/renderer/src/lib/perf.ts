// ========== 解析性能打点（仅 dev 生效，release 全部入口短路） ==========
// 用途：给「读取 → 结构 → 解码 → 合成」四段拿真实耗时基线，指导解析优化优先级。

export type PerfPhase = 'read' | 'structure' | 'decode' | 'fallback'

// 裸 Node（verify:app 直接 import psd.ts）没有 import.meta.env，按非 dev 处理
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false

const spans = new Map<PerfPhase, { start: number; end: number }>()
// 合成单独统计：每次显隐切换都会全文档重合成，累计/均值/最近值用于评估分层缓存收益
const comp = { total: 0, count: 0, last: 0 }
// 最近一次合成的内部构成：定位耗时来自烘焙未命中还是海量 blit
const detail = { bakes: 0, leaves: 0, canvases: 0, canvasPx: 0, lastMs: 0 }

export const perfEnabled = DEV

export function perfBegin(phase: PerfPhase): void {
  if (!DEV) return
  spans.set(phase, { start: performance.now(), end: 0 })
}

export function perfEnd(phase: PerfPhase): void {
  if (!DEV) return
  const s = spans.get(phase)
  if (s && !s.end) s.end = performance.now()
}

export function perfReset(): void {
  if (!DEV) return
  spans.clear()
  comp.total = 0
  comp.count = 0
  comp.last = 0
}

/** 每次全文档合成前调用：清零内部计数 */
export function perfCompositeBegin(): void {
  if (!DEV) return
  detail.bakes = 0
  detail.leaves = 0
  detail.canvases = 0
  detail.canvasPx = 0
}

export function perfBake(): void {
  if (DEV) detail.bakes++
}

export function perfLeafPaint(): void {
  if (DEV) detail.leaves++
}

export function perfCanvasCreated(px: number): void {
  if (!DEV) return
  detail.canvases++
  detail.canvasPx += px
}

export function perfCompositeSpan(ms: number): void {
  if (!DEV) return
  comp.total += ms
  comp.count += 1
  comp.last = ms
  detail.lastMs = ms
}

export interface PerfReport {
  phases: { phase: PerfPhase; ms: number }[]
  composite: { total: number; count: number; last: number; avg: number }
  detail: { bakes: number; leaves: number; canvases: number; canvasPx: number; lastMs: number }
}

export function perfReport(): PerfReport | null {
  if (!DEV) return null
  const phases: { phase: PerfPhase; ms: number }[] = []
  for (const [phase, s] of spans) {
    if (s.end > 0) phases.push({ phase, ms: Math.round(s.end - s.start) })
  }
  if (!phases.length && !comp.count) return null
  return {
    phases,
    composite: {
      total: Math.round(comp.total),
      count: comp.count,
      last: Math.round(comp.last),
      avg: comp.count ? Math.round(comp.total / comp.count) : 0
    },
    detail: { ...detail, lastMs: Math.round(detail.lastMs) }
  }
}
