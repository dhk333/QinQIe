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
import { exportCanvasBytes } from '@/lib/export'
import { loadExportPrefs, saveExportPrefs } from '@/lib/exportPrefs'
import { matchCommand, effectiveDisplay, COMMAND_MAP } from '@shared/keymap'
import { useDialog, useToast } from '@/lib/ui'
import { useT } from '@/i18n/core'
import { perfBegin, perfEnd, perfReset, perfReport, perfEnabled, type PerfPhase } from '@/lib/perf'
import LayerTree, { type LayerTreeApi } from '@/components/LayerTree'
import CanvasView, { type CanvasTool, type CanvasViewApi } from '@/components/CanvasView'
import ContextMenu from '@/components/ContextMenu'
import Slider from '@/components/Slider'
import AppLogo from '@/components/AppLogo'
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
  onUpdatePsd: (mutate: (psd: ProjectPsd) => void) => void
  onBack: () => void
}

function findInTree(nodes: PsdLayer[], id: number): PsdLayer | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children ? findInTree(n.children, id) : null
    if (hit) return hit
  }
  return null
}

/** dev 专用：解析各阶段耗时 + 合成统计，左下角常驻小条 */
function PerfChip() {
  const t = useT()
  const [, tick] = useState(0)
  useEffect(() => {
    if (!perfEnabled) return
    const id = window.setInterval(() => tick((n) => n + 1), 800)
    return () => window.clearInterval(id)
  }, [])
  const rep = perfReport()
  if (!rep) return null
  const label: Record<PerfPhase, string> = {
    read: t('读取'),
    structure: t('结构解析'),
    decode: t('位图解码'),
    fallback: t('备用解析')
  }
  const parts = rep.phases.map((p) => `${label[p.phase]} ${p.ms}ms`)
  if (rep.composite.count > 0) {
    const d = rep.detail
    parts.push(
      `${t('合成')} ${rep.composite.last}ms×${rep.composite.count}` +
        ` [烘焙${d.bakes} 叶${d.leaves} 画布${d.canvases}/${(d.canvasPx / 1e6).toFixed(0)}Mpx]`
    )
  }
  return <div className="perf-chip">{parts.join(' · ')}</div>
}

