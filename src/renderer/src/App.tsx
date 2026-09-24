import { useCallback, useRef, useState } from 'react'
import type { ExportFormat, PsdDoc, PsdLayer } from '@/types'
import { parsePsd, type ParseResult } from '@/lib/psd'
import { layerToDataUrl } from '@/lib/export'
import TitleBar from '@/components/TitleBar'
import LayerTree from '@/components/LayerTree'
import CanvasView from '@/components/CanvasView'
import PropertiesPanel from '@/components/PropertiesPanel'

export default function App() {
  const [doc, setDoc] = useState<PsdDoc | null>(null)
  const [tree, setTree] = useState<PsdLayer[]>([])
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const selectedLayer = (() => {
    if (selectedId == null || !doc) return null
    const find = (nodes: PsdLayer[]): PsdLayer | null => {
      for (const n of nodes) {
        if (n.id === selectedId) return n
        const hit = n.children ? find(n.children) : null
        if (hit) return hit
      }
      return null
    }
    return find(tree)
  })()

  const handleOpen = useCallback(async () => {
    const result = await window.api.openPsd()
    if (!result) return
    setLoading(true)
    await new Promise((r) => setTimeout(r, 30))
    try {
      const parsed: ParseResult = parsePsd(result.buffer, result.name)
      canvasMapRef.current = parsed.canvasMap
      setDoc(parsed.doc)
      setTree(parsed.tree)
      setHiddenIds(new Set())
      setSelectedId(null)
    } catch (err) {
      alert(`解析 PSD 失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleExport = useCallback(
    async (format: ExportFormat, scale: number) => {
      if (!selectedLayer || !doc) return
      const canvas = canvasMapRef.current.get(selectedLayer.id)
      if (!canvas) {
        alert('该图层没有可导出的位图内容（文本或空图层）')
        return
      }
      const safeName = selectedLayer.name.replace(/[\\/:*?"<>|]/g, '_')
      const ext = format === 'jpeg' ? 'jpg' : format
      const dataUrl = layerToDataUrl(selectedLayer, canvas, format, scale)
      const saved = await window.api.saveImage(`${safeName}@${scale}x.${ext}`, format, dataUrl)
      if (saved) {
        // 导出成功，暂不做提示 UI
      }
    },
    [selectedLayer, doc]
  )

  const toggleHidden = useCallback((id: number) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        fileName={doc?.fileName ?? null}
        canExport={!!selectedLayer}
        onOpen={handleOpen}
        onExport={() => selectedLayer && handleExport('png', 2)}
      />
      <div className="flex min-h-0 flex-1">
        <LayerTree
          tree={tree}
          hiddenIds={hiddenIds}
          selectedId={selectedId}
          onSelect={(l) => setSelectedId(l.id)}
          onToggleHidden={toggleHidden}
        />
        <div className="relative flex min-w-0 flex-1">
          <CanvasView
            doc={doc}
            tree={tree}
            canvasMap={canvasMapRef.current}
            hiddenIds={hiddenIds}
            selectedId={selectedId}
            onSelect={(l) => setSelectedId(l.id)}
          />
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/70 backdrop-blur-sm">
              <span className="text-[13px] text-txt-2">正在解析 PSD…</span>
            </div>
          )}
        </div>
        <PropertiesPanel layer={selectedLayer} canvasMap={canvasMapRef.current} onExport={handleExport} />
      </div>
    </div>
  )
}
