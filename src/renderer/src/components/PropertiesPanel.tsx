import { useEffect, useMemo, useRef, useState } from 'react'
import type { BorderEdit, ExportFormat, LayerEdit, PsdDoc, PsdLayer, ShadowEdit } from '@/types'
import { BLEND_MODES, blendLabel, layerCssSnippet, layerEffectNames, sampleColor } from '@/lib/export'
import { loadExportPrefs } from '@/lib/exportPrefs'
import type { CssUnit } from '@/lib/cssUnits'
import { setUiPrefs, useUiPrefs } from '@/lib/uiPrefs'
import { indexRNodes, measureLayerContent, renderLayerCanvas, type LayerBitmap } from '@/lib/psd'
import { getLang, useT } from '@/i18n/core'
import type { RNode } from '@/lib/compositor'
import { CheckIcon, ChevronRightIcon, CopyIcon, LinkIcon, UndoIcon } from './icons'
import Slider from './Slider'

interface Props {
  layer: PsdLayer | null
  doc: PsdDoc | null
  rnodes: RNode[]
  canvasMap: Map<number, LayerBitmap>
  hiddenIds: Set<number>
  /** 本文档已改过的图层数：>0 时才给「清空本文档编辑」 */
  editCount: number
  onPatchEdit: (layer: PsdLayer, patch: Partial<LayerEdit>) => void
  onClearEdits: () => void
  onExport: (format: ExportFormat, scale: number, quality?: number) => void
}

function Section({
  title,
  action,
  children
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border px-4 pb-4 pt-3.5">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-[12px] font-semibold tracking-normal text-txt">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** 可折叠分组：标题行即开关，收起时只保留标题与当前设置摘要 */
function CollapsibleSection({
  id,
  title,
  open,
  onToggle,
  summary,
  children
}: {
  id: string
  title: string
  open: boolean
  onToggle: () => void
  summary: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="border-b border-border px-4">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 py-3.5 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={`h-3 w-3 shrink-0 text-txt-3 transition-transform duration-200 ease-[var(--ease)] ${open ? 'rotate-90' : ''}`}
        />
        <span className="text-[12px] font-semibold text-txt">{title}</span>
        <span
          className={`ml-auto font-mono text-[11px] text-txt-3 transition-opacity duration-200 ${open ? 'opacity-0' : ''}`}
        >
          {summary}
        </span>
      </button>
      <Collapse open={open}>
        <div className="pb-4">{children}</div>
      </Collapse>
    </section>
  )
}

/** 高度可中断的展开收起：0fr↔1fr 过渡，不逐帧测量内容 */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-[var(--ease)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
    >
      {/* 收起动画结束后再隐藏：避免不可见内容仍可聚焦与点击 */}
      <div
        className={`min-h-0 overflow-hidden transition-[visibility] duration-0 ${open ? 'visible delay-0' : 'invisible delay-200'}`}
      >
        {children}
      </div>
    </div>
  )
}

function optCls(on: boolean): string {
  return `flex-1 cursor-pointer rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
    on
      ? 'border-accent bg-accent-dim text-txt'
      : 'border-border bg-panel-2 text-txt-2 hover:border-border-light'
  }`
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11.5px] text-txt-3">{label}</span>
      <span className="pl-3 text-right text-[12px] text-txt">{value}</span>
    </div>
  )
}

const numCls =
  'w-full min-w-0 rounded-md border border-border bg-panel-2 py-1 pl-2 pr-1.5 font-mono text-[11.5px] text-txt outline-none transition-colors [appearance:textfield] hover:border-border-light focus:border-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

/** 描边三档位置的展示文案（中文原文作 i18n key） */
const POSITION_LABEL: Record<BorderEdit['position'], string> = {
  inside: '内侧',
  center: '居中',
  outside: '外侧'
}

/** 把编辑过的字段标成强调色，一眼看出哪些值不是 PSD 原值 */
function FieldLabel({ text, dirty }: { text: string; dirty: boolean }) {
  return (
    <span className={`shrink-0 text-[11.5px] ${dirty ? 'text-accent' : 'text-txt-3'}`}>{text}</span>
  )
}

