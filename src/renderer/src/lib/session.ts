import type { CanvasViewport } from '@/components/CanvasView'

// 会话状态（不是偏好）：上次打开的是哪个 PSD、每个 PSD 的画布视口。
// 视口按 PSD 路径存，重开同一份设计稿时回到上次看的位置。
const KEY = 'qingqie.session'
const MAX_VIEWS = 24

export interface LastRoute {
  projectId: string
  psdId: string
}

interface Session {
  last?: LastRoute
  views?: Record<string, CanvasViewport>
}

function load(): Session {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as Session
    return s && typeof s === 'object' ? s : {}
  } catch {
    return {}
  }
}

function save(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 存储不可用时仅本次会话生效
  }
}

export function loadLastRoute(): LastRoute | null {
  const l = load().last
  return l && l.projectId && l.psdId ? l : null
}

export function saveLastRoute(projectId: string, psdId: string): void {
  const s = load()
  s.last = { projectId, psdId }
  save(s)
}

export function loadView(path: string): CanvasViewport | null {
  const v = load().views?.[path]
  return v && Number.isFinite(v.zoom) && v.zoom > 0 ? v : null
}

export function saveView(path: string, v: CanvasViewport): void {
  const s = load()
  const views = s.views ?? {}
  delete views[path]
  views[path] = v
  // 只留最近打开的若干份，避免长期使用后无限膨胀
  const keys = Object.keys(views)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_VIEWS))) delete views[k]
  s.views = views
  save(s)
}
