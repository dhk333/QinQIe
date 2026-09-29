import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocSlice, ExportFormat, LayerEdit, Project, ProjectPsd } from '@/types'
import {
  parsePsd,
  parsePsdFallback,
  fetchPsdFile,
  materializePixels,
  flattenLayers,
  buildCompositeCanvas,
  renderLayerCanvas,
  adoptLayerIds,
  type LayerBitmap
} from '@/lib/psd'
import { decodeLayersInWorker, WorkerDecodeError, WorkerCancelledError } from '@/lib/psdWorker'
import { readPsdCache, writePsdCache } from '@/lib/psdCache'
import { applyLayerEdits, editBaseName, patchEdit, type LayerEdits } from '@/lib/layerEdits'
import { exportCanvasBytes } from '@/lib/export'
import { loadExportPrefs, saveExportPrefs } from '@/lib/exportPrefs'
import { getUiPrefs } from '@/lib/uiPrefs'
import { loadView, saveLastRoute, saveView } from '@/lib/session'
import { matchCommand, effectiveDisplay, COMMAND_MAP } from '@shared/keymap'
import { useDialog, useToast } from '@/lib/ui'
import { useT } from '@/i18n/core'
import LayerTree, { type LayerTreeApi } from '@/components/LayerTree'
import CanvasView, {
  type CanvasTool,
  type CanvasViewApi,
  type CanvasViewport
} from '@/components/CanvasView'
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

type HistEntry =
  | { type: 'slice'; before: DocSlice[]; after: DocSlice[] }
  | { type: 'edit'; before: LayerEdits; after: LayerEdits }

/** 一次全量解码请求：isDead 绑定发起它的那轮加载的生命周期，
 *  StrictMode 双挂载或换文件后，先一轮的迟到结果整包丢弃，绝不写进新一轮的状态 */
interface DecodeRequest {
  buffer: Uint8Array
  name: string
  tree: PsdLayer[]
  path: string
  isDead: () => boolean
}

function findInTree(nodes: PsdLayer[], id: number): PsdLayer | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children ? findInTree(n.children, id) : null
    if (hit) return hit
  }
  return null
}