/** 「回到 PSD 原值」：只在该项被改过时出现；定位交给调用方，这里只管点击与外观 */
function ResetBtn({ onClick, title }: { onClick: () => void; title?: string }) {
  const t = useT()
  return (
    <button
      type="button"
      title={title || t('恢复 PSD 原值')}
      aria-label={t('恢复 PSD 原值')}
      onClick={onClick}
      className="shrink-0 rounded p-0.5 text-txt-3 transition-colors hover:bg-panel-2 hover:text-txt"
    >
      <UndoIcon className="h-3.5 w-3.5" />
    </button>
  )
}

/**
 * 数字字段：本地草稿允许「空 / 负号」这类输入中间态，解析成功才写回，
 * 失焦后无条件回读已生效值——否则半截输入会永久留在框里骗人。
 */
function NumField({
  label,
  value,
  dirty,
  min = 0,
  allowNegative,
  disabled,
  title,
  onCommit,
  onReset
}: {
  label: string
  value: number
  dirty?: boolean
  min?: number
  allowNegative?: boolean
  disabled?: boolean
  title?: string
  onCommit: (v: number) => void
  onReset?: () => void
}) {
  const round = (n: number) => Math.round(n * 100) / 100
  const [text, setText] = useState(() => String(round(value)))
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setText(String(round(value)))
  }, [value])
  const lo = allowNegative ? -Infinity : min
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5" title={title}>
      <FieldLabel text={label} dirty={!!dirty} />
      <span className="relative flex min-w-0 flex-1 items-center">
        <input
          type="number"
          className={numCls}
          style={dirty && onReset ? { paddingRight: 20 } : undefined}
          value={text}
          disabled={disabled}
          onFocus={() => {
            typing.current = true
          }}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (!e.target.value.trim() || !Number.isFinite(n)) return
            onCommit(Math.max(lo, Math.min(100000, Math.round(n))))
          }}
          onBlur={() => {
            typing.current = false
            setText(String(round(value)))
          }}
        />
        {dirty && onReset && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2">
            <ResetBtn
              title={title}
              onClick={() => {
                setText(String(round(value)))
                onReset()
              }}
            />
          </span>
        )}
      </span>
    </label>
  )
}

/** 文本字段：改名允许中间态（含空格），失焦才落定，空名回退原名 */
function TextField({
  label,
  value,
  fallback,
  maxLength,
  onCommit
}: {
  label: string
  value: string
  fallback: string
  maxLength: number
  onCommit: (v: string) => void
}) {
  const [text, setText] = useState(value)
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setText(value)
  }, [value])
  return (
    <input
      type="text"
      aria-label={label}
      className="w-full min-w-0 truncate rounded-md border border-border bg-panel-2 px-2 py-1 text-[13px] font-medium text-txt outline-none transition-colors hover:border-border-light focus:border-accent"
      value={text}
      maxLength={maxLength}
      onFocus={() => {
        typing.current = true
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        typing.current = false
        const v = text.trim()
        setText(v || fallback)
        if (v && v !== value) onCommit(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setText(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** 百分比字段：滑杆给手感、数字给精度，两者同一个值 */
function PctField({
  label,
  value,
  dirty,
  onCommit,
  onReset
}: {
  label: string
  value: number
  dirty: boolean
  onCommit: (v: number) => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel text={label} dirty={dirty} />
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(v) => onCommit(Math.round(v * 100) / 100)}
      />
      <b className="w-10 shrink-0 text-right font-mono text-[11px] text-txt-2">
        {Math.round(value * 100)}%
      </b>
      {dirty && <ResetBtn onClick={onReset} />}
    </div>
  )
}

/** 颜色字段：原生取色器 + 十六进制文本，两个入口写同一个值 */
function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-6 w-7 shrink-0 cursor-pointer rounded-md border border-border bg-panel-2 p-0.5"
      />
      <input
        type="text"
        value={value}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
          if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase())
        }}
        className="w-full min-w-0 rounded-md border border-border bg-panel-2 px-2 py-1 font-mono text-[11.5px] uppercase text-txt outline-none transition-colors hover:border-border-light focus:border-accent"
      />
    </span>
  )
}

const CSS_TOKEN_RE =
  /(\/\*.*?\*\/)|('[^']*'|"[^"]*")|(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b)|([;:])/gi

function valueTokens(raw: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of raw.matchAll(CSS_TOKEN_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(<span key={k++}>{raw.slice(last, idx)}</span>)
    if (m[1]) out.push(<span key={k++} className="tc">{m[1]}</span>)
    else if (m[2]) out.push(<span key={k++} className="ts">{m[2]}</span>)
    else if (m[3])
      out.push(
        <span key={k++} className="tv">
          <i className="sw" style={{ background: m[3] }} />
          {m[3]}
        </span>
      )
    else out.push(<span key={k++} className="pu">{m[4]}</span>)
    last = idx + m[0].length
  }
  if (last < raw.length) out.push(<span key={k++}>{raw.slice(last)}</span>)
  return out
}

