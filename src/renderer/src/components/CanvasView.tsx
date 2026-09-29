import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { DocSlice, PsdDoc, PsdLayer } from '@/types'
import type { RNode } from '@/lib/compositor'
import { buildCompositeCanvas, flattenLayers, measureContentRect, readLayerPixels, type LayerBitmap } from '@/lib/psd'
import { HANDLE_CURSORS, toolCursorCss, useToolCursor } from '@/lib/cursors'
import { useT } from '@/i18n/core'
import { useUiPrefs } from '@/lib/uiPrefs'

export type CanvasTool = 'move' | 'slice' | 'picker' | 'hand'

export interface CanvasViewApi {
  fit: () => void
  applyZoom: (target: number) => void
  /** 缩放到指定文档坐标区域（留边距并居中） */
  zoomTo: (rect: { x: number; y: number; w: number; h: number }) => void
  getZoom: () => number
}

interface Props {
  doc: PsdDoc | null
  tree: PsdLayer[]
  rnodes: RNode[]
  canvasMap: Map<number, LayerBitmap>
  hiddenIds: Set<number>
  /** 逐层位图解码完成前的内嵌合成图占位；解码完成或用户改显隐后即失效让位给真实合成 */
  preview?: HTMLCanvasElement | null
  selectedIds: Set<number>
  onSelect: (layer: PsdLayer | null, mods: { ctrl: boolean; shift: boolean }) => void
  onLayerContext?: (layer: PsdLayer, x: number, y: number) => void
  apiRef?: React.MutableRefObject<CanvasViewApi | null>
  onZoomChange?: (pct: number) => void
  /** 首帧打开时的视口（恢复上次缩放/位置）；缺省时自动适配整图 */
  initialView?: CanvasViewport | null
  onViewChange?: (v: CanvasViewport) => void
  tool: CanvasTool
  slices: DocSlice[]
  selectedSliceIds: Set<string>
  showSlices: boolean
  onCreateSlice: (rect: { x: number; y: number; w: number; h: number }) => void
  onSelectSlice: (id: string | null, additive?: boolean) => void
  /** Alt+拖拽复制：克隆指定切片并返回新切片（已偏移、已选中），由外部完成创建 */
  onDupSlice: (id: string) => { id: string; rect: { x: number; y: number; w: number; h: number } } | null
  onPickColor: (hex: string) => void
  onUpdateSlice: (id: string, rect: { x: number; y: number; w: number; h: number }) => void
  onDeleteSlice: (id: string) => void
  /** 切片工具下右键切片：先选中再回调（屏幕坐标供上下文菜单定位） */
  onSliceContext?: (sliceId: string, clientX: number, clientY: number) => void
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN_SLICE = 4

interface DragState {
  mode: 'pan' | 'draw' | 'move' | 'resize'
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
  docStart?: { x: number; y: number }
  sliceId?: string
  handle?: HandleId
  origRect?: { x: number; y: number; w: number; h: number }
}

interface DrawRect {
  x: number
  y: number
  w: number
  h: number
}

/** 画布视口：缩放倍率 + 文档原点在屏幕上的位置 */
export interface CanvasViewport {
  zoom: number
  x: number
  y: number
}

function makeCheckerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  const tile = document.createElement('canvas')
  tile.width = 16
  tile.height = 16
  const tctx = tile.getContext('2d')!
  tctx.fillStyle = '#2a2a2e'
  tctx.fillRect(0, 0, 16, 16)
  tctx.fillStyle = '#222226'
  tctx.fillRect(0, 0, 8, 8)
  tctx.fillRect(8, 8, 8, 8)
  return ctx.createPattern(tile, 'repeat')!
}

const handlePoints = (
  s: DocSlice,
  zoom: number,
  offset: { x: number; y: number }
): { id: HandleId; x: number; y: number }[] => {
  const x = offset.x + s.x * zoom
  const y = offset.y + s.y * zoom
  const w = s.w * zoom
  const h = s.h * zoom
  return [
    { id: 'nw', x, y },
    { id: 'n', x: x + w / 2, y },
    { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: y + h / 2 },
    { id: 'se', x: x + w, y: y + h },
    { id: 's', x: x + w / 2, y: y + h },
    { id: 'sw', x, y: y + h },
    { id: 'w', x, y: y + h / 2 }
  ]
}

