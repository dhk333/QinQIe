import { OpenIcon, DownloadIcon } from './icons'

interface Props {
  fileName: string | null
  canExport: boolean
  onOpen: () => void
  onExport: () => void
}

export default function TitleBar({ fileName, canExport, onOpen, onExport }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg px-4">
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 to-violet-400 text-[12px] font-bold text-white">
          切
        </div>
        <span className="text-[14px] font-semibold">轻切</span>
        <span className="rounded-full border border-border px-1.5 py-px text-[10px] text-txt-3">
          v0.1
        </span>
      </div>

      <div className="flex items-center gap-2">
        {fileName && (
          <span className="max-w-[280px] truncate rounded-md bg-panel px-2.5 py-1 text-[12px] text-txt-2">
            {fileName}
          </span>
        )}
        <button className="btn-secondary" onClick={onOpen}>
          <OpenIcon className="h-4 w-4" />
          打开 PSD
        </button>
        <button className="btn-primary" onClick={onExport} disabled={!canExport}>
          <DownloadIcon className="h-4 w-4" />
          导出
        </button>
      </div>
    </header>
  )
}
