import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '@/types'
import { navigate, useHashRoute } from '@/lib/router'
import { useT } from '@/i18n/core'
import {
  TOUR_STEPS,
  stopOnboarding,
  useOnboardingRunning,
  type TourPage
} from '@/lib/onboarding'

const BUBBLE_W = 300
const GAP = 14
const MARGIN = 12
const PAD = 4

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const HALT_TITLE = '先去建项目、传第一份 PSD'
const HALT_DESC = '剩下的图层树、画布与导出，要对着设计稿讲才看得懂。传好后随时能在「设置 → 关于轻切」里重放引导。'

/** 页面由浅到深；用户自己走到了更深的页，说明前面那步已经做完了 */
const PAGE_DEPTH: Record<TourPage, number> = { home: 0, project: 1, detail: 2 }

function hashDepth(hash: string): number {
  return hash.startsWith('#/detail/') ? 2 : hash.startsWith('#/project/') ? 1 : 0
}

function pickProject(projects: Project[], hash: string): Project | undefined {
  const m = /^#\/(?:project|detail)\/([^/]+)/.exec(hash)
  return (m && projects.find((p) => p.id === m[1])) || projects[0]
}

/** 该步所在页面的可达路由；没有数据可导航时返回 null，引导退化为居中讲解 */
function routeFor(page: TourPage, projects: Project[], hash: string): string | null {
  if (page === 'home') return '#/home'
  if (page === 'project') {
    const p = pickProject(projects, hash)
    return p ? `#/project/${p.id}` : null
  }
  // 详情页要有 PSD 才讲得下去，空项目会整体退化成居中，所以挑一个有稿的
  const cur = pickProject(projects, hash)
  const p = cur?.psds.length ? cur : projects.find((x) => x.psds.length > 0)
  return p ? `#/detail/${p.id}/${p.psds[0].id}` : null
}

/** 顶栏是窗口拖拽区，原生鼠标按下会被它吃掉，浮在其中的按钮点不动 */
function dragBand(): number {
  const bar = document.querySelector('.g-topbar')?.getBoundingClientRect()
  return bar ? bar.bottom : 0
}

/** 气泡贴向目标周围最宽裕的一侧，再夹回视口内并让开顶栏拖拽区 */
function place(box: Box, h: number, vw: number, vh: number, band: number): { left: number; top: number } {
  const spaces = [vh - box.top - box.height, box.top, vw - box.left - box.width, box.left]
  const side = spaces.indexOf(Math.max(...spaces))
  const cx = box.left + box.width / 2
  const cy = box.top + box.height / 2
  let left = cx - BUBBLE_W / 2
  let top = box.top + box.height + GAP
  if (side === 1) top = box.top - GAP - h
  else if (side === 2) {
    left = box.left + box.width + GAP
    top = cy - h / 2
  } else if (side === 3) {
    left = box.left - GAP - BUBBLE_W
    top = cy - h / 2
  }
  top = Math.min(Math.max(top, MARGIN), Math.max(vh - h - MARGIN, MARGIN))
  if (top < band && vh - band - MARGIN > h) top = band
  return {
    left: Math.min(Math.max(left, MARGIN), Math.max(vw - BUBBLE_W - MARGIN, MARGIN)),
    top
  }
}