export default function DetailPage({ project, psd, onUpdatePsd, onBack }: Props) {
  const t = useT()
  const [doc, setDoc] = useState<PsdDoc | null>(null)
  /** 解析器直出的原始图层树与合成器节点树：编辑投影每次都从这两份算，不写回 */
  const [rawTree, setTree] = useState<PsdLayer[]>([])
  const [decoding, setDecoding] = useState(false)
  /** 解码完成前画布用的 PSD 内嵌合成图占位 */
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null)
  const [rawRnodes, setRnodes] = useState<RNode[]>([])
  const canvasMapRef = useRef<Map<number, LayerBitmap>>(new Map())
  /** 解码任务句柄：换文件/离开页面时终止 Worker，不再为已抛弃的文档烧解码 */
  const decodeCancelRef = useRef<(() => void) | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const anchorRef = useRef<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; ids: number[] } | null>(null)
  const [loading, setLoading] = useState(true)
  /** 加载进度：loadTarget 是里程碑下限，loadPct 逐帧逼近它。
   *  内容就绪（contentReady）前按里程碑爬行，就绪后 200%/s 冲刺收尾——
   *  真实工作多快，加载屏就多快结束，不再人为垫底数秒。 */
  const [loadTarget, setLoadTarget] = useState(0)
  const [loadPct, setLoadPct] = useState(0)
  const loadPctRef = useRef(0)
  useEffect(() => {
    loadPctRef.current = loadPct
  }, [loadPct])
  // 有内嵌合成图预览时不再等解码：先揭示界面，解码转入后台
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
        const gap = loadTarget - p
        if (gap > 0.05) {
          const speed = contentReady ? 200 : gap > 30 ? 26 : gap > 10 ? 14 : 8
          return Math.min(loadTarget, p + speed * dt)
        }
        // 终点档只许涨不许跌：旧实现在 (99.95,100) 区间会把 p 重置回 99，
        // 造成每帧 99→100→99 的无限重渲染（CPU 满载死循环）
        if (loadTarget >= 100) return Math.min(100, p)
        return p >= 99 ? p : Math.min(99, p + 2 * dt)
      })
      // 爬满后停帧，不再空转；新一轮加载把 loadTarget 打回低位时由依赖变化重启
      if (loadTarget >= 100 && loadPctRef.current >= 100) return
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [loadTarget, contentReady])
  /** 加载完成后加载层不立即卸载：先播完渐出动画再由 onAnimationEnd 移除 */
  const [loaderGone, setLoaderGone] = useState(false)
  /** 快开免加载屏：contentReady 在 250ms 内到来就根本不显示加载屏，
   *  直接进内容与入场动画；超过才亮出进度条，之后照常冲刺收尾 */
  const [loaderShown, setLoaderShown] = useState(false)
  useEffect(() => {
    if (contentReady) return
    const t = setTimeout(() => setLoaderShown(true), 250)
    return () => clearTimeout(t)
  }, [contentReady])
  /** 出屏许可：进度条冲刺爬满后才允许加载层渐出，避免半途消失 */
  const [exitArmed, setExitArmed] = useState(false)
  useEffect(() => {
    if (!contentReady) {
      setLoaderGone(false)
      setExitArmed(false)
      return
    }
    // 加载屏没登场过（快开）：进度条无需收尾，直接放行
    if (!loaderShown || loadPct >= 99.6) {
      setLoaderGone(!loaderShown)
      setExitArmed(true)
      return
    }
    // 兜底：极端情况下（如 rAF 因窗口不可见停摆）最多再等 2s 也必须放行
    const t = setTimeout(() => setExitArmed(true), 2000)
    return () => clearTimeout(t)
  }, [contentReady, loaderShown, loadPct])
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
  // 重开同一份 PSD 时回到上次的缩放与位置；关闭开关则一律适配整图
  const initialView = useMemo(
    () => (getUiPrefs().restoreViewport ? loadView(psd.path) : null),
    [psd.path]
  )
  const rawViewRef = useRef(false)
  const handleViewChange = useCallback(
    (v: CanvasViewport) => {
      // 首个通知是适配前的默认视口，丢掉再记录真实视口
      if (!rawViewRef.current) {
        rawViewRef.current = true
        return
      }
      saveView(psd.path, v)
    },
    [psd.path]
  )
  useEffect(() => {
    saveLastRoute(project.id, psd.id)
  }, [project.id, psd.id])
  const [pctMenuOpen, setPctMenuOpen] = useState(false)
  const [template, setTemplate] = useState(() => loadExportPrefs().template)
  const [tool, setTool] = useState<CanvasTool>('move')
  const [slices, setSlicesRaw] = useState<DocSlice[]>(() => psd.slices ?? [])
  const [selectedSliceIds, setSelectedSliceIds] = useState<Set<string>>(new Set())
  const [showSlices, setShowSlices] = useState(true)
  const sliceSeq = useRef(1)
  // 统一撤销栈：切片与图层编辑按改动时间线共用一组 past/future，直接存改动前后快照
  const histRef = useRef<{
    past: HistEntry[]
    future: HistEntry[]
  }>({ past: [], future: [] })
  const editBaseRef = useRef<DocSlice[] | null>(null)
  const editsBaseRef = useRef<LayerEdits | null>(null)
  const lastSavedRef = useRef<DocSlice[]>(slices)
  // 批量导出参数（图层与切片共用一套弹层）
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchFmt, setBatchFmt] = useState<ExportFormat>(() => loadExportPrefs().format)
  const [batchScales, setBatchScales] = useState<Set<number>>(() => new Set(loadExportPrefs().scales))
  const [batchQuality, setBatchQuality] = useState(() => loadExportPrefs().quality)
  useEffect(() => {
    if (batchScales.size)
      saveExportPrefs({ ...loadExportPrefs(), format: batchFmt, scales: [...batchScales].sort((a, b) => a - b), quality: batchQuality })
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
        past.push({ type: 'slice', before: editBaseRef.current, after: slices })
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

  // 撤销/重做沿统一时间线走：弹出一条记录，把对应通道恢复到快照值，两个 base 引用清空防误提交
  const applyHist = useCallback((e: HistEntry, side: 'before' | 'after') => {
    if (e.type === 'slice') setSlicesRaw(e[side])
    else setLayerEditsRaw(e[side])
  }, [])
  const undoLast = useCallback(() => {
    const entry = histRef.current.past.pop()
    if (!entry) return
    histRef.current.future.push(entry)
    editBaseRef.current = null
    editsBaseRef.current = null
    applyHist(entry, 'before')
  }, [applyHist])
  const redoLast = useCallback(() => {
    const entry = histRef.current.future.pop()
    if (!entry) return
    histRef.current.past.push(entry)
    editBaseRef.current = null
    editsBaseRef.current = null
    applyHist(entry, 'after')
  }, [applyHist])

  // 图层编辑量：只存 diff，按 layer.key 索引随项目 JSON 持久化，PSD 源文件永不回写
  const [layerEdits, setLayerEditsRaw] = useState<LayerEdits>(() => psd.layerEdits ?? {})
  const editSavedRef = useRef(layerEdits)
  /** 面板写回的唯一入口：改哪一项就只传那一项，显式 undefined 表示恢复 PSD 原值 */
  const patchLayerEdit = useCallback((layer: PsdLayer, patch: Partial<LayerEdit>) => {
    setLayerEditsRaw((prev) => {
      if (editsBaseRef.current === null) editsBaseRef.current = prev
      return patchEdit(prev, layer.key, editBaseName(layer), patch)
    })
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      if (editsBaseRef.current !== null && editsBaseRef.current !== layerEdits) {
        const { past } = histRef.current
        past.push({ type: 'edit', before: editsBaseRef.current, after: layerEdits })
        if (past.length > 80) past.shift()
        histRef.current.future = []
        editsBaseRef.current = null
      }
      if (editSavedRef.current === layerEdits) return
      editSavedRef.current = layerEdits
      onUpdatePsd((p) => {
        p.layerEdits = Object.keys(layerEdits).length ? layerEdits : undefined
      })
    }, 500)
    return () => clearTimeout(t)
  }, [layerEdits, onUpdatePsd])
  // 清空是整篇级别的破坏性操作：一次确认，不做逐项撤销
  const clearLayerEdits = useCallback(() => {
    if (!Object.keys(layerEdits).length) return
    void dialog({
      type: 'confirm',
      title: t('清空本文档的图层编辑？'),
      desc: t('所有图层回到 PSD 原值，可用 Ctrl+Z 撤销。'),
      okText: t('清空'),
      danger: true
    }).then((ok) => {
      if (ok) {
        if (editsBaseRef.current === null) editsBaseRef.current = layerEdits
        setLayerEditsRaw({})
      }
    })
  }, [dialog, layerEdits, t])
  // 投影发生在原始树之后、所有消费者之前：画布、图层树、面板、四条导出路径拿到的是同一份
  const { tree, rnodes } = useMemo(
    () => applyLayerEdits(rawTree, rawRnodes, layerEdits),
    [rawTree, rawRnodes, layerEdits]
  )

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

  // 全量解码交给 Worker：主线程全程不阻塞。Worker 不占主线程，fetch/解析一结束
  // 就启动，与加载动画并行跑；req.isDead 绑定发起本轮加载的生命周期，
  // StrictMode 双挂载 / 换文件后，先一轮的迟到结果一律丢弃
  const startDecode = useCallback((req: DecodeRequest) => {
    const { result, cancel } = decodeLayersInWorker(req.buffer, req.tree)
    decodeCancelRef.current = cancel
    const drop = () => {
      if (decodeCancelRef.current === cancel) decodeCancelRef.current = null
    }
    result
      .then(async (decoded) => {
        if (req.isDead()) return drop()
        drop()
        // Worker 传回的是原始像素字节（惰性数据，不会像 ImageBitmap 那样衰减）：
        // 逐条固化成 DOM canvas，按像素量分帧，解码完成瞬间不再冻结主线程
        const canvasMap = await materializePixels(
          decoded.rnodes,
          decoded.canvasEntries,
          decoded.maskEntries,
          req.isDead
        )
        if (!canvasMap || req.isDead()) return
        canvasMapRef.current = canvasMap
        setRnodes(decoded.rnodes)
        setPreviewCanvas(null)
        setLoadTarget(100)
        setDecoding(false)
      })
      .catch(async (e: unknown) => {
        // 主动取消或本轮加载已作废：静默收场，不走备用解析器
        if (req.isDead() || e instanceof WorkerCancelledError) return drop()
        drop()
        // ag-psd 能读结构但位图/蒙版数据解不动（如 Invalid mask size），
        // 整文档交给备用解析器重建树+位图，节点 id 变了需重置选中态。
        // buffer 已转移进 Worker：解码失败会随错误回传；Worker 整体崩溃拿不回，按原路径重读
        try {
          const returned = e instanceof WorkerDecodeError ? e.returnedBuffer : undefined
          const buf = returned ? new Uint8Array(returned) : (await fetchPsdFile(req.path)).buffer
          if (req.isDead()) return
          const fb = await parsePsdFallback(buf, req.name)
          if (req.isDead()) return
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
          if (req.isDead()) return
          toast(t('图层位图解码失败'), 'error')
        }
        setLoadTarget(100)
        setDecoding(false)
      })
  }, [toast, t])

  // 加载 PSD：结构缓存命中则跳过主线程解析（预览用缓存合成图）；未命中走两阶段——
  // 先只做结构解析（~50ms）让图层树/面板立即可用，位图解码随后立刻交给 Worker
  useEffect(() => {
    // 存活标志用局部变量而不是 ref：StrictMode 双挂载时第一轮的链路必须随 cleanup
    // 一起作废，不能被第二轮挂载「复活」（否则同一文件会被两条链并行解析两遍）
    let alive = true
    setLoading(true)
    setLoadPct(0)
    setLoaderShown(false)
    setLoadTarget(5)
    const resetSelection = () => {
      setHiddenIds(new Set())
      setSelectedId(null)
      setSelectedIds(new Set())
    }
    // 恢复上次持久化的切片与图层编辑；引用对齐避免挂载即触发一次无谓保存
    const restoreSessionState = () => {
      const restored = psd.slices ?? []
      setSlicesRaw(restored)
      setSelectedSliceIds(new Set())
      editBaseRef.current = null
      editsBaseRef.current = null
      histRef.current = { past: [], future: [] }
      sliceSeq.current = restored.reduce((m, s) => Math.max(m, Number(s.no) || 0), 0) + 1
      const restoredEdits = psd.layerEdits ?? {}
      editSavedRef.current = restoredEdits
      setLayerEditsRaw(restoredEdits)
    }
    ;(async () => {
      try {
        // ① 结构缓存：主进程 stat 换 key + 读小 JSON，命中则主线程零解析
        const cached = await readPsdCache(psd.path)
        if (!alive) return
        if (cached) {
          adoptLayerIds(cached.entry.tree)
          setDoc(cached.entry.doc)
          setTree(cached.entry.tree)
          setRnodes(cached.entry.rnodes)
          setPreviewCanvas(cached.preview)
          resetSelection()
          restoreSessionState()
          setLoading(false)
          setLoadTarget(88)
          setDecoding(true)
          const { name, buffer } = await fetchPsdFile(psd.path)
          if (!alive) return
          startDecode({ buffer, name, tree: cached.entry.tree, path: psd.path, isDead: () => !alive })
          return
        }
        // ② 缓存未命中：流式读文件 + 结构解析（内嵌合成图先顶预览）
        const { name, buffer } = await fetchPsdFile(psd.path)
        if (!alive) return
        setLoadTarget(30)
        let parsed
        try {
          parsed = parsePsd(buffer, name, true)
        } catch {
          // 主解析器失败时使用 @webtoon/psd 兜底（支持 ZIP 压缩等），其位图已逐层渲染
          parsed = await parsePsdFallback(buffer, name)
          toast(t('主解析器不支持该文件，已使用备用解析器'), 'warning')
        }
        if (!alive) return
        canvasMapRef.current = parsed.canvasMap
        setRnodes(parsed.rnodes)
        setDoc(parsed.doc)
        setTree(parsed.tree)
        resetSelection()
        // 两阶段：逐层位图还没解出来时，先拿内嵌合成图占位显示
        setPreviewCanvas(parsed.canvasMap.size === 0 ? (parsed.composite ?? null) : null)
        restoreSessionState()
        setLoadTarget(60)
        setLoading(false)
        // 解析成功即登记缓存（后台写，避开打开瞬间）；备用解析器没有内嵌合成图，不写
        if (parsed.composite) {
          writePsdCache(psd.path, parsed.doc, parsed.tree, parsed.rnodes, parsed.composite)
        }
        // 结构阶段跳过了全部位图（canvasMap 为空）时立刻把全量解码交给 Worker
        if (parsed.canvasMap.size === 0) {
          setDecoding(true)
          setLoadTarget(88)
          startDecode({ buffer, name, tree: parsed.tree, path: psd.path, isDead: () => !alive })
        }
      } catch {
        if (!alive) return
        setDecoding(false)
        toast(t('加载 PSD 失败'), 'error')
        setLoading(false)
      }
    })()
    return () => {
      alive = false
      decodeCancelRef.current?.()
      decodeCancelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psd.path])

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
    saveExportPrefs({ ...loadExportPrefs(), template: input })
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
        undoLast()
        break
      case 'edit.redo':
        redoLast()
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
    // 快开：加载屏没登场过就不画，避免进度条闪一下的毛刺
    if (!loaderShown) {
      return <div style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }} />
    }
    return (
      <div
        style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0 }}
      >
        <div className="psd-loading">{loaderInner}</div>
      </div>
    )
  }

  return (
    <div
      id="page-detail"
      className={`detail${entered ? ' entered' : ''}${loaderShown ? '' : ' instant'}`}
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
      <aside ref={leftRef} className={`panel panel-left${leftCollapsed ? ' collapsed' : ''}`}>
        <div className="panel-head">
          <span className="text-[12px] font-medium tracking-[2px] text-txt-2">{t('图 层')}</span>
          <span className="text-[11px] text-txt-3">{layerCount}</span>
        </div>
        <LayerTree
          ref={layerTreeRef}
          tree={tree}
          hiddenIds={hiddenIds}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={handleLayerSelect}
          onToggleHidden={toggleHidden}
          onRestoreVisibility={() => setHiddenIds(new Set())}
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
          initialView={initialView}
          onViewChange={handleViewChange}
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

        <div className="batch-bar" id="batch-bar">
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
                {decoding ? ` · ${t('图层解析中…')}` : ''}
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

        <div className="zoombar" id="zoom-bar">
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
          editCount={Object.keys(layerEdits).length}
          onPatchEdit={patchLayerEdit}
          onClearEdits={clearLayerEdits}
          onExport={handleExport}
        />
      </aside>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}