export default function DetailPage({ project, psd, onUpdatePsd, onBack }: Props) {
  const t = useT()
  const [doc, setDoc] = useState<PsdDoc | null>(null)
  const [tree, setTree] = useState<PsdLayer[]>([])
  const [decoding, setDecoding] = useState(false)
  /** 解码完成前画布用的 PSD 内嵌合成图占位 */
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null)
  const [rnodes, setRnodes] = useState<RNode[]>([])
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map())
  /** 待执行的第二遍全量解码任务（入场动画点亮后消费） */
  const decodeJobRef = useRef<{ buffer: Uint8Array; name: string; tree: PsdLayer[] } | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const anchorRef = useRef<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; ids: number[] } | null>(null)
  const [loading, setLoading] = useState(true)
  /** 加载进度：loadTarget 是里程碑下限，loadPct 按「恒定慢速上升」逐帧逼近它。
   *  条和数字共用同一个 loadPct，永不错位；未到终点前始终保持可见的移动，
   *  不会在某档停住等下一档——主线程被解码卡住时整屏本就冻结，恢复后继续爬。 */
  const [loadTarget, setLoadTarget] = useState(0)
  const [loadPct, setLoadPct] = useState(0)
  // 有内嵌合成图预览时不再等解码：先揭示界面，解码在入场动画点亮后台补
  const contentReady = !loading && (!decoding || !!previewCanvas)
  useEffect(() => {
    if (!contentReady) return
    setLoadTarget(100)
  }, [contentReady])
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      setLoadPct((p) => {
        // 未到下一档里程碑时保持 2%/s 蠕行，永不停死；冲刺里程碑时用远快近慢速度
        const gap = loadTarget - p
        if (gap > 0.05) {
          const speed = gap > 30 ? 26 : gap > 10 ? 14 : 8
          return Math.min(loadTarget, p + speed * dt)
        }
        // 终点档只许涨不许跌：旧实现在 (99.95,100) 区间会把 p 重置回 99，
        // 造成每帧 99→100→99 的无限重渲染（CPU 满载死循环）
        if (loadTarget >= 100) return Math.min(100, p)
        return p >= 99 ? p : Math.min(99, p + 2 * dt)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loadTarget])
  /** 加载完成后加载层不立即卸载：先播完渐出动画再由 onAnimationEnd 移除 */
  const [loaderGone, setLoaderGone] = useState(false)
  /** 出屏许可：进度条缓动真正爬满后才允许加载层渐出，避免半途消失 */
  const [exitArmed, setExitArmed] = useState(false)
  useEffect(() => {
    if (!contentReady) {
      setLoaderGone(false)
      setExitArmed(false)
      return
    }
    if (loadPct >= 99.6) {
      setExitArmed(true)
      return
    }
    // 兜底：极端情况下最多再等 2s 也必须放行
    const t = setTimeout(() => setExitArmed(true), 2000)
    return () => clearTimeout(t)
  }, [contentReady, loadPct])
  /** 入场许可：布局先在加载层遮挡下挂载并完成首轮合成（重活、会卡主线程），
   *  之后才同时点亮加载层渐出与面板/画布入场动画，保证动画全程可见 */
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!exitArmed) {
      setEntered(false)
      return
    }
    let t = 0
    const r1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        t = window.setTimeout(() => setEntered(true), 120)
      })
    })
    return () => {
      cancelAnimationFrame(r1)
      clearTimeout(t)
    }
  }, [exitArmed])
  const canvasApiRef = useRef<CanvasViewApi | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [pctMenuOpen, setPctMenuOpen] = useState(false)
  const [template, setTemplate] = useState('{名称}@{倍数}x.{格式}')
  const [tool, setTool] = useState<CanvasTool>('move')
  const [slices, setSlicesRaw] = useState<DocSlice[]>(() => psd.slices ?? [])
  const [selectedSliceIds, setSelectedSliceIds] = useState<Set<string>>(new Set())
  const [showSlices, setShowSlices] = useState(true)
  const sliceSeq = useRef(1)
  // 切片撤销栈：切片是小数组，直接存快照比存反操作可靠
  const histRef = useRef<{ past: DocSlice[][]; future: DocSlice[][] }>({ past: [], future: [] })
  const editBaseRef = useRef<DocSlice[] | null>(null)
  const lastSavedRef = useRef<DocSlice[]>(slices)
  const slicesRef = useRef(slices)
  slicesRef.current = slices
  // 批量导出参数（图层与切片共用一套弹层）
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchFmt, setBatchFmt] = useState<ExportFormat>(() => loadExportPrefs().format)
  const [batchScales, setBatchScales] = useState<Set<number>>(() => new Set(loadExportPrefs().scales))
  const [batchQuality, setBatchQuality] = useState(() => loadExportPrefs().quality)
  useEffect(() => {
    if (batchScales.size)
      saveExportPrefs({ format: batchFmt, scales: [...batchScales].sort((a, b) => a - b), quality: batchQuality })
  }, [batchFmt, batchScales, batchQuality])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const cancelRef = useRef(false)
  const layerTreeRef = useRef<LayerTreeApi>(null)
  const sliceNameRef = useRef<HTMLInputElement>(null)
  const commandRef = useRef<(id: string) => void>(() => {})
  const toast = useToast()
  const dialog = useDialog()

  // 切片的一切修改统一走这里：先记下改动前快照，静置 500ms 后提交历史并持久化
  const setSlices = useCallback(
    (next: DocSlice[] | ((prev: DocSlice[]) => DocSlice[])) => {
      setSlicesRaw((prev) => {
        if (editBaseRef.current === null) editBaseRef.current = prev
        return typeof next === 'function' ? next(prev) : next
      })
    },
    []
  )

  useEffect(() => {
    const t = setTimeout(() => {
      if (editBaseRef.current !== null && editBaseRef.current !== slices) {
        const { past } = histRef.current
        past.push(editBaseRef.current)
        if (past.length > 80) past.shift()
        histRef.current.future = []
        editBaseRef.current = null
      }
      if (lastSavedRef.current !== slices) {
        lastSavedRef.current = slices
        onUpdatePsd((p) => {
          p.slices = slices.length ? slices : undefined
        })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [slices, onUpdatePsd])

  const undoSlices = useCallback(() => {
    const prev = histRef.current.past.pop()
    if (!prev) return
    histRef.current.future.push(slicesRef.current)
    editBaseRef.current = null
    setSlicesRaw(prev)
  }, [])

  const redoSlices = useCallback(() => {
    const next = histRef.current.future.pop()
    if (!next) return
    histRef.current.past.push(slicesRef.current)
    editBaseRef.current = null
    setSlicesRaw(next)
  }, [])

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
    const close = () => {
      setPctMenuOpen(false)
      setBatchOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // 加载 PSD
  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadTarget(5)
    perfReset()
    perfBegin('read')
    window.api
      .readPsdByPath(psd.path)
      .then(async ({ name, buffer }) => {
        if (!alive) return
        perfEnd('read')
        setLoadTarget(30)
        let parsed
        let usedFallback = false
        perfBegin('structure')
        try {
          // 两阶段加载：先只做结构解析（~50ms）让图层树/面板立即可用
          parsed = parsePsd(buffer, name, true)
        } catch {
          // 主解析器失败时使用 @webtoon/psd 兜底（支持 ZIP 压缩等），其位图已逐层渲染
          perfEnd('structure')
          usedFallback = true
          perfBegin('fallback')
          parsed = await parsePsdFallback(buffer, name)
          perfEnd('fallback')
          toast(t('主解析器不支持该文件，已使用备用解析器'), 'warning')
        }
        if (!usedFallback) perfEnd('structure')
        canvasMapRef.current = parsed.canvasMap
        setRnodes(parsed.rnodes)
        setDoc(parsed.doc)
        setTree(parsed.tree)
        setHiddenIds(new Set())
        setSelectedId(null)
        setSelectedIds(new Set())
        // 两阶段：逐层位图还没解出来时，先拿内嵌合成图占位显示
        setPreviewCanvas(parsed.canvasMap.size === 0 ? (parsed.composite ?? null) : null)
        // 重新进入时恢复上次持久化的切片，序号接着排
        const restored = psd.slices ?? []
        setSlicesRaw(restored)
        setSelectedSliceIds(new Set())
        editBaseRef.current = null
        histRef.current = { past: [], future: [] }
        sliceSeq.current = restored.reduce((m, s) => Math.max(m, Number(s.no) || 0), 0) + 1
        setLoadTarget(60)
        setLoading(false)
        // 结构阶段跳过了全部位图（canvasMap 为空）时登记第二遍全量解码任务：
        // 等入场动画点亮后再跑，transform/opacity 动画在合成器线程不受主线程阻塞影响
        if (parsed.canvasMap.size === 0) {
          setDecoding(true)
          setLoadTarget(88)
          decodeJobRef.current = { buffer, name, tree: parsed.tree }
        }
      })
      .catch(() => {
        if (!alive) return
        toast(t('加载 PSD 失败'), 'error')
        setLoading(false)
      })
    return () => {
      alive = false
      decodeJobRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psd.path])

  // 入场动画点亮后执行登记的全量解码：合成器线程上的动画不会被解码阻塞卡顿。
  // entered 依赖 rAF，窗口不可见时 rAF 停摆，故带 2.5s 定时器兜底，避免解码永挂
  const startDecode = useCallback(() => {
    const job = decodeJobRef.current
    if (!job) return
    decodeJobRef.current = null
    setTimeout(async () => {
      try {
        perfBegin('decode')
        const decoded = decodeLayerCanvases(job.buffer, job.tree)
        perfEnd('decode')
        canvasMapRef.current = decoded.canvasMap
        setRnodes(decoded.rnodes)
        setPreviewCanvas(null)
        setLoadTarget(100)
        setDecoding(false)
      } catch {
        // ag-psd 能读结构但位图/蒙版数据解不动（如 Invalid mask size），
        // 整文档交给备用解析器重建树+位图，节点 id 变了需重置选中态
        try {
          const fb = await parsePsdFallback(job.buffer, job.name)
          canvasMapRef.current = fb.canvasMap
          setRnodes(fb.rnodes)
          setDoc(fb.doc)
          setTree(fb.tree)
          setHiddenIds(new Set())
          setSelectedId(null)
          setSelectedIds(new Set())
          setPreviewCanvas(null)
          toast(t('主解析器不支持该文件，已使用备用解析器'), 'warning')
        } catch {
          toast(t('图层位图解码失败'), 'error')
        }
        setLoadTarget(100)
        setDecoding(false)
      }
    }, 80)
  }, [toast, t])

  useEffect(() => {
    if (!decoding) return
    if (entered) {
      startDecode()
      return
    }
    const fb = window.setTimeout(startDecode, 2500)
    return () => window.clearTimeout(fb)
  }, [decoding, entered, startDecode])

  const selectedLayer = selectedId != null ? findInTree(tree, selectedId) : null

  const clearLayerSel = () => {
    setSelectedId(null)
    setSelectedIds(new Set())
    anchorRef.current = null
  }

  const handleLayerSelect = (layer: PsdLayer | null, mods = { ctrl: false, shift: false }) => {
    if (!layer) {
      if (!mods.ctrl) clearLayerSel()
      return
    }
    if (mods.shift && anchorRef.current != null) {
      const all = flattenLayers(tree)
      const a = all.findIndex((n) => n.id === anchorRef.current)
      const b = all.findIndex((n) => n.id === layer.id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelectedIds(new Set(all.slice(lo, hi + 1).map((n) => n.id)))
        setSelectedId(layer.id)
        return
      }
    }
    if (mods.ctrl) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(layer.id)) next.delete(layer.id)
        else next.add(layer.id)
        return next
      })
    } else {
      setSelectedIds(new Set([layer.id]))
    }
    setSelectedId(layer.id)
    anchorRef.current = layer.id
  }

  // 右键：不在当前选区里则先单选它
  const handleLayerContext = (layer: PsdLayer, x: number, y: number) => {
    if (selectedIds.has(layer.id)) {
      setMenu({ x, y, ids: [...selectedIds] })
      return
    }
    setSelectedIds(new Set([layer.id]))
    setSelectedId(layer.id)
    anchorRef.current = layer.id
    setMenu({ x, y, ids: [layer.id] })
  }

  const extOf = (f: ExportFormat) => (f === 'jpeg' ? 'jpg' : f)
  const applyTemplate = (tpl: string, name: string, scale: number, format: ExportFormat, seq: number) =>
    tpl
      .replace('{名称}', name)
      .replace('{倍数}', String(scale))
      .replace('{格式}', extOf(format))
      .replace('{序号}', String(seq).padStart(2, '0'))

  // 统一导出管线：目录选一次，逐条「编码→写盘」，随时可取消
  const writeAll = useCallback(
    async (items: { name: string; run: () => Promise<Uint8Array | null> }[]) => {
      if (!items.length) {
        toast(t('没有可导出的内容'), 'warning')
        return
      }
      const dir = await window.api.pickDir()
      if (!dir) return
      cancelRef.current = false
      setProgress({ done: 0, total: items.length })
      const used = new Set<string>()
      let saved = 0
      let i = 0
      for (const it of items) {
        if (cancelRef.current) break
        let name = it.name
        let dup = 2
        while (used.has(name.toLowerCase())) {
          const m = it.name.match(/^(.*)\.([^.]+)$/)
          name = m ? `${m[1]}（${dup}）.${m[2]}` : `${it.name}（${dup}）`
          dup++
        }
        used.add(name.toLowerCase())
        try {
          const bytes = await it.run()
          if (bytes && (await window.api.writeExportFile(dir, name, bytes))) saved++
        } catch {
          // 单个图层编码失败不阻断整批
        }
        i++
        setProgress({ done: i, total: items.length })
      }
      setProgress(null)
      toast(
        cancelRef.current
          ? t('已取消，导出 {saved} / {total} 个文件', { saved, total: items.length })
          : t('已导出 {saved} 个文件到所选目录', { saved })
      )
    },
    [toast]
  )

  const handleExport = useCallback(
    async (format: ExportFormat, scale: number, quality?: number) => {
      if (!selectedLayer || !doc) return
      if (decoding) {
        toast(t('图层还在解析中，请稍后导出'), 'warning')
        return
      }
      const canvas = renderLayerCanvas(selectedLayer, rnodes, hiddenIds)
      if (!canvas) {
        toast(t('该图层没有可导出的位图内容（文本或空图层）'), 'warning')
        return
      }
      const safeName = selectedLayer.name.replace(/[\\/:*?"<>|]/g, '_')
      const bytes = await exportCanvasBytes(canvas, { scale, format, quality })
      if (!bytes) {
        toast(t('该图层导出失败'), 'error')
        return
      }
      const saved = await window.api.saveImage(`${safeName}@${scale}x.${extOf(format)}`, format, bytes)
      if (saved) toast(t('已导出 {file}', { file: `${safeName}@${scale}x.${extOf(format)}` }))
    },
    [selectedLayer, doc, rnodes, hiddenIds, decoding, toast, t]
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

  const exportNodes = useCallback(
    (nodes: PsdLayer[], format: ExportFormat, scales: number[], quality?: number) => {
      if (decoding) {
        toast(t('图层还在解析中，请稍后导出'), 'warning')
        return
      }
      const items: { name: string; run: () => Promise<Uint8Array | null> }[] = []
      for (const scale of [...scales].sort((a, b) => a - b)) {
        let seq = 0
        for (const node of nodes) {
          // 闭包捕获当前图层；渲染/编码推迟到写盘循环里逐条执行
          const captured = node
          items.push({
            name: applyTemplate(
              template,
              captured.name.replace(/[\\/:*?"<>|]/g, '_'),
              scale,
              format,
              ++seq
            ),
            run: async () => {
              // 走合成器出图：含蒙版、图层样式与剪贴，与画布所见一致；组节点合成整棵子树
              const canvas = renderLayerCanvas(captured, rnodes, hiddenIds)
              if (!canvas) return null
              return exportCanvasBytes(canvas, { scale, format, quality })
            }
          })
        }
      }
      return writeAll(items)
    },
    [rnodes, hiddenIds, template, writeAll, decoding, toast, t]
  )

  const exportAll = useCallback(
    (format: ExportFormat, scales: number[], quality?: number) => {
      const nodes = flattenLayers(tree).filter((n) => n.type === 'layer' && !n.hidden && !hiddenIds.has(n.id))
      return exportNodes(nodes, format, scales, quality)
    },
    [tree, hiddenIds, exportNodes]
  )

  const handleTemplate = async () => {
    const input = await dialog({
      type: 'prompt',
      title: t('命名模板'),
      desc: t('可用变量：{名称} {倍数} {格式} {序号}'),
      value: template
    })
    if (!input || typeof input !== 'string') return
    setTemplate(input)
    toast(t('命名模板已更新'))
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

  // 右键菜单：按图层包围盒建切片（组用整组外接框），名字带过来
  const createSlicesFromNodes = (nodes: PsdLayer[]) => {
    const news: DocSlice[] = nodes
      .filter((n) => n.width > 0 && n.height > 0)
      .map((n) => {
        const no = String(sliceSeq.current++).padStart(2, '0')
        return {
          id: `slice-${no}-${Date.now()}`,
          no,
          x: n.left,
          y: n.top,
          w: n.width,
          h: n.height,
          name: n.name.slice(0, 40)
        }
      })
    if (!news.length) return
    setSlices((prev) => [...prev, ...news])
    setSelectedSliceIds(new Set(news.map((s) => s.id)))
    toast(t('已从图层创建 {n} 个切片', { n: news.length }))
  }

  // 隔离显示：只留下所选子树内的可见图层，「显示全部」恢复
  const isolateNodes = (nodes: PsdLayer[]) => {
    const keep = new Set<number>()
    const collect = (n: PsdLayer) => {
      keep.add(n.id)
      n.children?.forEach(collect)
    }
    nodes.forEach(collect)
    const next = new Set<number>()
    for (const leaf of flattenLayers(tree)) {
      if (leaf.type === 'layer' && !keep.has(leaf.id)) next.add(leaf.id)
    }
    setHiddenIds(next)
    toast(t('已隔离显示 {n} 个图层/组', { n: nodes.length }))
  }

  const menuItems = (() => {
    if (!menu) return []
    const nodes = menu.ids
      .map((id) => findInTree(tree, id))
      .filter((n): n is PsdLayer => n !== null)
    if (!nodes.length) return []
    return [
      {
        label: t('导出所选 {n} 个图层…', { n: nodes.length }),
        hint: effectiveDisplay(COMMAND_MAP['export.batch']),
        onClick: () =>
          void exportNodes(nodes, batchFmt, [...batchScales], batchFmt === 'png' ? undefined : batchQuality)
      },
      {},
      { label: t('从图层创建切片'), onClick: () => createSlicesFromNodes(nodes) },
      {},
      { label: t('隔离显示'), onClick: () => isolateNodes(nodes) },
      { label: t('显示全部图层'), hint: effectiveDisplay(COMMAND_MAP['layer.hide']), onClick: () => setHiddenIds(new Set()) }
    ]
  })()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const editable = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (editable) {
        if (e.key === 'Escape') t!.blur()
        return
      }
      // 方向键微调所选切片（MasterGo 范式：1px，Shift 为 10px）
      if (e.key.startsWith('Arrow') && selectedSliceIds.size > 0) {
        const step = e.shiftKey ? 10 : 1
        const d: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step]
        }
        const mv = d[e.key]
        if (mv) {
          e.preventDefault()
          setSlices((prev) =>
            prev.map((s) => (selectedSliceIds.has(s.id) ? { ...s, x: s.x + mv[0], y: s.y + mv[1] } : s))
          )
        }
        return
      }
      const cmd = matchCommand(e)
      if (!cmd) return
      e.preventDefault()
      commandRef.current(cmd.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedSliceIds, setSlices])

  // 原生菜单点击 → 与键盘同一个命令分发入口
  useEffect(() => {
    const off = window.api.onMenuExec((id) => commandRef.current(id))
    return off
  }, [])

  const exportSlices = useCallback(
    async (format: ExportFormat, scales0: number[], quality?: number) => {
      if (!doc) return
      if (decoding) {
        toast(t('图层还在解析中，请稍后导出'), 'warning')
        return
      }
      const targets = selectedSliceIds.size > 0 ? slices.filter((s) => selectedSliceIds.has(s.id)) : slices
      if (targets.length === 0) {
        toast(t('还没有切片，用切片工具在画布上拖拽创建'), 'warning')
        return
      }
      // 整篇合成只做一次，逐切片从大画布裁区域编码
      const composite = buildCompositeCanvas(doc, rnodes, hiddenIds)
      if (!composite) return
      const items: { name: string; run: () => Promise<Uint8Array | null> }[] = []
      let seq = 0
      for (const s of targets) {
        // 切片自带倍数时只出那一档，否则跟随面板多选
        const scales = s.scale ? [s.scale] : [...scales0].sort((a, b) => a - b)
        for (const scale of scales) {
          const fmt = s.format ?? format
          const base = (s.name?.trim() || `切片${s.no}`).replace(/[\\/:*?"<>|]/g, '_')
          items.push({
            name: applyTemplate(template, base, scale, fmt, ++seq),
            run: () =>
              exportCanvasBytes(composite, {
                scale,
                format: fmt,
                quality,
                srcRect: { x: s.x, y: s.y, w: s.w, h: s.h }
              })
          })
        }
      }
      return writeAll(items)
    },
    [doc, slices, selectedSliceIds, rnodes, hiddenIds, template, writeAll, decoding, toast, t]
  )

  const handlePickColor = useCallback(
    (hex: string) => {
      void navigator.clipboard.writeText(hex)
      toast(t('已取色 {hex} 并复制到剪贴板', { hex }))
    },
    [toast]
  )

  const exportTargetCount =
    tool === 'slice' ? (selectedSliceIds.size > 0 ? selectedSliceIds.size : slices.length) : visibleLayerCount

  const runBatchExport = () => {
    setBatchOpen(false)
    const quality = batchFmt === 'png' ? undefined : batchQuality
    const scales = [...batchScales]
    if (tool === 'slice') void exportSlices(batchFmt, scales, quality)
    else void exportAll(batchFmt, scales, quality)
  }

  const cloneSlices = (ids: Set<string>, dx: number, dy: number): DocSlice[] => {
    const dups: DocSlice[] = []
    for (const s of slices) {
      if (!ids.has(s.id)) continue
      const no = String(sliceSeq.current++).padStart(2, '0')
      dups.push({ ...s, id: `slice-${no}-${Date.now()}`, no, x: s.x + dx, y: s.y + dy })
    }
    if (dups.length) {
      setSlices((prev) => [...prev, ...dups])
      setSelectedSliceIds(new Set(dups.map((d) => d.id)))
    }
    return dups
  }

  // Alt+拖拽复制：先落一个偏移副本，画布随即拖动这个副本
  const handleDupSlice = (id: string) => {
    const src = slices.find((s) => s.id === id)
    if (!src) return null
    const [dup] = cloneSlices(new Set([id]), 16, 16)
    return dup ? { id: dup.id, rect: { x: dup.x, y: dup.y, w: dup.w, h: dup.h } } : null
  }

  // 统一命令入口：键盘、原生菜单、（后续）工具栏按钮共用，保证行为一致
  commandRef.current = (id: string) => {
    const api = canvasApiRef.current
    switch (id) {
      case 'tool.move':
        setTool('move')
        break
      case 'tool.slice':
        setTool('slice')
        break
      case 'tool.picker':
        setTool('picker')
        break
      case 'tool.hand':
        setTool('hand')
        break
      case 'view.zoomIn':
        if (api) api.applyZoom(api.getZoom() * 1.2)
        break
      case 'view.zoomOut':
        if (api) api.applyZoom(api.getZoom() / 1.2)
        break
      case 'view.zoom100':
        api?.applyZoom(1)
        break
      case 'view.fit':
        api?.fit()
        break
      case 'view.zoomSel': {
        if (!api) break
        let boxes: { x: number; y: number; w: number; h: number }[] = []
        if (selectedSliceIds.size > 0) {
          boxes = slices.filter((s) => selectedSliceIds.has(s.id))
        } else if (selectedIds.size > 0) {
          boxes = [...selectedIds]
            .map((lid) => findInTree(tree, lid))
            .filter((n): n is PsdLayer => !!n && n.width > 0 && n.height > 0)
            .map((n) => ({ x: n.left, y: n.top, w: n.width, h: n.height }))
        }
        if (!boxes.length) {
          api.fit()
          break
        }
        const x0 = Math.min(...boxes.map((b) => b.x))
        const y0 = Math.min(...boxes.map((b) => b.y))
        const x1 = Math.max(...boxes.map((b) => b.x + b.w))
        const y1 = Math.max(...boxes.map((b) => b.y + b.h))
        api.zoomTo({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
        break
      }
      case 'view.slices':
        setShowSlices((v) => !v)
        break
      case 'sel.all':
        if (tool === 'slice') {
          setSelectedSliceIds(new Set(slices.map((s) => s.id)))
        } else {
          const vis = flattenLayers(tree).filter((n) => n.type === 'layer' && !n.hidden && !hiddenIds.has(n.id))
          setSelectedIds(new Set(vis.map((n) => n.id)))
        }
        break
      case 'sel.clear':
        if (tool !== 'move') setTool('move')
        else {
          setSelectedSliceIds(new Set())
          clearLayerSel()
        }
        break
      case 'sel.delete':
        deleteSelectedSlices()
        break
      case 'edit.undo':
        undoSlices()
        break
      case 'edit.redo':
        redoSlices()
        break
      case 'slice.rename':
        if (selectedSlice) {
          setTool('slice')
          requestAnimationFrame(() => {
            sliceNameRef.current?.focus()
            sliceNameRef.current?.select()
          })
        }
        break
      case 'slice.dup':
        if (selectedSliceIds.size > 0) cloneSlices(selectedSliceIds, 16, 16)
        break
      case 'layer.hide':
        selectedIds.forEach((lid) => toggleHidden(lid))
        break
      case 'layer.collapse':
        layerTreeRef.current?.toggleCollapseAll()
        break
      case 'export.batch':
        runBatchExport()
        break
      case 'panel.toggle':
        if (!leftCollapsed && !rightCollapsed) {
          toggleLeft()
          toggleRight()
        } else {
          if (leftCollapsed) toggleLeft()
          if (rightCollapsed) toggleRight()
        }
        break
      case 'search.focus':
        if (leftCollapsed) toggleLeft()
        layerTreeRef.current?.focusSearch()
        break
      case 'help.toggle':
        window.dispatchEvent(new Event('qingqie:shortcuts'))
        break
    }
  }

  const loaderInner = (
    <>
      <div style={{ marginBottom: 16 }}>
        <AppLogo size={54} />
      </div>
      <div className="pl-bar">
        <i style={{ width: `${loadPct}%` }} />
      </div>
      <span className="pl-text">
        {t('加载中，马上就好…')} <b>{Math.round(loadPct)}%</b>
      </span>
    </>
  )

  if (!contentReady || !exitArmed) {
    return (
      <div
        className="main"
        style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}
      >
        <div className="psd-loading">{loaderInner}</div>
      </div>
    )
  }

  return (
    <div
      className={`main detail${entered ? ' entered' : ''}`}
      style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}
    >
      {!loaderGone && (
        <div
          className={`psd-loading${entered ? ' leaving' : ''}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setLoaderGone(true)
          }}
        >
          {loaderInner}
        </div>
      )}
      {perfEnabled && <PerfChip />}
      <aside ref={leftRef} className={`panel panel-left${leftCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-head">
          <span className="label">{t('图 层')}</span>
          <span className="count">{layerCount}</span>
        </div>
        <LayerTree
          ref={layerTreeRef}
          tree={tree}
          hiddenIds={hiddenIds}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={handleLayerSelect}
          onToggleHidden={toggleHidden}
          onContextMenu={handleLayerContext}
        />
        <span
          className="panel-resizer"
          onMouseDown={startDrag(leftRef, 1)}
        >
          <span className="rz-chev" onClick={toggleLeft}>{leftCollapsed ? '›' : '‹'}</span>
        </span>
      </aside>

      <div className="canvas-mid" style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
        <CanvasView
          doc={doc}
          tree={tree}
          rnodes={rnodes}
          canvasMap={canvasMapRef.current}
          hiddenIds={hiddenIds}
          preview={previewCanvas}
          selectedIds={selectedIds}
          onSelect={handleLayerSelect}
          onLayerContext={handleLayerContext}
          apiRef={canvasApiRef}
          onZoomChange={setZoomPct}
          tool={tool}
          slices={slices}
          selectedSliceIds={selectedSliceIds}
          showSlices={showSlices}
          onCreateSlice={handleCreateSlice}
          onSelectSlice={handleSelectSlice}
          onDupSlice={handleDupSlice}
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
                {t('共')} <b>{slices.length}</b> {t('个切片')}
                {selectedSliceIds.size > 0 ? t(' · 已选 {n} 个', { n: selectedSliceIds.size }) : ''}
              </span>
              {selectedSlice && (
                <span className="slice-editor">
                  <input
                    ref={sliceNameRef}
                    className="slice-name"
                    type="text"
                    placeholder={t('切片{no}', { no: selectedSlice.no })}
                    title={t('切片名，导出文件名用它')}
                    value={selectedSlice.name ?? ''}
                    maxLength={40}
                    onChange={(e) => updateSelectedSlice({ name: e.target.value })}
                  />
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
                  <select
                    value={selectedSlice.format ?? ''}
                    title={t('该切片的导出格式（默认跟随批量设置）')}
                    onChange={(e) =>
                      updateSelectedSlice({ format: (e.target.value || undefined) as ExportFormat | undefined })
                    }
                  >
                    <option value="">{t('格式·跟随')}</option>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPG</option>
                    <option value="webp">WebP</option>
                  </select>
                  <select
                    value={selectedSlice.scale ?? ''}
                    title={t('该切片的导出倍数（默认跟随批量设置）')}
                    onChange={(e) =>
                      updateSelectedSlice({ scale: e.target.value ? Number(e.target.value) : undefined })
                    }
                  >
                    <option value="">{t('倍数·跟随')}</option>
                    <option value="1">@1x</option>
                    <option value="2">@2x</option>
                    <option value="3">@3x</option>
                  </select>
                  <button className="batch-mini" onClick={deleteSelectedSlices}>{t('删除')}</button>
                </span>
              )}
              <button className="batch-mini" onClick={() => void handleTemplate()}>
                {t('命名模板')}
              </button>
              <button
                className={`batch-mini go${batchOpen ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setBatchOpen((v) => !v)
                }}
              >
                {t('批量导出')} ▾
              </button>
            </>
          ) : (
            <>
              <span className="batch-label">
                {t('共')} <b>{visibleLayerCount}</b> {t('个可见图层')}
              </span>
              <button className="batch-mini" onClick={() => void handleTemplate()}>
                {t('命名模板')}
              </button>
              <button
                className={`batch-mini go${batchOpen ? ' active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setBatchOpen((v) => !v)
                }}
              >
                {t('批量导出')} ▾
              </button>
            </>
          )}
        </div>

        <div className={`export-pop${batchOpen ? ' open' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="ep-group">
            <span className="ep-label">{t('格式')}</span>
            <div className="ep-opts">
              {(
                [
                  ['png', 'PNG'],
                  ['jpeg', 'JPG'],
                  ['webp', 'WebP']
                ] as [ExportFormat, string][]
              ).map(([f, l]) => (
                <button key={f} className={batchFmt === f ? 'on' : ''} onClick={() => setBatchFmt(f)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="ep-group">
            <span className="ep-label">{t('倍数')}</span>
            <div className="ep-opts">
              {[1, 2, 3].map((s) => (
                <button
                  key={s}
                  className={batchScales.has(s) ? 'on' : ''}
                  onClick={() =>
                    setBatchScales((prev) => {
                      const next = new Set(prev)
                      if (next.has(s)) next.delete(s)
                      else next.add(s)
                      if (next.size === 0) next.add(s)
                      return next
                    })
                  }
                >
                  @{s}x
                </button>
              ))}
            </div>
          </div>
          {batchFmt !== 'png' && (
            <div className="ep-group">
              <span className="ep-label">{t('质量')}</span>
              <Slider
                min={0.5}
                max={1}
                step={0.01}
                value={batchQuality}
                onChange={setBatchQuality}
              />
              <b className="ep-q">{Math.round(batchQuality * 100)}%</b>
            </div>
          )}
          <button className="btn btn-primary ep-go" onClick={runBatchExport}>
            {t('导出 {n} 个文件', { n: exportTargetCount * batchScales.size })}
          </button>
        </div>

        <div className="zoombar">
          <span
            className={`zb${tool === 'move' ? ' active' : ''}`}
            title={t('移动 / 选择图层 (V)')}
            onClick={() => setTool('move')}
          >
            <MoveIcon />
          </span>
          <span
            className={`zb${tool === 'slice' ? ' active' : ''}`}
            title={t('切片工具 (S) — 拖拽画切片')}
            onClick={() => setTool('slice')}
          >
            <SliceIcon />
          </span>
          <span
            className={`zb${tool === 'picker' ? ' active' : ''}`}
            title={t('取色器 (I) — 点击画布取色并复制')}
            onClick={() => setTool('picker')}
          >
            <PickerIcon />
          </span>
          <span
            className={`zb${tool === 'hand' ? ' active' : ''}`}
            title={t('抓手 (H) — 拖拽平移')}
            onClick={() => setTool('hand')}
          >
            <HandIcon />
          </span>
          <span
            className={`zb${showSlices ? ' active' : ''}`}
            title={t('显示 / 隐藏切片')}
            onClick={() => setShowSlices((v) => !v)}
          >
            <EyeIcon />
          </span>
          <span className="sep" />
          <span
            className="zb"
            title={t('缩小')}
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
            title={t('放大')}
            onClick={() => canvasApiRef.current?.applyZoom((zoomPct / 100) * 1.2)}
          >
            <ZoomInIcon />
          </span>
          <span className="sep" />
          <span className="zb" title={t('适应画布 (Shift+1)')} onClick={() => canvasApiRef.current?.fit()}>
            <FitIcon />
          </span>
          <span className="zb" title={t('缩放至 100% (Ctrl+0)')} onClick={() => canvasApiRef.current?.applyZoom(1)}>
            <span style={{ fontFamily: 'Consolas, monospace', fontSize: 9 }}>1:1</span>
          </span>
          <span className="sep" />
          <span
            className="zb"
            title={t('快捷键一览 (?)')}
            onClick={() => window.dispatchEvent(new Event('qingqie:shortcuts'))}
          >
            <span style={{ fontFamily: 'Consolas, monospace', fontSize: 12, fontWeight: 600 }}>?</span>
          </span>
        </div>

        {progress && (
          <div className="export-mask">
            <div className="export-progress">
              <p>
                {t('正在导出')} <b>{progress.done}</b> / {progress.total}
              </p>
              <div className="ep-bar">
                <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
              <div className="row2">
                <button className="btn btn-ghost" onClick={() => (cancelRef.current = true)}>
                  {t('取消')}
                </button>
              </div>
            </div>
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
