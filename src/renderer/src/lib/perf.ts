// ========== 解析性能打点（仅 dev 生效，release 全部入口短路） ==========
// 用途：给「读取 → 结构 → 解码 → 合成」四段拿真实耗时基线，指导解析优化优先级。

export type PerfPhase = 'read' | 'structure' | 'decode' | 'fallback'

const DEV = import.meta.env.DEV

const spans = new Map<PerfPhase, { start: number; end: number }>()
// 合成单独统计：每次显隐切换都会全文档重合成，累计/均值/最近值用于评估分层缓存收益
const comp = { total: 0, count: 0, last: 0 }

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

export function perfCompositeSpan(ms: number): void {
  if (!DEV) return
  comp.total += ms
  comp.count += 1
  comp.last = ms
}

export interface PerfReport {
  phases: { phase: PerfPhase; ms: number }[]
  composite: { total: number; count: number; last: number; avg: number }
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
    }
  }
}
