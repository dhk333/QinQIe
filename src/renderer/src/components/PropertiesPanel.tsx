import { useMemo, useState } from 'react'
import type { ExportFormat, PsdLayer } from '@/types'
import { layerCssSnippet, sampleColor } from '@/lib/export'
import { CheckIcon, CopyIcon } from './icons'

interface Props {
  layer: PsdLayer | null
  canvasMap: Map<number, HTMLCanvasElement>
  onExport: (format: ExportFormat, scale: number) => void
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

export default function PropertiesPanel({ layer, canvasMap, onExport }: Props) {
  const [format, setFormat] = useState<ExportFormat>('png')
  const [scale, setScale] = useState(2)
  const [copied, setCopied] = useState<'css' | 'color' | null>(null)

  const color = useMemo(
    () => (layer ? sampleColor(canvasMap.get(layer.id)!) : null),
    [layer, canvasMap]
  )
  const css = useMemo(() => (layer ? layerCssSnippet(layer, color) : ''), [layer, color])

  if (!layer) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-panel">
        <div className="flex h-10 items-center border-b border-border px-4 text-[12px] font-medium text-txt-2">
          属性
        </div>
        <p className="px-4 py-6 text-center text-[12px] text-txt-3">
          在画布或图层面板中选择图层
        </p>
      </aside>
    )
  }

  const copy = async (text: string, kind: 'css' | 'color') => {
    await navigator.clipboard.writeText(text)
    setCopied(kind)
    setTimeout(() => setCopied(null), 1200)
  }

  const typeLabel = layer.type === 'group' ? '图层组' : layer.isText ? '文本图层' : '像素图层'

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel">
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
          <pre className="overflow-x-auto p-3 pr-9 font-mono text-[11px] leading-5 text-txt-2">
            {css}
          </pre>
        </div>
      </Section>

      <Section title="导出设置">
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
              className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                format === f
                  ? 'border-violet-500 bg-violet-600/20 text-txt'
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
              className={`flex-1 rounded-md border px-2 py-1.5 text-[12px] transition-colors ${
                scale === s
                  ? 'border-violet-500 bg-violet-600/20 text-txt'
                  : 'border-border bg-panel-2 text-txt-2 hover:border-border-light'
              }`}
            >
              @{s}x
            </button>
          ))}
        </div>
        <button className="btn-primary w-full" onClick={() => onExport(format, scale)}>
          导出所选图层
        </button>
      </Section>
    </aside>
  )
}
