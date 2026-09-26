import { useMemo, useState } from 'react'
import type { ExportFormat, PsdDoc, PsdLayer } from '@/types'
import { layerCssSnippet, sampleColor } from '@/lib/export'
import { renderLayerCanvas } from '@/lib/psd'
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
    <div className="border-b border-border px-4 py-3.5">
      <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-txt-3">
        {title}
      </h3>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[12px] text-txt-3">{label}</span>
      <span className="text-[12px] text-txt">{value}</span>
    </div>
  )
}

export default function PropertiesPanel({ layer, doc, rnodes, canvasMap, hiddenIds, onExport }: Props) {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState(2)
  const [quality, setQuality] = useState(0.92)
  const [copied, setCopied] = useState<'css' | 'color' | 'text' | null>(null)

  const color = useMemo(
    () => {
      const c = layer ? canvasMap.get(layer.id) : undefined
      return c ? sampleColor(c) : null
    },
    [layer, canvasMap]
  )
  const css = useMemo(() => (layer ? layerCssSnippet(layer, color) : ''), [layer, color])
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
        <div className="flex h-10 items-center border-b border-border px-4 text-[12px] font-medium text-txt-2">
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
      <div className="flex h-10 items-center border-b border-border px-4 text-[12px] font-medium text-txt-2">
        属性
      </div>

      <Section title="图层">
        <p className="mb-2 truncate text-[13px] font-medium text-txt" title={layer.name}>
          {layer.name}
        </p>
        <InfoRow label="类型" value={typeLabel} />
        <InfoRow label="位置" value={`X ${layer.left}, Y ${layer.top}`} />
        <InfoRow label="尺寸" value={`${layer.width} × ${layer.height}`} />
        <InfoRow label="透明度" value={`${Math.round(layer.opacity * 100)}%`} />
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
              <div className="flex items-center justify-between py-0.5">
                <span className="text-[12px] text-txt-3">字体颜色</span>
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
          <pre className="code-block overflow-x-auto p-3 pr-9 font-mono text-[11px] leading-5 text-txt-2">
            {css}
          </pre>
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
