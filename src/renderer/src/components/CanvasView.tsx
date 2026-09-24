import { useCallback, useEffect, useRef, useState } from 'react'
import type { PsdDoc, PsdLayer } from '@/types'
import { flattenLayers } from '@/lib/psd'
import { FitIcon, ZoomInIcon, ZoomOutIcon } from './icons'

interface Props {
  doc: PsdDoc | null
  tree: PsdLayer[]
  canvasMap: Map<number, HTMLCanvasElement>
  hiddenIds: Set<number>
  selectedId: number | null
  onSelect: (layer: PsdLayer) => void
}

interface Offset {
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

// ag-psd 的 children 顺序为自底向上（背景层在前），按数组原序绘制
const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'lighter'
}

interface DrawContext {
  canvasMap: Map<number, HTMLCanvasElement>
  hiddenIds: Set<number>
}

function drawSingleLayer(ctx: CanvasRenderingContext2D, node: PsdLayer, dc: DrawContext, blend = true) {
  if (node.hidden || dc.hiddenIds.has(node.id)) return
  const canvas = dc.canvasMap.get(node.id)
  if (!canvas || node.width === 0 || node.height === 0) return
  ctx.save()
  ctx.globalAlpha = node.opacity
  if (blend) {
    ctx.globalCompositeOperation = BLEND_MAP[node.blendMode] ?? 'source-over'
  }
  ctx.drawImage(canvas, node.left, node.top, node.width, node.height)
  ctx.restore()
}

function drawSiblings(ctx: CanvasRenderingContext2D, nodes: PsdLayer[], dc: DrawContext) {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.children) {
      drawSiblings(ctx, node.children, dc)
      continue
    }
    if (node.hidden || dc.hiddenIds.has(node.id)) continue

    // 剪贴蒙版：连续 clipping 的图层被裁切到其下方（数组前一个）基础图层的不透明区域
    const clipped: PsdLayer[] = []
    let j = i + 1
    while (j < nodes.length && nodes[j].clipping && !nodes[j].children) {
      clipped.push(nodes[j])
      j++
    }

    if (clipped.length === 0) {
      drawSingleLayer(ctx, node, dc)
      continue
    }

    const visibleClipped = clipped.filter((c) => !c.hidden && !dc.hiddenIds.has(c.id) && dc.canvasMap.has(c.id))
    if (visibleClipped.length === 0) {
      drawSingleLayer(ctx, node, dc)
      i = j - 1
      continue
    }

    const left = Math.min(node.left, ...visibleClipped.map((c) => c.left))
    const top = Math.min(node.top, ...visibleClipped.map((c) => c.top))
    const right = Math.max(node.left + node.width, ...visibleClipped.map((c) => c.left + c.width))
    const bottom = Math.max(node.top + node.height, ...visibleClipped.map((c) => c.top + c.height))
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, right - left)
    tmp.height = Math.max(1, bottom - top)
    const tctx = tmp.getContext('2d')!

    const base = { ...node, left: node.left - left, top: node.top - top }
    drawSingleLayer(tctx, base, dc, false)
    for (const c of visibleClipped) {
      drawSingleLayer(tctx, { ...c, left: c.left - left, top: c.top - top }, dc)
    }
    // 用基础图层的 alpha 裁掉溢出部分
    tctx.globalCompositeOperation = 'destination-in'
    tctx.globalAlpha = 1
    const baseCanvas = dc.canvasMap.get(node.id)!
    tctx.drawImage(baseCanvas, node.left - left, node.top - top, node.width, node.height)

    ctx.save()
    ctx.globalAlpha = node.opacity
    ctx.drawImage(tmp, left, top)
    ctx.restore()
    i = j - 1
  }
}

export default function CanvasView({ doc, tree, canvasMap, hiddenIds, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const lastFitDoc = useRef<string>('')
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)

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
    drawSiblings(ctx, tree, { canvasMap, hiddenIds })
    ctx.restore()

    if (selectedId != null) {
      const layer = flattenLayers(tree).find((l) => l.id === selectedId)
      if (layer) {
        const x = offset.x + layer.left * zoom
        const y = offset.y + layer.top * zoom
        const w = layer.width * zoom
        const h = layer.height * zoom
        ctx.strokeStyle = '#8b5cf6'
        ctx.lineWidth = 1
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
        // 四角标记
        ctx.strokeStyle = '#a78bfa'
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
        ctx.fillStyle = '#8b5cf6'
        ctx.font = '11px sans-serif'
        ctx.fillText(`${layer.width} × ${layer.height}`, x, y - 6)
      }
    }
  }, [doc, tree, canvasMap, hiddenIds, selectedId, zoom, offset, size])

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

  const hitTest = (mx: number, my: number): PsdLayer | null => {
    if (!doc) return null
    const dx = (mx - offset.x) / zoom
    const dy = (my - offset.y) / zoom
    const all = flattenLayers(tree)
    for (const layer of all) {
      if (layer.children || layer.hidden || hiddenIds.has(layer.id)) continue
      if (!canvasMap.has(layer.id)) continue
      if (
        dx >= layer.left &&
        dx <= layer.left + layer.width &&
        dy >= layer.top &&
        dy <= layer.top + layer.height
      ) {
        return layer
      }
    }
    return null
  }

  const onMouseDown = (e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false
    }
    void rect
  }

  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) {
      setOffset({ x: d.originX + dx, y: d.originY + dy })
    }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const rect = containerRef.current!.getBoundingClientRect()
    const layer = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (layer) onSelect(layer)
  }

  if (!doc) {
    return (
      <div ref={containerRef} className="flex flex-1 items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-panel">
            <span className="text-2xl font-bold text-violet-400">切</span>
          </div>
          <div>
            <p className="text-[15px] font-medium text-txt">打开一个 PSD 文件开始切图</p>
            <p className="mt-1 text-[12px] text-txt-3">点击右上角「打开 PSD」，或把文件拖到这里</p>
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
      style={{ cursor: drag.current ? 'grabbing' : 'default' }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-panel/90 px-1.5 py-1 shadow-lg backdrop-blur">
        <button
          className="icon-btn"
          title="缩小"
          onClick={() => {
            const next = Math.max(0.02, zoom / 1.2)
            setOffset((o) => ({ x: size.w / 2 - ((size.w / 2 - o.x) / zoom) * next, y: size.h / 2 - ((size.h / 2 - o.y) / zoom) * next }))
            setZoom(next)
          }}
        >
          <ZoomOutIcon className="h-4 w-4" />
        </button>
        <span className="min-w-[52px] text-center text-[12px] text-txt-2">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="icon-btn"
          title="放大"
          onClick={() => {
            const next = Math.min(32, zoom * 1.2)
            setOffset((o) => ({ x: size.w / 2 - ((size.w / 2 - o.x) / zoom) * next, y: size.h / 2 - ((size.h / 2 - o.y) / zoom) * next }))
            setZoom(next)
          }}
        >
          <ZoomInIcon className="h-4 w-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button className="icon-btn" title="适应窗口" onClick={fit}>
          <FitIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