function resizeRect(
  orig: { x: number; y: number; w: number; h: number },
  handle: HandleId,
  dx: number,
  dy: number
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = orig
  if (handle.includes('e')) w = orig.w + dx
  if (handle.includes('w')) {
    x = orig.x + dx
    w = orig.w - dx
  }
  if (handle.includes('s')) h = orig.h + dy
  if (handle.includes('n')) {
    y = orig.y + dy
    h = orig.h - dy
  }
  if (w < MIN_SLICE) {
    if (handle.includes('w')) x = orig.x + orig.w - MIN_SLICE
    w = MIN_SLICE
  }
  if (h < MIN_SLICE) {
    if (handle.includes('n')) y = orig.y + orig.h - MIN_SLICE
    h = MIN_SLICE
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** 自动贴边：磁吸半径（屏幕 px）。按住 Ctrl/Meta 时暂时关闭 */
const SNAP_PX = 6

interface SnapTargets {
  xs: number[]
  ys: number[]
}

/** 目标集内离 v 最近且不超过容差的值 */
function nearestTarget(v: number, targets: number[], tol: number): number | null {
  let best: number | null = null
  let dist = tol
  for (const t of targets) {
    const d = Math.abs(t - v)
    if (d <= dist) {
      dist = d
      best = t
    }
  }
  return best
}

export default function CanvasView({
  doc,
  tree,
  rnodes,
  canvasMap,
  hiddenIds,
  preview,
  selectedIds,
  onSelect,
  onLayerContext,
  apiRef,
  onZoomChange,
  tool,
  slices,
  selectedSliceIds,
  showSlices,
  onCreateSlice,
  onSelectSlice,
  onDupSlice,
  onPickColor,
  onUpdateSlice,
  onDeleteSlice,
  onSliceContext,
  initialView,
  onViewChange
}: Props) {
  const t = useT()
  const uiPrefs = useUiPrefs()
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [drawingRect, setDrawingRect] = useState<DrawRect | null>(null)
  /** 贴边参考线（文档坐标）：切片拖拽/缩放/移动中吸附生效的边 */
  const [snapGuides, setSnapGuides] = useState<{ x: number[]; y: number[] } | null>(null)
  /** 贴边目标集（文档坐标，拖拽开始时构建） */
  const snapTargetsRef = useRef<SnapTargets | null>(null)
  /** 选择工具下已选中时，悬停的其它图层 id（用于中心距测量） */
  const [hoverId, setHoverId] = useState<number | null>(null)
  const lastFitDoc = useRef<string>('')
  const drag = useRef<DragState | null>(null)
  /** 整篇合成结果：只在图层内容/显隐变化时重建，平移缩放只搬运这张图 */
  const composite = useRef<{ rnodes: RNode[]; hiddenIds: Set<number>; canvas: HTMLCanvasElement } | null>(null)
  /** 每棵投影树的「可见内容框」测量缓存：位图不变则结果不变 */
  const boxCache = useRef(new WeakMap<PsdLayer, { left: number; top: number; width: number; height: number }>())
  /** 当前工具的自绘光标（箭头 / 刀 / 滴管 / 手），PNG 光栅化好了才有值 */
  const toolCursor = useToolCursor(tool)
  /** 空格临时平移 = 抓手，直接借用它的光标 */
  const panCursor = toolCursorCss('hand') ?? 'grab'
  /** 自绘光标还没生成好的那一瞬用系统光标兜底，避免空白 */
  const fallbackCursor = tool === 'slice' || tool === 'picker' ? 'crosshair' : tool === 'hand' ? 'grab' : 'default'

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!doc || size.w === 0 || size.h === 0) return
    const scale = Math.min((size.w - 80) / doc.width, (size.h - 80) / doc.height)
    const z = Math.max(0.02, Math.min(8, scale))
    setZoom(z)
    setOffset({ x: (size.w - doc.width * z) / 2, y: (size.h - doc.height * z) / 2 })
  }, [doc, size.w, size.h])

  useEffect(() => {
    if (doc && doc.fileName !== lastFitDoc.current && size.w > 0) {
      lastFitDoc.current = doc.fileName
      // 上次视口只在本文档首次可见时生效一次，之后交给缩放/平移
      if (initialView) {
        setZoom(Math.max(0.02, Math.min(32, initialView.zoom)))
        setOffset({ x: initialView.x, y: initialView.y })
      } else fit()
    }
  }, [doc, size.w, fit, initialView])

  const applyZoom = useCallback(
    (target: number) => {
      setZoom((prev) => {
        const clamped = Math.max(0.02, Math.min(32, target))
        setOffset((o) => ({
          x: size.w / 2 - ((size.w / 2 - o.x) / prev) * clamped,
          y: size.h / 2 - ((size.h / 2 - o.y) / prev) * clamped
        }))
        return clamped
      })
    },
    [size.w, size.h]
  )

  const zoomTo = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      if (size.w === 0 || size.h === 0 || rect.w <= 0 || rect.h <= 0) return
      const z = Math.max(0.02, Math.min(8, Math.min((size.w - 120) / rect.w, (size.h - 120) / rect.h)))
      setZoom(z)
      setOffset({ x: (size.w - rect.w * z) / 2 - rect.x * z, y: (size.h - rect.h * z) / 2 - rect.y * z })
    },
    [size.w, size.h]
  )

  // Space 按住 = 临时抓手（MasterGo/Figma 范式），松开恢复原工具
  const spaceRef = useRef(false)
  const [spaceActive, setSpaceActive] = useState(false)
  useEffect(() => {
    const editable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || editable(e.target)) return
      spaceRef.current = true
      setSpaceActive(true)
      e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpaceActive(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    onZoomChange?.(Math.round(zoom * 100))
  }, [zoom, onZoomChange])

  // 首次带 doc 的通知仍是适配前的默认视口，由调用方丢弃后再记录真实视口
  useEffect(() => {
    if (doc) onViewChange?.({ zoom, x: offset.x, y: offset.y })
  }, [doc, zoom, offset, onViewChange])

  useImperativeHandle(apiRef, () => ({ fit, applyZoom, zoomTo, getZoom: () => zoom }), [fit, applyZoom, zoomTo, zoom])

  // 选框/标注以「可见内容」为准：位图边界常含透明留白，直接画会比图形大一圈。
  // 编辑过的图层同样要量——投影后的 width 仍是位图边界，只有 alpha 才对应眼中的图形；
  // 留白按 图层宽/位图宽 缩放，重采样后依旧精确（组没有位图，度量返回 null 就照用图层边界）。
  const layerBox = (l: PsdLayer) => {
    let b = boxCache.current.get(l)
    if (!b) {
      b = measureContentRect(l, canvasMap) ?? l
      boxCache.current.set(l, b)
    }
    return b
  }

  /** 自动贴边目标：文档边缘 + 已有切片边缘 + 可见图层的可见内容框（layerBox 自带缓存）。
   *  拖拽开始时构建一次；excludeId 排除正在拖拽/缩放的切片自身的边缘，避免吸住原位 */
  const buildSnapTargets = (excludeId?: string): SnapTargets => {
    const xs = new Set<number>()
    const ys = new Set<number>()
    if (doc) {
      xs.add(0)
      xs.add(doc.width)
      ys.add(0)
      ys.add(doc.height)
    }
    for (const s of slices) {
      if (s.id === excludeId) continue
      xs.add(s.x)
      xs.add(s.x + s.w)
      ys.add(s.y)
      ys.add(s.y + s.h)
    }
    for (const l of flattenLayers(tree)) {
      if (l.children || l.hidden || hiddenIds.has(l.id) || l.width <= 0 || l.height <= 0) continue
      const b = layerBox(l)
      xs.add(b.left)
      xs.add(b.left + b.width)
      ys.add(b.top)
      ys.add(b.top + b.height)
    }
    return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) }
  }

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !doc || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0d0d0f'
    ctx.fillRect(0, 0, size.w, size.h)

    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(zoom, zoom)
    ctx.fillStyle = makeCheckerPattern(ctx)
    ctx.fillRect(0, 0, doc.width, doc.height)
    if (preview) {
      // 解码未完成：先铺 PSD 内嵌合成图，画面即刻可用；显隐变更等解码完成后一并生效
      ctx.drawImage(preview, 0, 0)
    } else {
      if (!composite.current || composite.current.rnodes !== rnodes || composite.current.hiddenIds !== hiddenIds) {
        composite.current = {
          rnodes,
          hiddenIds,
          canvas: buildCompositeCanvas(doc, rnodes, hiddenIds)
        }
      }
      ctx.drawImage(composite.current.canvas, 0, 0)
    }
    ctx.restore()

    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4c7bf3'
    const accent2 = getComputedStyle(document.body).getPropertyValue('--accent-2').trim() || accent

    // 图层选中（支持多选）
    if (selectedIds.size > 0) {
      for (const layer of flattenLayers(tree)) {
        if (!selectedIds.has(layer.id)) continue
        const box = layerBox(layer)
        const x = offset.x + box.left * zoom
        const y = offset.y + box.top * zoom
        const w = box.width * zoom
        const h = box.height * zoom
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
        ctx.strokeStyle = accent2
        ctx.lineWidth = 2
        const s = 6
        const corners: [number, number, number, number][] = [
          [x, y, 1, 1],
          [x + w, y, -1, 1],
          [x, y + h, 1, -1],
          [x + w, y + h, -1, -1]
        ]
        for (const [cx, cy, dx, dy] of corners) {
          ctx.beginPath()
          ctx.moveTo(cx + dx * s, cy)
          ctx.lineTo(cx, cy)
          ctx.lineTo(cx, cy + dy * s)
          ctx.stroke()
        }
        ctx.fillStyle = accent
        ctx.font = '11px sans-serif'
        ctx.fillText(`${box.width} × ${box.height}`, x, y - 6)
      }
    }

    // Figma 式间距：选中图层包围盒 ↔ 悬停图层，边到边的水平/垂直间隙
    if (uiPrefs.hoverMeasure && tool === 'move' && selectedIds.size > 0 && hoverId !== null && !selectedIds.has(hoverId)) {
      const layers = flattenLayers(tree)
      const hov = layers.find((l) => l.id === hoverId)
      const sel = layers.filter((l) => selectedIds.has(l.id))
      if (hov && sel.length) {
        let ax0 = Infinity
        let ay0 = Infinity
        let ax1 = -Infinity
        let ay1 = -Infinity
        for (const l of sel) {
          const b = layerBox(l)
          ax0 = Math.min(ax0, b.left)
          ay0 = Math.min(ay0, b.top)
          ax1 = Math.max(ax1, b.left + b.width)
          ay1 = Math.max(ay1, b.top + b.height)
        }
        const hb = layerBox(hov)
        const bx0 = hb.left
        const by0 = hb.top
        const bx1 = hb.left + hb.width
        const by1 = hb.top + hb.height
        const X = (v: number): number => offset.x + v * zoom
        const Y = (v: number): number => offset.y + v * zoom
        const gap = (a0: number, a1: number, b0: number, b1: number): number | null =>
          b0 >= a1 ? b0 - a1 : a0 >= b1 ? a0 - b1 : null
        const gx = gap(ax0, ax1, bx0, bx1)
        const gy = gap(ay0, ay1, by0, by1)
        ctx.strokeStyle = accent2
        ctx.lineWidth = 1
        ctx.setLineDash([5, 4])
        ctx.strokeRect(X(ax0) - 0.5, Y(ay0) - 0.5, (ax1 - ax0) * zoom + 1, (ay1 - ay0) * zoom + 1)
        ctx.strokeRect(X(bx0) - 0.5, Y(by0) - 0.5, (bx1 - bx0) * zoom + 1, (by1 - by0) * zoom + 1)
        ctx.setLineDash([])
        const measure = (
          sx: number,
          sy: number,
          ex: number,
          ey: number,
          val: number,
          horizontal: boolean
        ): void => {
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(ex, ey)
          ctx.stroke()
          // 两端垂直短刻度
          ctx.beginPath()
          for (const [px, py] of [
            [sx, sy],
            [ex, ey]
          ]) {
            if (horizontal) {
              ctx.moveTo(px, py - 3)
              ctx.lineTo(px, py + 3)
            } else {
              ctx.moveTo(px - 3, py)
              ctx.lineTo(px + 3, py)
            }
          }
          ctx.stroke()
          const label = String(Math.round(val))
          ctx.font = '11px Consolas, monospace'
          const tw = ctx.measureText(label).width + 10
          const cx = (sx + ex) / 2
          const cy = (sy + ey) / 2
          ctx.fillStyle = accent2
          ctx.fillRect(cx - tw / 2, cy - 9, tw, 18)
          ctx.fillStyle = '#fff'
          ctx.fillText(label, cx - tw / 2 + 5, cy + 4)
        }
        if (gx !== null) {
          const o0 = Math.max(ay0, by0)
          const o1 = Math.min(ay1, by1)
          const lineY =
            o1 > o0 ? (o0 + o1) / 2 : by1 <= ay0 ? ay0 : by0 >= ay1 ? ay1 : (ay0 + ay1) / 2
          const aXe = bx0 >= ax1 ? ax1 : ax0
          const bXe = bx0 >= ax1 ? bx0 : bx1
          measure(X(aXe), Y(lineY), X(bXe), Y(lineY), gx, true)
        }
        if (gy !== null) {
          const h0 = Math.max(ax0, bx0)
          const h1 = Math.min(ax1, bx1)
          const lineX =
            h1 > h0 ? (h0 + h1) / 2 : bx1 <= ax0 ? ax0 : bx0 >= ax1 ? ax1 : (ax0 + ax1) / 2
          const aYe = by0 >= ay1 ? ay1 : ay0
          const bYe = by0 >= ay1 ? by0 : by1
          measure(X(lineX), Y(aYe), X(lineX), Y(bYe), gy, false)
        }
        // 包含关系（如选中组、悬停组内子层）：两轴 gap 均为 null，
        // 按 Figma 语义显示子层到组包围盒四边的内边距
        if (gx === null && gy === null && bx0 >= ax0 && bx1 <= ax1 && by0 >= ay0 && by1 <= ay1) {
          const cyL = (by0 + by1) / 2
          const cxV = (bx0 + bx1) / 2
          if (bx0 > ax0) measure(X(ax0), Y(cyL), X(bx0), Y(cyL), bx0 - ax0, true)
          if (bx1 < ax1) measure(X(bx1), Y(cyL), X(ax1), Y(cyL), ax1 - bx1, true)
          if (by0 > ay0) measure(X(cxV), Y(ay0), X(cxV), Y(by0), by0 - ay0, false)
          if (by1 < ay1) measure(X(cxV), Y(by1), X(cxV), Y(ay1), ay1 - by1, false)
        }
      }
    }

    // 切片
    if (showSlices) {
      const singleSelected =
        selectedSliceIds.size === 1 ? slices.find((s) => selectedSliceIds.has(s.id)) ?? null : null
      for (const s of slices) {
        const x = offset.x + s.x * zoom
        const y = offset.y + s.y * zoom
        const w = s.w * zoom
        const h = s.h * zoom
        const selected = selectedSliceIds.has(s.id)
        ctx.fillStyle = selected ? 'rgba(76,123,243,0.16)' : 'rgba(76,123,243,0.06)'
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = accent
        ctx.lineWidth = selected ? 1.5 : 1
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
        const label = s.name?.trim() ? `${s.no}·${s.name.trim()}` : s.no
        ctx.font = '10px Consolas, monospace'
        const tw = ctx.measureText(label).width + 10
        ctx.fillStyle = accent
        ctx.fillRect(x, y, tw, 15)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, x + 5, y + 11)
        // 单选时的 8 个控制柄
        if (singleSelected?.id === s.id) {
          ctx.fillStyle = '#fff'
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5
          for (const hx of handlePoints(s, zoom, offset)) {
            ctx.beginPath()
            ctx.rect(hx.x - 3.5, hx.y - 3.5, 7, 7)
            ctx.fill()
            ctx.stroke()
          }
        }
      }
      if (drawingRect) {
        const x = offset.x + drawingRect.x * zoom
        const y = offset.y + drawingRect.y * zoom
        ctx.setLineDash([4, 3])
        ctx.strokeStyle = accent2
        ctx.strokeRect(x - 0.5, y - 0.5, drawingRect.w * zoom + 1, drawingRect.h * zoom + 1)
        ctx.setLineDash([])
      }
      // 贴边参考线：吸附生效的边画通栏参考线（白晕 + 主题色，任意底色上都可见）
      if (snapGuides) {
        for (const gx of snapGuides.x) {
          const x = Math.round(offset.x + gx * zoom) + 0.5
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'
          ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.h); ctx.stroke()
          ctx.strokeStyle = accent
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.h); ctx.stroke()
        }
        for (const gy of snapGuides.y) {
          const y = Math.round(offset.y + gy * zoom) + 0.5
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'
          ctx.lineWidth = 3
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.w, y); ctx.stroke()
          ctx.strokeStyle = accent
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.w, y); ctx.stroke()
        }
        ctx.lineWidth = 1
      }
    }
  }, [doc, tree, rnodes, canvasMap, hiddenIds, preview, selectedIds, zoom, offset, size, slices, selectedSliceIds, showSlices, drawingRect, tool, hoverId, uiPrefs, snapGuides])

  // 滚轮缩放
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (!(e.ctrlKey || e.metaKey)) {
        // 默认滚轮 = 页面滚动（上下/左右平移画布）
        setOffset((o) => ({ x: o.x - e.deltaX, y: o.y - e.deltaY }))
        return
      }
      // Ctrl/⌘ + 滚轮 = 以光标为锚点缩放
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setZoom((prev) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        const next = Math.max(0.02, Math.min(32, prev * factor))
        setOffset((o) => ({
          x: mx - ((mx - o.x) / prev) * next,
          y: my - ((my - o.y) / prev) * next
        }))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 夹持平移：任一方向至少保留 60px 画布在视口内，缩放/滚动都不会把设计稿移出可达范围
  useEffect(() => {
    if (!doc) return
    const MIN = 60
    const dw = doc.width * zoom
    const dh = doc.height * zoom
    const cx = Math.min(Math.max(offset.x, MIN - dw), size.w - MIN)
    const cy = Math.min(Math.max(offset.y, MIN - dh), size.h - MIN)
    if (cx !== offset.x || cy !== offset.y) setOffset({ x: cx, y: cy })
  }, [doc, zoom, offset, size])

  const hitSlice = (mx: number, my: number): DocSlice | null => {
    const dx = (mx - offset.x) / zoom
    const dy = (my - offset.y) / zoom
    for (let i = slices.length - 1; i >= 0; i--) {
      const s = slices[i]
      if (dx >= s.x && dx <= s.x + s.w && dy >= s.y && dy <= s.y + s.h) return s
    }
    return null
  }

  const hitLayer = (mx: number, my: number): PsdLayer | null => {
    if (!doc) return null
    const dx = (mx - offset.x) / zoom
    const dy = (my - offset.y) / zoom
    // 自顶向下找候选（flattenLayers 为自底向上，需倒序）
    const all = flattenLayers(tree)
    const rectHits: PsdLayer[] = []
    for (let i = all.length - 1; i >= 0; i--) {
      const layer = all[i]
      if (layer.children || layer.hidden || hiddenIds.has(layer.id)) continue
      if (
        dx >= layer.left &&
        dx <= layer.left + layer.width &&
        dy >= layer.top &&
        dy <= layer.top + layer.height
      ) {
        rectHits.push(layer)
      }
    }
    // 优先命中不透明像素（容差随缩放变化，约 2 个屏幕像素）。
    // 位图还没解码的图层（快速进入的预览期，以及文本/空图层）不参与像素命中，
    // 但保留矩形命中资格：预览期也能正常选择，解码完成后像素级命中自动接管
    const r = Math.max(0, Math.ceil(2 / zoom))
    for (const layer of rectHits) {
      const c = canvasMap.get(layer.id)
      if (!c) continue
      const px = dx - layer.left
      const py = dy - layer.top
      const sx = c.width / Math.max(1, layer.width)
      const sy = c.height / Math.max(1, layer.height)
      const bx = Math.round(px * sx)
      const by = Math.round(py * sy)
      const rad = Math.round(r * sx)
      try {
        const x0 = Math.max(0, bx - rad)
        const y0 = Math.max(0, by - rad)
        const w = Math.min(c.width - x0, rad * 2 + 1)
        const h = Math.min(c.height - y0, rad * 2 + 1)
        if (w <= 0 || h <= 0) continue
        const d = readLayerPixels(c, x0, y0, w, h)?.data
        if (!d) continue
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] > 0) return layer
        }
      } catch {
        // getImageData 失败时退回矩形命中
      }
    }
    return rectHits[0] ?? null
  }

  const pickColor = (mx: number, my: number): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    try {
      const d = ctx.getImageData(Math.round(mx * dpr), Math.round(my * dpr), 1, 1).data
      if (d[3] === 0) return null
      return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
    } catch {
      return null
    }
  }

  const hitHandle = (mx: number, my: number, s: DocSlice): HandleId | null => {
    for (const p of handlePoints(s, zoom, offset)) {
      if (Math.abs(mx - p.x) <= 6 && Math.abs(my - p.y) <= 6) return p.id
    }
    return null
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const rect = containerRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (spaceRef.current) {
      drag.current = { mode: 'pan', startX: mx, startY: my, originX: offset.x, originY: offset.y, moved: false }
      return
    }
    if (tool === 'slice') {
      const docStart = { x: (mx - offset.x) / zoom, y: (my - offset.y) / zoom }
      if (selectedSliceIds.size === 1) {
        const sel = slices.find((s) => selectedSliceIds.has(s.id))
        if (sel) {
          const h = hitHandle(mx, my, sel)
          if (h) {
            snapTargetsRef.current = buildSnapTargets(sel.id)
            drag.current = {
              mode: 'resize', startX: mx, startY: my, originX: offset.x, originY: offset.y,
              moved: false, sliceId: sel.id, handle: h, docStart, origRect: { ...sel }
            }
            return
          }
        }
      }
      const hit = hitSlice(mx, my)
      if (hit) {
        if (e.altKey) {
          const dup = onDupSlice(hit.id)
          if (dup) {
            snapTargetsRef.current = buildSnapTargets()
            drag.current = {
              mode: 'move', startX: mx, startY: my, originX: offset.x, originY: offset.y,
              moved: false, sliceId: dup.id, docStart, origRect: dup.rect
            }
            return
          }
        }
        snapTargetsRef.current = buildSnapTargets(hit.id)
        drag.current = {
          mode: 'move', startX: mx, startY: my, originX: offset.x, originY: offset.y,
          moved: false, sliceId: hit.id, docStart, origRect: { ...hit }
        }
        return
      }
      snapTargetsRef.current = buildSnapTargets()
      drag.current = { mode: 'draw', startX: mx, startY: my, originX: offset.x, originY: offset.y, moved: false, docStart }
      return
    }
    drag.current = { mode: 'pan', startX: mx, startY: my, originX: offset.x, originY: offset.y, moved: false }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const d = drag.current
    if (!d) {
      // 悬停光标
      const el = containerRef.current
      if (el) {
        if (spaceActive) {
          el.style.cursor = panCursor
        } else if (tool === 'slice') {
          const sel = selectedSliceIds.size === 1 ? slices.find((s) => selectedSliceIds.has(s.id)) : undefined
          const h = sel ? hitHandle(mx, my, sel) : null
          el.style.cursor = h ? HANDLE_CURSORS[h] : toolCursor ?? fallbackCursor
        } else {
          el.style.cursor = toolCursor ?? fallbackCursor
        }
      }
      // 选择工具 + 已有选中：跟踪悬停图层做中心距测量
      if (tool === 'move' && selectedIds.size > 0 && !spaceActive) {
        const hit = hitLayer(mx, my)
        const id = hit && !selectedIds.has(hit.id) ? hit.id : null
        setHoverId((prev) => (prev === id ? prev : id))
      } else {
        setHoverId((prev) => (prev === null ? prev : null))
      }
      return
    }
    const docCur = { x: (mx - offset.x) / zoom, y: (my - offset.y) / zoom }
    if (d.mode === 'draw' && d.docStart) {
      const x1 = Math.min(d.docStart.x, docCur.x)
      const x2 = Math.max(d.docStart.x, docCur.x)
      const y1 = Math.min(d.docStart.y, docCur.y)
      const y2 = Math.max(d.docStart.y, docCur.y)
      const rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
      // 四条边各自向最近目标磁吸；按住 Ctrl/Meta 暂时关闭贴边
      const snap = e.ctrlKey || e.metaKey ? null : snapTargetsRef.current
      if (snap) {
        const tol = SNAP_PX / zoom
        const guides = { x: [] as number[], y: [] as number[] }
        const sx1 = nearestTarget(x1, snap.xs, tol)
        if (sx1 !== null) { rect.x = sx1; rect.w = x2 - sx1; guides.x.push(sx1) }
        const sx2 = nearestTarget(x2, snap.xs, tol)
        if (sx2 !== null) { rect.w = sx2 - rect.x; guides.x.push(sx2) }
        const sy1 = nearestTarget(y1, snap.ys, tol)
        if (sy1 !== null) { rect.y = sy1; rect.h = y2 - sy1; guides.y.push(sy1) }
        const sy2 = nearestTarget(y2, snap.ys, tol)
        if (sy2 !== null) { rect.h = sy2 - rect.y; guides.y.push(sy2) }
        setSnapGuides(guides.x.length || guides.y.length ? guides : null)
      } else setSnapGuides(null)
      setDrawingRect(rect)
      return
    }
    const dx = mx - d.startX
    const dy = my - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.mode === 'pan') {
      if (d.moved) setOffset({ x: d.originX + dx, y: d.originY + dy })
      return
    }
    if (d.mode === 'move' && d.origRect && d.moved && d.docStart) {
      let x = d.origRect.x + (docCur.x - d.docStart.x)
      let y = d.origRect.y + (docCur.y - d.docStart.y)
      const snap = e.ctrlKey || e.metaKey ? null : snapTargetsRef.current
      if (snap) {
        const tol = SNAP_PX / zoom
        const guides = { x: [] as number[], y: [] as number[] }
        // 左/右两缘各自找吸附目标，取修正量小的那个（切片尺寸不变）
        const sl = nearestTarget(x, snap.xs, tol)
        const sr = nearestTarget(x + d.origRect.w, snap.xs, tol)
        const dl = sl !== null ? Math.abs(sl - x) : Infinity
        const dr = sr !== null ? Math.abs(sr - (x + d.origRect.w)) : Infinity
        if (sl !== null || sr !== null) {
          if (dl <= dr) { x = sl!; guides.x.push(sl!) }
          else { x = sr! - d.origRect.w; guides.x.push(sr!) }
        }
        const st = nearestTarget(y, snap.ys, tol)
        const sb = nearestTarget(y + d.origRect.h, snap.ys, tol)
        const dt = st !== null ? Math.abs(st - y) : Infinity
        const db = sb !== null ? Math.abs(sb - (y + d.origRect.h)) : Infinity
        if (st !== null || sb !== null) {
          if (dt <= db) { y = st!; guides.y.push(st!) }
          else { y = sb! - d.origRect.h; guides.y.push(sb!) }
        }
        setSnapGuides(guides.x.length || guides.y.length ? guides : null)
      } else setSnapGuides(null)
      onUpdateSlice(d.sliceId!, {
        x: Math.round(x),
        y: Math.round(y),
        w: d.origRect.w,
        h: d.origRect.h
      })
      return
    }
    if (d.mode === 'resize' && d.origRect && d.handle && d.docStart) {
      const rect = resizeRect(d.origRect, d.handle, docCur.x - d.docStart.x, docCur.y - d.docStart.y)
      const snap = e.ctrlKey || e.metaKey ? null : snapTargetsRef.current
      if (snap) {
        const tol = SNAP_PX / zoom
        const guides = { x: [] as number[], y: [] as number[] }
        // 只吸附被拖动的那条边；吸附会小于最小尺寸时放弃
        if (d.handle.includes('e') || d.handle.includes('w')) {
          const east = d.handle.includes('e')
          const fixed = east ? rect.x : rect.x + rect.w
          const s = nearestTarget(east ? rect.x + rect.w : rect.x, snap.xs, tol)
          if (s !== null && Math.abs(s - fixed) >= MIN_SLICE) {
            if (east) rect.w = s - rect.x
            else {
              rect.w = fixed - s
              rect.x = s
            }
            guides.x.push(s)
          }
        }
        if (d.handle.includes('s') || d.handle.includes('n')) {
          const south = d.handle.includes('s')
          const fixed = south ? rect.y : rect.y + rect.h
          const s = nearestTarget(south ? rect.y + rect.h : rect.y, snap.ys, tol)
          if (s !== null && Math.abs(s - fixed) >= MIN_SLICE) {
            if (south) rect.h = s - rect.y
            else {
              rect.h = fixed - s
              rect.y = s
            }
            guides.y.push(s)
          }
        }
        setSnapGuides(guides.x.length || guides.y.length ? guides : null)
      } else setSnapGuides(null)
      onUpdateSlice(d.sliceId!, rect)
    }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    const d = drag.current
    drag.current = null
    setSnapGuides(null)
    if (!d) return
    const rect = containerRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (d.mode === 'draw') {
      const rectDoc = drawingRect
      setDrawingRect(null)
      if (rectDoc && rectDoc.w >= 8 && rectDoc.h >= 8) {
        onCreateSlice({
          x: Math.round(rectDoc.x),
          y: Math.round(rectDoc.y),
          w: Math.round(rectDoc.w),
          h: Math.round(rectDoc.h)
        })
      } else {
        const hit = hitSlice(mx, my)
        if (hit) onSelectSlice(hit.id, e.shiftKey || e.ctrlKey || e.metaKey)
        else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) onSelectSlice(null)
      }
      return
    }
    if (d.mode === 'pan' && !d.moved) {
      const mods = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
      if (tool === 'move') {
        onSelect(hitLayer(mx, my), mods)
      } else if (tool === 'picker') {
        const hex = pickColor(mx, my)
        if (hex) onPickColor(hex)
      }
      return
    }
    if (!d.moved && d.sliceId) onSelectSlice(d.sliceId, e.shiftKey || e.ctrlKey || e.metaKey)
  }

  const cursor = spaceActive ? panCursor : toolCursor ?? fallbackCursor

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!containerRef.current) return
    if (tool === 'slice') {
      const rect = containerRef.current.getBoundingClientRect()
      const hit = hitSlice(e.clientX - rect.left, e.clientY - rect.top)
      if (hit) onSliceContext?.(hit.id, e.clientX, e.clientY)
      return
    }
    if (tool !== 'move' || !onLayerContext) return
    const rect = containerRef.current.getBoundingClientRect()
    const hit = hitLayer(e.clientX - rect.left, e.clientY - rect.top)
    if (hit) onLayerContext(hit, e.clientX, e.clientY)
  }

  if (!doc) {
    return (
      <div ref={containerRef} className="flex flex-1 items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-panel">
            <span className="text-2xl font-bold text-accent-2">切</span>
          </div>
          <div>
            <p className="text-[15px] font-medium text-txt">{t('打开一个 PSD 文件开始切图')}</p>
            <p className="mt-1 text-[12px] text-txt-3">{t('在项目页上传 PSD 后点击画板进入')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      id="canvas-view"
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-bg"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => setHoverId(null)}
      onContextMenu={onContextMenu}
      style={{ cursor }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
