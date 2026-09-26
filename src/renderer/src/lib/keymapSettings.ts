import { setUserOverrides, type Chord } from '@shared/keymap'

const STORE_KEY = 'qingqie.keymap-overrides'

function readMap(): Record<string, Chord[]> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Chord[]>
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

let map: Record<string, Chord[]> = readMap()
setUserOverrides(map)

const listeners = new Set<() => void>()

function commit(next: Record<string, Chord[]>): void {
  map = next
  setUserOverrides(map)
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map))
  } catch {
    // 存储不可用时仅本次会话生效
  }
  listeners.forEach((fn) => fn())
}

export function getOverrides(): Record<string, Chord[]> {
  return map
}

export function setOverride(id: string, chords: Chord[]): void {
  commit({ ...map, [id]: chords })
}

export function clearOverride(id: string): void {
  const next = { ...map }
  delete next[id]
  commit(next)
}

export function resetAllOverrides(): void {
  commit({})
}

/** 订阅变更（覆盖表变化后驱动快捷键弹窗重渲染） */
export function subscribeKeymap(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
