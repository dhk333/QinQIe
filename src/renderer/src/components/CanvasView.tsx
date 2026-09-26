import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { DocSlice, PsdDoc, PsdLayer } from '@/types'
import type { RNode } from '@/lib/compositor'
import { buildCompositeCanvas, flattenLayers } from '@/lib/psd'

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
  canvasMap: Map<number, HTMLCanvasElement>
  hiddenIds: Set<number>
  selectedIds: Set<number>
  onSelect: (layer: PsdLayer | null, mods: { ctrl: boolean; shift: boolean }) => void
  onLayerContext?: (layer: PsdLayer, x: number, y: number) => void
  apiRef?: React.MutableRefObject<CanvasViewApi | null>
  onZoomChange?: (pct: number) => void
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
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize'
}
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

export default function CanvasView({
  doc,
  tree,
  rnodes,
  canvasMap,
  hiddenIds,
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
  onDeleteSlice
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [drawingRect, setDrawingRect] = useState<DrawRect | null>(null)
  const lastFitDoc = useRef<string>('')
  const drag = useRef<DragState | null>(null)
  /** 整篇合成结果：只在图层内容/显隐变化时重建，平移缩放只搬运这张图 */
  const composite = useRef<{ rnodes: RNode[]; hiddenIds: Set<number>; canvas: HTMLCanvasElement } | null>(null)

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
      fit()
    }
  }, [doc, size.w, fit])

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

  useImperativeHandle(apiRef, () => ({ fit, applyZoom, zoomTo, getZoom: () => zoom }), [fit, applyZoom, zoomTo, zoom])

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
    if (!composite.current || composite.current.rnodes !== rnodes || composite.current.hiddenIds !== hiddenIds) {
      composite.current = {
        rnodes,
        hiddenIds,
        canvas: buildCompositeCanvas(doc, rnodes, hiddenIds)
      }
    }
    ctx.drawImage(composite.current.canvas, 0, 0)
    ctx.restore()

    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#4c7bf3'
    const accent2 = getComputedStyle(document.body).getPropertyValue('--accent-2').trim() || accent

    // 图层选中（支持多选）
    if (selectedIds.size > 0) {
      for (const layer of flattenLayers(tree)) {
        if (!selectedIds.has(layer.id)) continue
        const x = offset.x + layer.left * zoom
        const y = offset.y + layer.top * zoom
        const w = layer.width * zoom
        const h = layer.height * zoom
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
        ctx.fillText(`${layer.width} × ${layer.height}`, x, y - 6)
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
        // 右上角删除按钮
        ctx.fillStyle = '#fff'
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.rect(x + w - 15, y + 2, 13, 13)
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = '#ef4444'
        ctx.beginPath()
        ctx.moveTo(x + w - 11, y + 6)
        ctx.lineTo(x + w - 5, y + 12)
        ctx.moveTo(x + w - 5, y + 6)
        ctx.lineTo(x + w - 11, y + 12)
        ctx.stroke()
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
    }
  }, [doc, tree, rnodes, canvasMap, hiddenIds, selectedIds, zoom, offset, size, slices, selectedSliceIds, showSlices, drawingRect])

  // 滚轮缩放
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
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
      if (!canvasMap.has(layer.id)) continue
      if (
        dx >= layer.left &&
        dx <= layer.left + layer.width &&
        dy >= layer.top &&
        dy <= layer.top + layer.height
      ) {
        rectHits.push(layer)
      }
    }
    // 优先命中不透明像素（容差随缩放变化，约 2 个屏幕像素）
    const r = Math.max(0, Math.ceil(2 / zoom))
    for (const layer of rectHits) {
      const c = canvasMap.get(layer.id)!
      const cctx = c.getContext('2d')
      if (!cctx) continue
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
        const d = cctx.getImageData(x0, y0, w, h).data
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

  const hitDeleteBadge = (mx: number, my: number, s: DocSlice): boolean => {
    const bx = offset.x + s.x * zoom + s.w * zoom - 15
    const by = offset.y + s.y * zoom + 2
    return mx >= bx && mx <= bx + 13 && my >= by && my <= by + 13
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
      // 删除按钮优先
      for (let i = slices.length - 1; i >= 0; i--) {
        if (hitDeleteBadge(mx, my, slices[i])) {
          onDeleteSlice(slices[i].id)
          return
        }
      }
      const docStart = { x: (mx - offset.x) / zoom, y: (my - offset.y) / zoom }
      if (selectedSliceIds.size === 1) {
        const sel = slices.find((s) => selectedSliceIds.has(s.id))
        if (sel) {
          const h = hitHandle(mx, my, sel)
          if (h) {
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
            drag.current = {
              mode: 'move', startX: mx, startY: my, originX: offset.x, originY: offset.y,
              moved: false, sliceId: dup.id, docStart, origRect: dup.rect
            }
            return
          }
        }
        drag.current = {
          mode: 'move', startX: mx, startY: my, originX: offset.x, originY: offset.y,
          moved: false, sliceId: hit.id, docStart, origRect: { ...hit }
        }
        return
      }
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
          el.style.cursor = 'grab'
        } else if (tool === 'slice') {
          const onBadge = slices.some((s) => hitDeleteBadge(mx, my, s))
          el.style.cursor = onBadge ? 'pointer' : 'crosshair'
        } else {
          el.style.cursor = tool === 'hand' ? 'grab' : 'default'
        }
      }
      return
    }
    const docCur = { x: (mx - offset.x) / zoom, y: (my - offset.y) / zoom }
    if (d.mode === 'draw' && d.docStart) {
      setDrawingRect({
        x: Math.min(d.docStart.x, docCur.x),
        y: Math.min(d.docStart.y, docCur.y),
        w: Math.abs(docCur.x - d.docStart.x),
        h: Math.abs(docCur.y - d.docStart.y)
      })
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
      onUpdateSlice(d.sliceId!, {
        x: Math.round(d.origRect.x + (docCur.x - d.docStart.x)),
        y: Math.round(d.origRect.y + (docCur.y - d.docStart.y)),
        w: d.origRect.w,
        h: d.origRect.h
      })
      return
    }
    if (d.mode === 'resize' && d.origRect && d.handle && d.docStart) {
      onUpdateSlice(
        d.sliceId!,
        resizeRect(d.origRect, d.handle, docCur.x - d.docStart.x, docCur.y - d.docStart.y)
      )
    }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    const d = drag.current
    drag.current = null
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

  const cursor = spaceActive ? 'grab' : tool === 'slice' ? 'crosshair' : tool === 'hand' ? 'grab' : 'default'

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (tool !== 'move' || !onLayerContext || !containerRef.current) return
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
            <p className="text-[15px] font-medium text-txt">打开一个 PSD 文件开始切图</p>
            <p className="mt-1 text-[12px] text-txt-3">在项目页上传 PSD 后点击画板进入</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-bg"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      style={{ cursor }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