function CssCode({ css }: { css: string }) {
  return (
    <div className="css-hl">
      {css.split('\n').map((ln, i) => {
        const m = /^([a-z-]+)(:)([\s\S]*)$/i.exec(ln)
        return (
          <div className="cl" key={i}>
            <span className="ln">{i + 1}</span>
            <span className="ct">
              {m ? (
                <>
                  <span className="pr">{m[1]}</span>
                  <span className="pu">{m[2]}</span>
                  <span className="tv">{valueTokens(m[3])}</span>
                </>
              ) : (
                <span className="tv">{valueTokens(ln)}</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function PropertiesPanel({
  layer,
  doc,
  rnodes,
  canvasMap,
  hiddenIds,
  editCount,
  onPatchEdit,
  onClearEdits,
  onExport
}: Props) {
  const t = useT()
  const [format, setFormat] = useState<ExportFormat>(() => loadExportPrefs().format)
  const [scale, setScale] = useState(() => loadExportPrefs().scales[0])
  const [quality, setQuality] = useState(() => loadExportPrefs().quality)
  const [copied, setCopied] = useState<'css' | 'color' | 'text' | null>(null)
  const uiPrefs = useUiPrefs()
  const cssUnits = uiPrefs.cssUnits
  const [exportOpen, setExportOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSeen, setPreviewSeen] = useState(false)
  const [borderOpen, setBorderOpen] = useState(false)
  const [fxOpen, setFxOpen] = useState(false)
  /** 宽高比锁定：改一边自动带上另一边 */
  const [lockRatio, setLockRatio] = useState(false)

  const rnodeMap = useMemo(() => indexRNodes(rnodes), [rnodes])
  const rnode = layer ? rnodeMap.get(layer.id) : undefined
  const color = useMemo(
    () => {
      const c = layer ? canvasMap.get(layer.id) : undefined
      return c ? sampleColor(c) : null
    },
    [layer, canvasMap]
  )
  // 面板显示/编辑与 CSS 片段都以「alpha 可见内容」为准：位图边界含透明留白，
  // 直接展示会比用户眼中的图形大几个像素。度量按位图对象 WeakMap 缓存，重复调用不重扫。
  const content = useMemo(
    () => {
      const c = layer && layer.type !== 'group' ? canvasMap.get(layer.id) : undefined
      return c ? measureLayerContent(c) : null
    },
    [layer, canvasMap]
  )
  const css = useMemo(
    () => (layer ? layerCssSnippet(layer, color, rnode, cssUnits, doc?.width, content) : ''),
    // getLang(): CSS 注释内嵌展示标签，语言切换后需重新生成
    [layer, color, rnode, cssUnits, doc?.width, content, getLang()]
  )
  const setCssUnit = (unit: CssUnit) => setUiPrefs({ cssUnits: { ...cssUnits, unit } })
  const previewUrl = useMemo(() => {
    // 合成整层位图代价高：用户从未展开过预览就完全不跑
    if (!previewSeen || !layer || !doc) return null
    try {
      const c = renderLayerCanvas(layer, rnodes, hiddenIds)
      if (!c || !c.width || !c.height) return null
      return c.toDataURL('image/png')
    } catch {
      return null
    }
  }, [previewSeen, layer, doc, rnodes, hiddenIds])

  if (!layer) {
    return (
      <aside id="properties-panel" className="flex w-full min-h-0 flex-1 flex-col bg-panel">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4 text-[12.5px] font-semibold text-txt">
          {t('属性')}
        </div>
        <p className="px-4 py-6 text-center text-[12px] text-txt-3">
          {t('在画布或图层面板中选择图层')}
        </p>
      </aside>
    )
  }

  const copy = async (text: string, kind: 'css' | 'color' | 'text') => {
    await navigator.clipboard.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1200)
  }

  const typeLabel =
    layer.type === 'group' ? t('图层组') : layer.isText ? t('文本图层') : t('像素图层')

  // 生效中的编辑量由投影写在 layer.edit 上：面板据此标出哪几项已偏离 PSD 原值
  const edit = layer.edit
  const isGroup = layer.type === 'group'
  const patch = (p: Partial<LayerEdit>) => onPatchEdit(layer, p)
  /** 位置按「相对 PSD 原位的偏移」存，写回只做「新值 − 当前显示值」，组位移与层位移才能各自累加 */
  const borderDefaults: BorderEdit = {
    size: 1,
    color: '#000000',
    opacity: 1,
    position: 'inside'
  }
  const shadowDefaults: ShadowEdit = {
    color: '#000000',
    opacity: 0.5,
    angle: 90,
    distance: 8,
    size: 8,
    choke: 0
  }
  const border = { ...borderDefaults, ...(edit?.border ?? borderDefaults) }
  const shadow = { ...shadowDefaults, ...(edit?.shadow ?? shadowDefaults) }
  // 宽度归零即撤销这圈边框：留着一条 size=0 的编辑只会让「已改过」的标记说谎
  const setBorder = (p: Partial<BorderEdit>) => {
    const next = { ...border, ...p }
    patch({ border: next.size <= 0 ? undefined : next })
  }
  const setShadow = (p: Partial<ShadowEdit>) => patch({ shadow: { ...shadow, ...p } })
  // 编辑宽度 = 位图边界重采样，所以输入的内容目标值要按 内容/位图 比例换算回边界尺寸；平移不改变留白，X/Y 换算精确。
  const sx = content && content.bw > 0 ? layer.width / content.bw : 1
  const sy = content && content.bh > 0 ? layer.height / content.bh : 1
  const shownLeft = Math.round(layer.left + (content ? content.padL * sx : 0))
  const shownTop = Math.round(layer.top + (content ? content.padT * sy : 0))
  const shownW = Math.max(1, Math.round(content ? content.cw * sx : layer.width))
  const shownH = Math.max(1, Math.round(content ? content.ch * sy : layer.height))
  const toBitmapW = (v: number) =>
    Math.max(1, content && content.cw > 0 ? Math.round((v * content.bw) / content.cw) : v)
  const toBitmapH = (v: number) =>
    Math.max(1, content && content.ch > 0 ? Math.round((v * content.bh) / content.ch) : v)
  const setPos = (axis: 'dx' | 'dy', v: number) => {
    const shown = axis === 'dx' ? shownLeft : shownTop
    const base = (axis === 'dx' ? edit?.dx : edit?.dy) ?? 0
    patch({ [axis]: base + (v - shown) } as Partial<LayerEdit>)
  }
  const setW = (v: number) => {
    const width = toBitmapW(v)
    if (!lockRatio || shownW <= 0) return patch({ width })
    patch({ width, height: toBitmapH(Math.max(1, Math.round((v * shownH) / shownW))) })
  }
  const setH = (v: number) => {
    const height = toBitmapH(v)
    if (!lockRatio || shownH <= 0) return patch({ height })
    patch({ height, width: toBitmapW(Math.max(1, Math.round((v * shownW) / shownH))) })
  }

  const exportSummary = `${{ png: 'PNG', jpeg: 'JPG', webp: 'WebP' }[format]} · @${scale}x${
    format === 'png' ? '' : ` · ${Math.round(quality * 100)}%`
  }`

  return (
    <aside id="properties-panel" className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto bg-panel">
      <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center border-b border-border bg-panel px-4 text-[12.5px] font-semibold text-txt">
        {t('属性')}
      </div>

      <Section
        title={t('图层')}
        action={
          edit && (
            <button
              type="button"
              className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-txt-3 transition-colors hover:bg-panel-2 hover:text-txt"
              title={t('重置本图层的全部编辑')}
              onClick={() =>
                patch({
                  name: undefined,
                  dx: undefined,
                  dy: undefined,
                  width: undefined,
                  height: undefined,
                  opacity: undefined,
                  blendMode: undefined,
                  radius: undefined,
                  border: undefined,
                  shadow: undefined
                })
              }
            >
              <UndoIcon className="h-3 w-3" />
              {t('重置')}
            </button>
          )
        }
      >
        <TextField
          key={`name-${layer.id}`}
          label={t('图层名')}
          value={layer.name}
          fallback={layer.edit?.baseName ?? layer.name}
          maxLength={80}
          onCommit={(v) => patch({ name: v === layer.edit?.baseName ? undefined : v })}
        />
        <InfoRow label={t('类型')} value={typeLabel} />
        {rnode && rnode.fillOpacity < 0.999 && (
          <InfoRow label={t('填充不透明度')} value={`${Math.round(rnode.fillOpacity * 100)}%`} />
        )}
        {layer.clipping && <InfoRow label={t('剪贴蒙版')} value={t('是')} />}
        {rnode?.mask && !rnode.mask.disabled && <InfoRow label={t('图层蒙版')} value={t('有')} />}
        {layerEffectNames(rnode).length > 0 && (
          <InfoRow label={t('图层样式')} value={layerEffectNames(rnode).join(t('、'))} />
        )}
        {layer.hidden && <InfoRow label={t('可见性')} value={t('已隐藏')} />}
      </Section>

      <Section title={t('变换')}>
        <div key={`tf-${layer.id}`} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <NumField
              label="X"
              value={shownLeft}
              allowNegative
              dirty={edit?.dx !== undefined}
              title={t('位置')}
              onCommit={(v) => setPos('dx', v)}
              onReset={() => patch({ dx: undefined })}
            />
            <NumField
              label="Y"
              value={shownTop}
              allowNegative
              dirty={edit?.dy !== undefined}
              title={t('位置')}
              onCommit={(v) => setPos('dy', v)}
              onReset={() => patch({ dy: undefined })}
            />
          </div>
          <div className="flex items-center gap-2">
            <NumField
              label="W"
              value={shownW}
              min={1}
              disabled={isGroup}
              dirty={edit?.width !== undefined}
              title={isGroup ? t('组的尺寸由子图层决定，不能直接改') : t('尺寸')}
              onCommit={setW}
              onReset={() => patch({ width: undefined })}
            />
            <button
              type="button"
              className={`shrink-0 rounded-md border p-1 transition-colors ${
                lockRatio
                  ? 'border-accent bg-accent-dim text-txt'
                  : 'border-border bg-panel-2 text-txt-3 hover:border-border-light'
              }`}
              title={t('锁定宽高比')}
              aria-pressed={lockRatio}
              onClick={() => setLockRatio((v) => !v)}
            >
              <LinkIcon className="h-3.5 w-3.5" />
            </button>
            <NumField
              label="H"
              value={shownH}
              min={1}
              disabled={isGroup}
              dirty={edit?.height !== undefined}
              title={isGroup ? t('组的尺寸由子图层决定，不能直接改') : t('尺寸')}
              onCommit={setH}
              onReset={() => patch({ height: undefined })}
            />
          </div>
          <NumField
            label={t('圆角')}
            value={Math.round(edit?.radius ?? content?.radius ?? 0)}
            dirty={edit?.radius !== undefined}
            title={t('四角统一的圆角半径，导出位图与 CSS 都按它裁切；未编辑时显示从位图 alpha 估算的原值')}
            onCommit={(v) => patch({ radius: v > 0 ? v : undefined })}
            onReset={() => patch({ radius: undefined })}
          />
        </div>
      </Section>

      <Section title={t('外观')}>
        <div key={`ap-${layer.id}`} className="flex flex-col gap-2.5">
          <PctField
            label={t('不透明度')}
            value={layer.opacity}
            dirty={edit?.opacity !== undefined}
            onCommit={(v) => patch({ opacity: v })}
            onReset={() => patch({ opacity: undefined })}
          />
          <div className="flex items-center gap-1.5">
            <FieldLabel text={t('混合模式')} dirty={edit?.blendMode !== undefined} />
            <select
              className="min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-panel-2 px-1.5 py-1 text-[11.5px] text-txt outline-none transition-colors hover:border-border-light focus:border-accent"
              value={layer.blendMode}
              onChange={(e) => patch({ blendMode: e.target.value })}
            >
              {!BLEND_MODES.includes(layer.blendMode) && (
                <option value={layer.blendMode}>{blendLabel(layer.blendMode)}</option>
              )}
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {blendLabel(m)}
                </option>
              ))}
            </select>
            {edit?.blendMode !== undefined && (
              <ResetBtn onClick={() => patch({ blendMode: undefined })} />
            )}
          </div>
        </div>
      </Section>

      <CollapsibleSection
        id="border-section"
        title={t('边框')}
        open={borderOpen}
        onToggle={() => setBorderOpen((v) => !v)}
        summary={
          edit?.border
            ? `${edit.border.size}px ${t(POSITION_LABEL[edit.border.position])}`
            : t('无')
        }
      >
        <div key={`bd-${layer.id}`} className="flex flex-col gap-2.5">
          <NumField
            label={t('宽度')}
            value={edit?.border?.size ?? 0}
            dirty={!!edit?.border}
            title={t('边框宽度，0 即不加边框')}
            onCommit={(v) => setBorder({ size: v })}
            onReset={() => patch({ border: undefined })}
          />
          <div className="flex items-center gap-1.5">
            <FieldLabel text={t('颜色')} dirty={!!edit?.border} />
            <ColorField value={border.color} onChange={(c) => setBorder({ color: c })} />
          </div>
          <div className="flex gap-1.5">
            {(['inside', 'center', 'outside'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={optCls(border.position === p)}
                onClick={() => setBorder({ position: p })}
              >
                {t(POSITION_LABEL[p])}
              </button>
            ))}
          </div>
          <PctField
            label={t('不透明度')}
            value={border.opacity}
            dirty={!!edit?.border}
            onCommit={(v) => setBorder({ opacity: v })}
            onReset={() => patch({ border: undefined })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="effect-section"
        title={t('投影')}
        open={fxOpen}
        onToggle={() => setFxOpen((v) => !v)}
        summary={edit?.shadow ? `${t('距离')} ${edit.shadow.distance} · ${t('大小')} ${edit.shadow.size}` : t('无')}
      >
        <div key={`fx-${layer.id}`} className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5">
            <FieldLabel text={t('颜色')} dirty={!!edit?.shadow} />
            <ColorField value={shadow.color} onChange={(c) => setShadow({ color: c })} />
            {edit?.shadow && <ResetBtn onClick={() => patch({ shadow: undefined })} />}
          </div>
          <PctField
            label={t('不透明度')}
            value={shadow.opacity}
            dirty={!!edit?.shadow}
            onCommit={(v) => setShadow({ opacity: v })}
            onReset={() => patch({ shadow: undefined })}
          />
          <div className="flex gap-2">
            <NumField
              label={t('角度')}
              value={Math.round(shadow.angle)}
              allowNegative
              min={-360}
              dirty={!!edit?.shadow}
              title={t('光源方向，与 PS 内建投影同义')}
              onCommit={(v) => setShadow({ angle: v })}
            />
            <NumField
              label={t('距离')}
              value={Math.round(shadow.distance)}
              dirty={!!edit?.shadow}
              onCommit={(v) => setShadow({ distance: v })}
            />
          </div>
          <div className="flex gap-2">
            <NumField
              label={t('大小')}
              value={Math.round(shadow.size)}
              dirty={!!edit?.shadow}
              title={t('投影模糊半径')}
              onCommit={(v) => setShadow({ size: v })}
            />
            <NumField
              label={t('阻塞')}
              value={Math.round(shadow.choke)}
              dirty={!!edit?.shadow}
              title={t('投影实心程度')}
              onCommit={(v) => setShadow({ choke: v })}
            />
          </div>
        </div>
      </CollapsibleSection>

      {color && (
        <Section title={t('取色')}>
          <button
            className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-panel-2 px-3 py-2 transition-colors hover:border-border-light"
            onClick={() => copy(color, 'color')}
          >
            <span
              className="h-5 w-5 shrink-0 rounded-md border border-border-light"
              style={{ background: color }}
            />
            <span className="flex-1 text-left font-mono text-[12px] text-txt">{color}</span>
            {copied === 'color' ? (
              <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5 text-txt-3" />
            )}
          </button>
        </Section>
      )}

      {layer.textInfo && (
        <Section title={t('文本')}>
          <div className="text-box" onClick={() => void copy(layer.textInfo!.content, 'text')}>
            <button
              className="cp"
              title={t('复制文本')}
              onClick={(e) => {
                e.stopPropagation()
                void copy(layer.textInfo!.content, 'text')
              }}
            >
              {copied === 'text' ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
            {layer.textInfo.content}
          </div>
          <div style={{ marginTop: 8 }}>
            {layer.textInfo.fontSize != null && (
              <InfoRow label={t('字体大小')} value={`${layer.textInfo.fontSize} px`} />
            )}
            {layer.textInfo.color && (
              <div className="flex items-center justify-between py-1">
                <span className="text-[11.5px] text-txt-3">{t('字体颜色')}</span>
                <span
                  className="flex items-center gap-1.5 font-mono text-[11px] text-txt"
                  style={{ cursor: 'pointer' }}
                  onClick={() => void copy(layer.textInfo!.color!, 'color')}
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-border-light"
                    style={{ background: layer.textInfo.color }}
                  />
                  {layer.textInfo.color}
                </span>
              </div>
            )}
            {layer.textInfo.fontWeight && <InfoRow label={t('字重')} value={layer.textInfo.fontWeight} />}
            {layer.textInfo.fontFamily && <InfoRow label={t('字体')} value={layer.textInfo.fontFamily} />}
            {layer.textInfo.leading != null && (
              <InfoRow label={t('行距')} value={`${Math.round(layer.textInfo.leading * 10) / 10} px`} />
            )}
            {layer.textInfo.tracking != null && layer.textInfo.tracking !== 0 && (
              <InfoRow
                label={t('字距')}
                value={`${Math.round(layer.textInfo.tracking) / 1000} em`}
              />
            )}
          </div>
        </Section>
      )}

      <Section title="CSS">
        <div className="mb-2 flex items-center gap-1.5">
          {(['px', 'rem', 'vw'] as CssUnit[]).map((u) => (
            <button key={u} onClick={() => setCssUnit(u)} className={optCls(cssUnits.unit === u)}>
              {u}
            </button>
          ))}
          {cssUnits.unit !== 'px' && (
            <span className="ml-auto font-mono text-[10.5px] text-txt-3">
              {cssUnits.unit === 'rem'
                ? `1rem = ${cssUnits.remBase}px`
                : `100vw = ${doc?.width ?? cssUnits.vwBase}px`}
            </span>
          )}
        </div>
        <div className="relative rounded-lg border border-border bg-panel-2">
          <button
            className="icon-btn absolute right-1.5 top-1.5"
            title={t('复制 CSS')}
            onClick={() => copy(css, 'css')}
          >
            {copied === 'css' ? (
              <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <CopyIcon className="h-3.5 w-3.5" />
            )}
          </button>
          <CssCode css={css} />
        </div>
      </Section>

      <CollapsibleSection
        id="export-section"
        title={t('导出')}
        open={exportOpen}
        onToggle={() => setExportOpen((v) => !v)}
        summary={exportSummary}
      >
        <div className="mb-2.5 flex gap-1.5">
          {(
            [
              ['png', 'PNG'],
              ['jpeg', 'JPG'],
              ['webp', 'WebP']
            ] as [ExportFormat, string][]
          ).map(([f, label]) => (
            <button key={f} onClick={() => setFormat(f)} className={optCls(format === f)}>
              {label}
            </button>
          ))}
        </div>
        <div className="mb-2.5 flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <button key={s} onClick={() => setScale(s)} className={optCls(scale === s)}>
              @{s}x
            </button>
          ))}
        </div>
        {format !== 'png' && (
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[11px] text-txt-3">{t('质量')}</span>
            <Slider
              min={0.5}
              max={1}
              step={0.01}
              value={quality}
              onChange={setQuality}
            />
            <b className="w-9 shrink-0 text-right font-mono text-[11px] text-txt-2">
              {Math.round(quality * 100)}%
            </b>
          </div>
        )}

        <button
          type="button"
          className="flex w-full items-center gap-1.5 py-1.5 text-left"
          onClick={() => {
            const next = !previewOpen
            setPreviewOpen(next)
            if (next) setPreviewSeen(true)
          }}
          aria-expanded={previewOpen}
        >
          <ChevronRightIcon
            className={`h-3 w-3 shrink-0 text-txt-3 transition-transform duration-200 ease-[var(--ease)] ${previewOpen ? 'rotate-90' : ''}`}
          />
          <span className="text-[11.5px] text-txt-2">{t('预览')}</span>
        </button>
        <Collapse open={previewOpen}>
          <div id="layer-preview" className="layer-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="" />
            ) : (
              <span>{t('该图层暂无位图内容')}</span>
            )}
          </div>
        </Collapse>

        <button
          className="btn btn-primary mt-1.5 w-full"
          onClick={() => onExport(format, scale, format === 'png' ? undefined : quality)}
        >
          {t('导出所选图层')}
        </button>
      </CollapsibleSection>

      {editCount > 0 && (
        <div className="px-4 py-3">
          <button
            type="button"
            className="btn btn-ghost w-full text-[11.5px] text-txt-3"
            title={t('把本文档所有图层恢复到 PSD 原值')}
            onClick={onClearEdits}
          >
            {t('清空本文档编辑')} · {editCount}
          </button>
        </div>
      )}
    </aside>
  )
}
