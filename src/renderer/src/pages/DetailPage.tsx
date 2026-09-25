import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocSlice, ExportFormat, Project, ProjectPsd } from '@/types'
import {
  parsePsd,
  parsePsdFallback,
  decodeLayerCanvases,
  flattenLayers,
  buildCompositeCanvas,
  renderLayerCanvas
} from '@/lib/psd'
import { layerToDataUrl } from '@/lib/export'
import { useDialog, useToast } from '@/lib/ui'
import LayerTree from '@/components/LayerTree'
import CanvasView, { type CanvasTool, type CanvasViewApi } from '@/components/CanvasView'
import PropertiesPanel from '@/components/PropertiesPanel'
import {
  EyeIcon,
  FitIcon,
  HandIcon,
  MoveIcon,
  PickerIcon,
  SliceIcon,
  ZoomInIcon,
  ZoomOutIcon
} from '@/components/icons'
import type { PsdDoc, PsdLayer } from '@/types'
import type { RNode } from '@/lib/compositor'

interface Props {
  project: Project
  psd: ProjectPsd
  onBack: () => void
}

export default function DetailPage({ project, psd, onBack }: Props) {
  const [doc, setDoc] = useState<PsdDoc | null>(null)
  const [tree, setTree] = useState<PsdLayer[]>([])
  const [decoding, setDecoding] = useState(false)
  const [rnodes, setRnodes] = useState<RNode[]>([])
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const canvasApiRef = useRef<CanvasViewApi | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [pctMenuOpen, setPctMenuOpen] = useState(false)
  const [template, setTemplate] = useState('{名称}@{倍数}x.{格式}')
  const [tool, setTool] = useState<CanvasTool>('move')
  const [slices, setSlices] = useState<DocSlice[]>([])
  const [selectedSliceIds, setSelectedSliceIds] = useState<Set<string>>(new Set())
  const [showSlices, setShowSlices] = useState(true)
  const sliceSeq = useRef(1)
  const toast = useToast()
  const dialog = useDialog()

  // 面板拖拽
  const leftRef = useRef<HTMLElement>(null)
  const rightRef = useRef<HTMLElement>(null)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const dragRef = useRef<{ el: HTMLElement; x: number; w: number; dir: 1 | -1 } | null>(null)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const delta = (e.clientX - d.x) * d.dir
      d.el.style.width = `${Math.min(460, Math.max(170, d.w + delta))}px`
    }
    const up = () => {
      dragRef.current = null
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [])

  const startDrag = (ref: React.RefObject<HTMLElement>, dir: 1 | -1) => (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    dragRef.current = { el, x: e.clientX, w: el.getBoundingClientRect().width, dir }
    e.preventDefault()
  }

  const toggleLeft = () => {
    const el = leftRef.current
    if (!el) return
    const next = !leftCollapsed
    el.style.width = next ? '0px' : ''
    setLeftCollapsed(next)
  }
  const toggleRight = () => {
    const el = rightRef.current
    if (!el) return
    const next = !rightCollapsed
    el.style.width = next ? '0px' : ''
    setRightCollapsed(next)
  }

  useEffect(() => {
    const close = () => setPctMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // 加载 PSD
  useEffect(() => {
    let alive = true
    setLoading(true)
    window.api
      .readPsdByPath(psd.path)
      .then(async ({ name, buffer }) => {
        if (!alive) return
        let parsed
        try {
          // 两阶段加载：先只做结构解析（~50ms）让图层树/面板立即可用
          parsed = parsePsd(buffer, name, true)
        } catch {
          // 主解析器失败时使用 @webtoon/psd 兜底（支持 ZIP 压缩等），其位图已逐层渲染
          parsed = await parsePsdFallback(buffer, name)
          toast('主解析器不支持该文件，已使用备用解析器', 'warning')
        }
        canvasMapRef.current = parsed.canvasMap
        setRnodes(parsed.rnodes)
        setDoc(parsed.doc)
        setTree(parsed.tree)
        setHiddenIds(new Set())
        setSelectedId(null)
        setSlices([])
        setSelectedSliceIds(new Set())
        setLoading(false)
        // 结构阶段跳过了全部位图（canvasMap 为空）时，第二遍全量解码补上
        if (parsed.canvasMap.size === 0) {
          setDecoding(true)
          setTimeout(async () => {
            if (!alive) return
            try {
              const decoded = decodeLayerCanvases(buffer, parsed.tree)
              canvasMapRef.current = decoded.canvasMap
              setRnodes(decoded.rnodes)
              setDecoding(false)
            } catch {
              // ag-psd 能读结构但位图/蒙版数据解不动（如 Invalid mask size），
              // 整文档交给备用解析器重建树+位图，节点 id 变了需重置选中态
              try {
                const fb = await parsePsdFallback(buffer, name)
                if (!alive) return
                canvasMapRef.current = fb.canvasMap
                setRnodes(fb.rnodes)
                setDoc(fb.doc)
                setTree(fb.tree)
                setHiddenIds(new Set())
                setSelectedId(null)
                toast('主解析器不支持该文件，已使用备用解析器', 'warning')
              } catch {
                toast('图层位图解码失败', 'error')
              }
              setDecoding(false)
            }
          }, 80)
        }
      })
      .catch(() => {
        if (!alive) return
        toast('加载 PSD 失败', 'error')
        setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psd.path])

  const findLayer = useCallback(
    (nodes: PsdLayer[]): PsdLayer | null => {
      for (const n of nodes) {
        if (n.id === selectedId) return n
        const hit = n.children ? findLayer(n.children) : null
        if (hit) return hit
      }
      return null
    },
    [selectedId]
  )
  const selectedLayer = selectedId != null ? findLayer(tree) : null

  const handleExport = useCallback(
    async (format: ExportFormat, scale: number) => {
      if (!selectedLayer || !doc) return
      const canvas = renderLayerCanvas(selectedLayer, rnodes, hiddenIds)
      if (!canvas) {
        toast('该图层没有可导出的位图内容（文本或空图层）', 'warning')
        return
      }
      const safeName = selectedLayer.name.replace(/[\\/:*?"<>|]/g, '_')
      const ext = format === 'jpeg' ? 'jpg' : format
      const dataUrl = layerToDataUrl(selectedLayer, canvas, format, scale)
      const saved = await window.api.saveImage(`${safeName}@${scale}x.${ext}`, format, dataUrl)
      if (saved) toast(`已导出 ${safeName}@${scale}x.${ext}`)
    },
    [selectedLayer, doc, rnodes, hiddenIds, toast]
  )

  const toggleHidden = useCallback(
    (id: number) => {
      setHiddenIds((prev) => {
        const findNode = (nodes: PsdLayer[]): PsdLayer | null => {
          for (const n of nodes) {
            if (n.id === id) return n
            const hit = n.children ? findNode(n.children) : null
            if (hit) return hit
          }
          return null
        }
        const node = findNode(tree)
        // 组的显隐需要传导到组内全部后代（渲染/导出只检查叶子图层）
        const ids = [id]
        if (node?.children) for (const c of flattenLayers(node.children)) ids.push(c.id)
        const next = new Set(prev)
        const hide = !prev.has(id)
        for (const i of ids) {
          if (hide) next.add(i)
          else next.delete(i)
        }
        return next
      })
    },
    [tree]
  )

  // 图层树是多层结构，统计必须递归，只数 tree.length 会漏掉组内图层
  const layerCount = useMemo(() => flattenLayers(tree).length, [tree])

  const visibleLayerCount = useMemo(
    () => flattenLayers(tree).filter((n) => n.type === 'layer' && !n.hidden && !hiddenIds.has(n.id)).length,
    [tree, hiddenIds]
  )

  const exportAll = useCallback(
    async (format: ExportFormat, scale: number) => {
      const files: { name: string; dataUrl: string }[] = []
      let seq = 0
      for (const node of flattenLayers(tree)) {
        if (node.type !== 'layer' || node.hidden || hiddenIds.has(node.id)) continue
        // 走合成器出图：含蒙版、图层样式与剪贴，与画布所见一致
        const canvas = renderLayerCanvas(node, rnodes, hiddenIds)
        if (!canvas) continue
        const safe = node.name.replace(/[\\/:*?"<>|]/g, '_')
        const ext = format === 'jpeg' ? 'jpg' : format
        const name = template
          .replace('{名称}', safe)
          .replace('{倍数}', String(scale))
          .replace('{格式}', ext)
          .replace('{序号}', String(++seq).padStart(2, '0'))
        files.push({ name, dataUrl: layerToDataUrl(node, canvas, format, scale) })
      }
      if (!files.length) {
        toast('没有可导出的图层', 'warning')
        return
      }
      const res = await window.api.saveBatchImages(files)
      if (res === null) return
      toast(`已导出 ${res.saved} 个文件到所选目录`)
    },
    [tree, rnodes, hiddenIds, template, toast]
  )

  const handleTemplate = async () => {
    const t = await dialog({
      type: 'prompt',
      title: '命名模板',
      desc: '可用变量：{名称} {倍数} {格式} {序号}',
      value: template
    })
    if (!t || typeof t !== 'string') return
    setTemplate(t)
    toast('命名模板已更新')
  }

  // ========== 切片 ==========
  const handleCreateSlice = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    const no = String(sliceSeq.current++).padStart(2, '0')
    const slice: DocSlice = { id: `slice-${no}-${Date.now()}`, no, ...rect }
    setSlices((prev) => [...prev, slice])
    setSelectedSliceIds(new Set([slice.id]))
  }, [])

  const handleSelectSlice = useCallback((id: string | null, additive?: boolean) => {
    setSelectedSliceIds((prev) => {
      if (!id) return additive ? prev : new Set()
      const next = new Set(additive ? prev : [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleUpdateSlice = useCallback((id: string, rect: { x: number; y: number; w: number; h: number }) => {
    setSlices((prev) => prev.map((s) => (s.id === id ? { ...s, ...rect } : s)))
  }, [])

  const selectedSlice =
    selectedSliceIds.size === 1
      ? slices.find((s) => selectedSliceIds.has(s.id)) ?? null
      : null

  const updateSelectedSlice = (patch: Partial<DocSlice>) => {
    if (!selectedSlice) return
    setSlices((prev) => prev.map((s) => (s.id === selectedSlice.id ? { ...s, ...patch } : s)))
  }

  const deleteSelectedSlices = () => {
    if (selectedSliceIds.size === 0) return
    setSlices((prev) => prev.filter((s) => !selectedSliceIds.has(s.id)))
    setSelectedSliceIds(new Set())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const map: Record<string, CanvasTool> = { v: 'move', c: 'slice', i: 'picker', h: 'hand' }
      const t = map[e.key.toLowerCase()]
      if (t) setTool(t)
      if (e.key === 'Escape') setSelectedSliceIds(new Set())
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSliceIds.size > 0) {
        setSlices((prev) => prev.filter((s) => !selectedSliceIds.has(s.id)))
        setSelectedSliceIds(new Set())
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedSliceIds])

  const exportSlices = useCallback(
    async (format: ExportFormat, scale: number) => {
      if (!doc) return
      const targets = selectedSliceIds.size > 0 ? slices.filter((s) => selectedSliceIds.has(s.id)) : slices
      if (targets.length === 0) {
        toast('还没有切片，用切片工具在画布上拖拽创建', 'warning')
        return
      }
      const composite = buildCompositeCanvas(doc, rnodes, hiddenIds)
      if (!composite) return
      const ext = format === 'jpeg' ? 'jpg' : format
      const files = targets.map((s, i) => {
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(s.w * scale))
        c.height = Math.max(1, Math.round(s.h * scale))
        const ctx = c.getContext('2d')!
        if (format === 'jpeg') {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, c.width, c.height)
        }
        ctx.scale(scale, scale)
        ctx.drawImage(composite, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h)
        const name = template
          .replace('{名称}', `切片${s.no}`)
          .replace('{倍数}', String(scale))
          .replace('{格式}', ext)
          .replace('{序号}', String(i + 1).padStart(2, '0'))
        return { name, dataUrl: c.toDataURL(`image/${format}`, 0.92) }
      })
      const res = await window.api.saveBatchImages(files)
      if (res === null) return
      toast(`已导出 ${res.saved} 个切片到所选目录`)
    },
    [doc, slices, selectedSliceIds, rnodes, hiddenIds, template, toast]
  )

  const handlePickColor = useCallback(
    (hex: string) => {
      void navigator.clipboard.writeText(hex)
      toast(`已取色 ${hex} 并复制到剪贴板`)
    },
    [toast]
  )

  return (
    <div className="main" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <aside ref={leftRef} className={`panel panel-left${leftCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-head">
          <span className="label">图 层</span>
          <span className="count">{layerCount}</span>
        </div>
        <LayerTree
          tree={tree}
          hiddenIds={hiddenIds}
          selectedId={selectedId}
          onSelect={(l) => setSelectedId(l.id)}
          onToggleHidden={toggleHidden}
        />
        <span
          className="panel-resizer"
          onMouseDown={startDrag(leftRef, 1)}
        >
          <span className="rz-chev" onClick={toggleLeft}>{leftCollapsed ? '›' : '‹'}</span>
        </span>
      </aside>

      <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
        <CanvasView
          doc={doc}
          tree={tree}
          rnodes={rnodes}
          canvasMap={canvasMapRef.current}
          hiddenIds={hiddenIds}
          selectedId={selectedId}
          onSelect={(l) => setSelectedId(l ? l.id : null)}
          apiRef={canvasApiRef}
          onZoomChange={setZoomPct}
          tool={tool}
          slices={slices}
          selectedSliceIds={selectedSliceIds}
          showSlices={showSlices}
          onCreateSlice={handleCreateSlice}
          onSelectSlice={handleSelectSlice}
          onPickColor={handlePickColor}
          onUpdateSlice={handleUpdateSlice}
          onDeleteSlice={(id) => {
            setSlices((prev) => prev.filter((s) => s.id !== id))
            setSelectedSliceIds((prev) => {
              const next = new Set(prev)
              next.delete(id)
              return next
            })
          }}
        />

        <div className="batch-bar">
          {tool === 'slice' ? (
            <>
              <span className="batch-label">
                共 <b>{slices.length}</b> 个切片
                {selectedSliceIds.size > 0 ? ` · 已选 ${selectedSliceIds.size} 个` : ''}
              </span>
              {selectedSlice && (
                <span className="slice-editor">
                  {([['X', 'x'], ['Y', 'y'], ['W', 'w'], ['H', 'h']] as const).map(([label, key]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        value={Math.round(selectedSlice[key])}
                        onChange={(e) => updateSelectedSlice({ [key]: Number(e.target.value) || 0 })}
                      />
                    </label>
                  ))}
                  <button className="batch-mini" onClick={deleteSelectedSlices}>删除</button>
                </span>
              )}
              <button className="batch-mini" onClick={() => void handleTemplate()}>
                命名模板
              </button>
              <button className="batch-mini" onClick={() => void exportSlices('png', 2)}>
                全部 @2x
              </button>
              <button className="batch-mini go" onClick={() => void exportSlices('png', 2)}>
                批量导出
              </button>
            </>
          ) : (
            <>
              <span className="batch-label">
                共 <b>{visibleLayerCount}</b> 个可见图层
              </span>
              <button className="batch-mini" onClick={() => void handleTemplate()}>
                命名模板
              </button>
              <button className="batch-mini" onClick={() => void exportAll('png', 2)}>
                全部 @2x
              </button>
              <button className="batch-mini go" onClick={() => void exportAll('png', 2)}>
                批量导出
              </button>
            </>
          )}
        </div>

        <div className="zoombar">
          <span
            className={`zb${tool === 'move' ? ' active' : ''}`}
            title="移动 / 选择图层 (V)"
            onClick={() => setTool('move')}
          >
            <MoveIcon />
          </span>
          <span
            className={`zb${tool === 'slice' ? ' active' : ''}`}
            title="切片工具 (C) — 拖拽画切片"
            onClick={() => setTool('slice')}
          >
            <SliceIcon />
          </span>
          <span
            className={`zb${tool === 'picker' ? ' active' : ''}`}
            title="取色器 (I) — 点击画布取色并复制"
            onClick={() => setTool('picker')}
          >
            <PickerIcon />
          </span>
          <span
            className={`zb${tool === 'hand' ? ' active' : ''}`}
            title="抓手 (H) — 拖拽平移"
            onClick={() => setTool('hand')}
          >
            <HandIcon />
          </span>
          <span
            className={`zb${showSlices ? ' active' : ''}`}
            title="显示 / 隐藏切片"
            onClick={() => setShowSlices((v) => !v)}
          >
            <EyeIcon />
          </span>
          <span className="sep" />
          <span
            className="zb"
            title="缩小"
            onClick={() => canvasApiRef.current?.applyZoom(zoomPct / 100 / 1.2)}
          >
            <ZoomOutIcon />
          </span>
          <span className="pct-wrap">
            <span
              className="pct"
              onClick={(e) => {
                e.stopPropagation()
                setPctMenuOpen((v) => !v)
              }}
            >
              {zoomPct}%
            </span>
            <span
              className={`pct-menu${pctMenuOpen ? ' open' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {[25, 50, 75, 100].map((z) => (
                <span
                  key={z}
                  className={zoomPct === z ? 'on' : ''}
                  onClick={() => {
                    canvasApiRef.current?.applyZoom(z / 100)
                    setPctMenuOpen(false)
                  }}
                >
                  {z}%
                </span>
              ))}
            </span>
          </span>
          <span
            className="zb"
            title="放大"
            onClick={() => canvasApiRef.current?.applyZoom((zoomPct / 100) * 1.2)}
          >
            <ZoomInIcon />
          </span>
          <span className="sep" />
          <span className="zb" title="适应窗口" onClick={() => canvasApiRef.current?.fit()}>
            <FitIcon />
          </span>
          <span className="zb" title="100%" onClick={() => canvasApiRef.current?.applyZoom(1)}>
            <span style={{ fontFamily: 'Consolas, monospace', fontSize: 9 }}>1:1</span>
          </span>
        </div>

        {(loading || decoding) && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 30,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              justifyContent: 'center',
              background: 'rgba(10,10,12,0.55)', backdropFilter: 'blur(4px)'
            }}
          >
            <svg className="logo-draw" viewBox="0 0 352 381" width="63" height="69" fill="none" style={{ color: '#fff' }}>
              <path
                pathLength={1}
                d="M156.6,181v50.3c0,6.4-7,10.3-12.4,7l-33.3-20c-5.3-3.2-8.5-8.9-8.5-15.1V98c0-6.4,7-10.3,12.5-7l41.6,25.4L116,156.8L156.6,181z"
              />
              <path pathLength={1} d="M178.6,116.2h-22V65.7c0-6.4,7-10.3,12.5-7l41.8,25.6L178.6,116.2z" />
              <path pathLength={1} d="M188.8,148.5h22v50.6c0,6.4-7,10.3-12.4,7L156.6,181L188.8,148.5z" />
              <path
                pathLength={1}
                d="M265.1,61.9v105c0,6.4-7,10.3-12.4,7l-41.9-25.1v-0.3l40.2-40.2l-40.2-24V33.4c0-6.4,7-10.3,12.5-7l33.4,20.4C261.9,50,265.1,55.7,265.1,61.9z"
              />
            </svg>
            <span style={{ fontSize: 12, color: '#fff' }}>正在解析 PSD…</span>
          </div>
        )}
      </div>

      <aside ref={rightRef} className={`panel panel-right${rightCollapsed ? ' collapsed' : ''}`}>
        <span
          className="panel-resizer"
          onMouseDown={startDrag(rightRef, -1)}
        >
          <span className="rz-chev" onClick={toggleRight}>{rightCollapsed ? '‹' : '›'}</span>
        </span>
        <PropertiesPanel
          layer={selectedLayer}
          doc={doc}
          rnodes={rnodes}
          canvasMap={canvasMapRef.current}
          hiddenIds={hiddenIds}
          onExport={handleExport}
        />
      </aside>
    </div>
  )
}
