import { useMemo, useState } from 'react'
import type { ExportFormat, PsdDoc, PsdLayer } from '@/types'
import { blendLabel, layerCssSnippet, layerEffectNames, sampleColor } from '@/lib/export'
import { loadExportPrefs } from '@/lib/exportPrefs'
import { indexRNodes, renderLayerCanvas } from '@/lib/psd'
import { getLang, useT } from '@/i18n/core'
import type { RNode } from '@/lib/compositor'
import { CheckIcon, ChevronRightIcon, CopyIcon } from './icons'
import Slider from './Slider'

interface Props {
  layer: PsdLayer | null
  doc: PsdDoc | null
  rnodes: RNode[]
  canvasMap: Map<number, HTMLCanvasElement>
  hiddenIds: Set<number>
  onExport: (format: ExportFormat, scale: number, quality?: number) => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 pb-4 pt-3.5">
      <h3 className="mb-3 text-[12px] font-semibold tracking-normal text-txt">{title}</h3>
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

export default function PropertiesPanel({ layer, doc, rnodes, canvasMap, hiddenIds, onExport }: Props) {
  const t = useT()
  const [format, setFormat] = useState<ExportFormat>(() => loadExportPrefs().format)
  const [scale, setScale] = useState(() => loadExportPrefs().scales[0])
  const [quality, setQuality] = useState(() => loadExportPrefs().quality)
  const [copied, setCopied] = useState<'css' | 'color' | 'text' | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewSeen, setPreviewSeen] = useState(false)

  const rnodeMap = useMemo(() => indexRNodes(rnodes), [rnodes])
  const rnode = layer ? rnodeMap.get(layer.id) : undefined
  const color = useMemo(
    () => {
      const c = layer ? canvasMap.get(layer.id) : undefined
      return c ? sampleColor(c) : null
    },
    [layer, canvasMap]
  )
  const css = useMemo(
    () => (layer ? layerCssSnippet(layer, color, rnode) : ''),
    // getLang(): CSS 注释内嵌展示标签，语言切换后需重新生成
    [layer, color, rnode, getLang()]
  )
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

  const exportSummary = `${{ png: 'PNG', jpeg: 'JPG', webp: 'WebP' }[format]} · @${scale}x${
    format === 'png' ? '' : ` · ${Math.round(quality * 100)}%`
  }`

  return (
    <aside id="properties-panel" className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto bg-panel">
      <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center border-b border-border bg-panel px-4 text-[12.5px] font-semibold text-txt">
        {t('属性')}
      </div>

      <Section title={t('图层')}>
        <p className="mb-2 truncate text-[13px] font-medium text-txt" title={layer.name}>
          {layer.name}
        </p>
        <InfoRow label={t('类型')} value={typeLabel} />
        <InfoRow label={t('位置')} value={`X ${layer.left}, Y ${layer.top}`} />
        <InfoRow label={t('尺寸')} value={`${layer.width} × ${layer.height}`} />
        <InfoRow label={t('不透明度')} value={`${Math.round(layer.opacity * 100)}%`} />
        {rnode && rnode.fillOpacity < 0.999 && (
          <InfoRow label={t('填充不透明度')} value={`${Math.round(rnode.fillOpacity * 100)}%`} />
        )}
        <InfoRow label={t('混合模式')} value={blendLabel(layer.blendMode)} />
        {layer.clipping && <InfoRow label={t('剪贴蒙版')} value={t('是')} />}
        {rnode?.mask && !rnode.mask.disabled && <InfoRow label={t('图层蒙版')} value={t('有')} />}
        {layerEffectNames(rnode).length > 0 && (
          <InfoRow label={t('图层样式')} value={layerEffectNames(rnode).join(t('、'))} />
        )}
        {layer.hidden && <InfoRow label={t('可见性')} value={t('已隐藏')} />}
      </Section>

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
    </aside>
  )
}
