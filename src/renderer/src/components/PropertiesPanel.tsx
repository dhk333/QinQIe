import { useMemo, useState } from 'react'
import type { ExportFormat, PsdDoc, PsdLayer } from '@/types'
import { blendLabel, layerCssSnippet, layerEffectNames, sampleColor } from '@/lib/export'
import { loadExportPrefs } from '@/lib/exportPrefs'
import { indexRNodes, renderLayerCanvas } from '@/lib/psd'
import type { RNode } from '@/lib/compositor'
import { CheckIcon, CopyIcon } from './icons'
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
  const [format, setFormat] = useState<ExportFormat>(() => loadExportPrefs().format)
  const [scale, setScale] = useState(() => loadExportPrefs().scales[0])
  const [quality, setQuality] = useState(() => loadExportPrefs().quality)
  const [copied, setCopied] = useState<'css' | 'color' | 'text' | null>(null)

  const rnodeMap = useMemo(() => indexRNodes(rnodes), [rnodes])
  const rnode = layer ? rnodeMap.get(layer.id) : undefined
  const color = useMemo(
    () => {
      const c = layer ? canvasMap.get(layer.id) : undefined
      return c ? sampleColor(c) : null
    },
    [layer, canvasMap]
  )
  const css = useMemo(() => (layer ? layerCssSnippet(layer, color, rnode) : ''), [layer, color, rnode])
  const previewUrl = useMemo(() => {
    if (!layer || !doc) return null
    try {
      const c = renderLayerCanvas(layer, rnodes, hiddenIds)
      if (!c || !c.width || !c.height) return null
      return c.toDataURL('image/png')
    } catch {
      return null
    }
  }, [layer, doc, rnodes, hiddenIds])

  if (!layer) {
    return (
      <aside className="flex w-full min-h-0 flex-1 flex-col bg-panel">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4 text-[12.5px] font-semibold text-txt">
          属性
        </div>
        <p className="px-4 py-6 text-center text-[12px] text-txt-3">
          在画布或图层面板中选择图层
        </p>
      </aside>
    )
  }

  const copy = async (text: string, kind: 'css' | 'color' | 'text') => {
    await navigator.clipboard.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1200)
  }

  const typeLabel = layer.type === 'group' ? '图层组' : layer.isText ? '文本图层' : '像素图层'

  return (
    <aside className="flex w-full min-h-0 flex-1 flex-col overflow-y-auto bg-panel">
      <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center border-b border-border bg-panel px-4 text-[12.5px] font-semibold text-txt">
        属性
      </div>

      <Section title="图层">
        <p className="mb-2 truncate text-[13px] font-medium text-txt" title={layer.name}>
          {layer.name}
        </p>
        <InfoRow label="类型" value={typeLabel} />
        <InfoRow label="位置" value={`X ${layer.left}, Y ${layer.top}`} />
        <InfoRow label="尺寸" value={`${layer.width} × ${layer.height}`} />
        <InfoRow label="不透明度" value={`${Math.round(layer.opacity * 100)}%`} />
        {rnode && rnode.fillOpacity < 0.999 && (
          <InfoRow label="填充不透明度" value={`${Math.round(rnode.fillOpacity * 100)}%`} />
        )}
        <InfoRow label="混合模式" value={blendLabel(layer.blendMode)} />
        {layer.clipping && <InfoRow label="剪贴蒙版" value="是" />}
        {rnode?.mask && !rnode.mask.disabled && <InfoRow label="图层蒙版" value="有" />}
        {layerEffectNames(rnode).length > 0 && (
          <InfoRow label="图层样式" value={layerEffectNames(rnode).join('、')} />
        )}
        {layer.hidden && <InfoRow label="可见性" value="已隐藏" />}
      </Section>

      {color && (
        <Section title="取色">
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
        <Section title="文本">
          <div className="text-box" onClick={() => void copy(layer.textInfo!.content, 'text')}>
            <button
              className="cp"
              title="复制文本"
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
              <InfoRow label="字体大小" value={`${layer.textInfo.fontSize} px`} />
            )}
            {layer.textInfo.color && (
              <div className="flex items-center justify-between py-1">
                <span className="text-[11.5px] text-txt-3">字体颜色</span>
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
            {layer.textInfo.fontWeight && <InfoRow label="字重" value={layer.textInfo.fontWeight} />}
            {layer.textInfo.fontFamily && <InfoRow label="字体" value={layer.textInfo.fontFamily} />}
            {layer.textInfo.leading != null && (
              <InfoRow label="行距" value={`${Math.round(layer.textInfo.leading * 10) / 10} px`} />
            )}
            {layer.textInfo.tracking != null && layer.textInfo.tracking !== 0 && (
              <InfoRow
                label="字距"
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
            title="复制 CSS"
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

      <Section title="导出设置">
        <div className="layer-preview">
          {previewUrl ? (
            <img src={previewUrl} alt="" />
          ) : (
            <span>该图层暂无位图内容</span>
          )}
        </div>
        <div className="mb-3 flex gap-1.5">
          {(
            [
              ['png', 'PNG'],
              ['jpeg', 'JPG'],
              ['webp', 'WebP']
            ] as [ExportFormat, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`flex-1 cursor-pointer rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                format === f
                  ? 'border-accent bg-accent-dim text-txt'
                  : 'border-border bg-panel-2 text-txt-2 hover:border-border-light'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mb-3 flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={`flex-1 cursor-pointer rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                scale === s
                  ? 'border-accent bg-accent-dim text-txt'
                  : 'border-border bg-panel-2 text-txt-2 hover:border-border-light'
              }`}
            >
              @{s}x
            </button>
          ))}
        </div>
        {format !== 'png' && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] text-txt-3">质量</span>
            <Slider
              min={0.5}
              max={1}
              step={0.01}
              value={quality}
              onChange={setQuality}
            />
            <b className="font-mono text-[11px] text-txt-2">{Math.round(quality * 100)}%</b>
          </div>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={() => onExport(format, scale, format === 'png' ? undefined : quality)}
        >
          导出所选图层
        </button>
      </Section>
    </aside>
  )
}