export default function OnboardingTour({ projects }: { projects: Project[] }) {
  const t = useT()
  const running = useOnboardingRunning()
  const hash = useHashRoute()
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<Box | null>(null)
  const [centered, setCentered] = useState(false)
  const [halted, setHalted] = useState(false)
  const [bubbleH, setBubbleH] = useState(150)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })
  const bubbleRef = useRef<HTMLDivElement>(null)
  const nodeRef = useRef<Element | null>(null)
  const boxRef = useRef<Box | null>(null)
  const manualRef = useRef<number | null>(null)
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  const step = TOUR_STEPS[index]

  const applyBox = useCallback((b: Box | null) => {
    const p = boxRef.current
    if (!p === !b) {
      if (p && b && p.left === b.left && p.top === b.top && p.width === b.width && p.height === b.height) return
    }
    boxRef.current = b
    setBox(b)
  }, [])

  const measure = useCallback(() => {
    const node = nodeRef.current
    if (!node) return
    const r = node.getBoundingClientRect()
    // 面板收起后宽度归零，这时没有可指的对象，退化成居中讲解
    if (r.width < 8 || r.height < 8) {
      applyBox(null)
      setCentered(true)
      return
    }
    applyBox({ left: r.left, top: r.top, width: r.width, height: r.height })
    setCentered(false)
  }, [applyBox])

  const finish = useCallback(() => {
    stopOnboarding()
  }, [])

  /** 目标还没出现（详情页正在解析）或不可见时，不允许往前跳步 */
  const waiting = !box && !centered

  const go = useCallback(
    (delta: number) => {
      if (delta > 0 && waiting) return
      const next = index + delta
      if (next >= TOUR_STEPS.length) finish()
      else {
        manualRef.current = Math.max(0, next)
        setIndex(Math.max(0, next))
      }
    },
    [index, waiting, finish]
  )

  useEffect(() => {
    if (running) setIndex(0)
  }, [running])

  // 跨页导航 + 等目标元素挂载后持续跟随
  useEffect(() => {
    if (!running || !step) return
    nodeRef.current = null
    // 冷启动时 location.hash 是空串，而路由按 '#/home' 渲染；直接比较会让本效果导航后再也不重跑，第一步永远量不到目标
    const cur = location.hash || '#/home'
    const want = routeFor(step.page, projectsRef.current, cur)
    // 换步时先收掉上一个目标的高亮，避免气泡还指着旧元素
    applyBox(null)
    setCentered(false)
    if (want === null) {
      // 没数据就走不到后面的页，与其连排五个没有高亮的气泡，不如当场收尾
      setHalted(true)
      setCentered(true)
      return
    }
    setHalted(false)
    if (hashDepth(cur) > PAGE_DEPTH[step.page] && manualRef.current !== index) {
      // 用户自己把这一步的动作做完了（刚建好项目、已进详情页），就顺着往下讲，别把人拽回上一步的页面
      setIndex(Math.min(index + 1, TOUR_STEPS.length - 1))
      return
    }
    manualRef.current = null
    if (cur !== want) {
      navigate(want)
      return
    }
    if (!step.anchor) {
      setCentered(true)
      return
    }
    const cleanups: (() => void)[] = []
    let tries = 0
    const tick = () => {
      if (!nodeRef.current) {
        const n = document.querySelector(step.anchor!)
        if (!n) {
          // 目标迟迟不出现时退回居中讲解，不把引导卡死
          if (++tries > 200) {
            setCentered(true)
            clearInterval(timer)
          }
          return
        }
        n.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const ro = new ResizeObserver(measure)
        ro.observe(n)
        cleanups.push(() => ro.disconnect())
        nodeRef.current = n
      }
      measure()
    }
    // 目标会随入场动画、面板拖拽、页面滚动持续位移，只量一次会停在旧位置
    const timer = setInterval(tick, 100)
    const onMove = () => measure()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    cleanups.push(() => {
      clearInterval(timer)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    })
    tick()
    return () => cleanups.forEach((f) => f())
  }, [running, step, hash, index, measure, applyBox])

  useEffect(() => {
    if (!running) return
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [running])

  useEffect(() => {
    if (!running) return
    const el = bubbleRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBubbleH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [running, index])

  // 引导期间按方向键翻页；捕获阶段拦下其余按键，避免误触发画布命令
  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.stopPropagation()
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key !== 'Tab') e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [running, go, finish])

  if (!running || !step) return null

  const pos = box
    ? place(box, bubbleH, vp.w, vp.h, dragBand())
    : { left: (vp.w - BUBBLE_W) / 2, top: (vp.h - bubbleH) / 2 }
  // 数据不够走不到后面的页时，就地把手头这段讲完，不留一个点了没反应的「下一步」
  const done = halted || index === TOUR_STEPS.length - 1

  return createPortal(
    <div id="onboarding-tour" className="pointer-events-none fixed inset-0 z-[10000] select-text">
      {box && (
        <div
          id="tour-hole"
          className="absolute rounded-[8px]"
          style={{
            left: box.left - PAD,
            top: box.top - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: '0 0 0 2px var(--accent), 0 0 0 9999px rgba(0, 0, 0, 0.55)'
          }}
        />
      )}
      <div
        id="tour-bubble"
        ref={bubbleRef}
        key={index}
        className="pointer-events-auto absolute rounded-[10px] border border-border bg-panel p-[14px]"
        style={{
          left: pos.left,
          top: pos.top,
          width: BUBBLE_W,
          animation: 'rise .2s var(--ease)',
          boxShadow: '0 18px 50px rgba(0, 0, 0, 0.3)'
        }}
      >
        <div className="flex items-start gap-2">
          <span className="pt-[2px] font-mono text-[11px] text-accent-2">
            {index + 1}/{TOUR_STEPS.length}
          </span>
          <b className="flex-1 text-[13px] font-semibold text-txt">{halted ? t(HALT_TITLE) : t(step.title)}</b>
          <button
            className="-mr-1 -mt-1 grid h-[22px] w-[22px] place-items-center rounded-[4px] text-[14px] text-txt-3 hover:bg-panel-3 hover:text-txt"
            title={t('结束引导')}
            onClick={finish}
          >
            ×
          </button>
        </div>
        <p className="mt-[6px] text-[12px] leading-[19px] text-txt-2">{halted ? t(HALT_DESC) : t(step.desc)}</p>
        <div className="mt-[12px] flex items-center gap-2">
          <div className="flex flex-1 gap-[5px]">
            {TOUR_STEPS.map((s, i) => (
              <i
                key={s.id}
                className="h-[4px] rounded-full transition-all duration-200"
                style={{
                  width: i === index ? 16 : 4,
                  background: i === index ? 'var(--accent)' : 'var(--line-2)'
                }}
              />
            ))}
          </div>
          {index > 0 && (
            <button className="btn btn-ghost" onClick={() => go(-1)}>
              {t('上一步')}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => (done ? finish() : go(1))}
            disabled={waiting}
            title={waiting ? t('加载中…') : undefined}
          >
            {done ? t('完成') : t('下一步')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
