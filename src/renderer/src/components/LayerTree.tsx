import { useMemo, useState } from 'react'
import type { PsdLayer } from '@/types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  ImageIcon,
  SearchIcon,
  TextIcon
} from './icons'

interface Props {
  tree: PsdLayer[]
  hiddenIds: Set<number>
  selectedId: number | null
  onSelect: (layer: PsdLayer) => void
  onToggleHidden: (id: number) => void
}

function matchesSearch(node: PsdLayer, query: string): boolean {
  if (node.name.toLowerCase().includes(query)) return true
  return node.children?.some((c) => matchesSearch(c, query)) ?? false
}

function filterTree(nodes: PsdLayer[], query: string): PsdLayer[] {
  if (!query) return nodes
  return nodes
    .filter((n) => matchesSearch(n, query))
    .map((n) =>
      n.children ? { ...n, children: filterTree(n.children, query) } : n
    )
}

function LayerIcon({ layer }: { layer: PsdLayer }) {
  if (layer.type === 'group') return <FolderIcon className="h-3.5 w-3.5 text-txt-3" />
  if (layer.isText) return <TextIcon className="h-3.5 w-3.5 text-txt-3" />
  return <ImageIcon className="h-3.5 w-3.5 text-txt-3" />
}

function Row({
  layer,
  depth,
  searching,
  hiddenIds,
  selectedId,
  collapsed,
  toggleCollapse,
  onSelect,
  onToggleHidden
}: {
  layer: PsdLayer
  depth: number
  searching: boolean
  hiddenIds: Set<number>
  selectedId: number | null
  collapsed: Set<number>
  toggleCollapse: (id: number) => void
  onSelect: (layer: PsdLayer) => void
  onToggleHidden: (id: number) => void
}) {
  const isHidden = layer.hidden || hiddenIds.has(layer.id)
  const isCollapsed = collapsed.has(layer.id) && !searching
  const isSelected = selectedId === layer.id

  return (
    <>
      <div
        className={`group flex h-7 cursor-default items-center gap-1 rounded-md pr-1.5 text-[12px] ${
          isSelected ? 'bg-violet-600/25 text-txt' : 'text-txt-2 hover:bg-panel-2'
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelect(layer)}
      >
        {layer.children ? (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center text-txt-3"
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapse(layer.id)
            }}
          >
            {isCollapsed ? (
              <ChevronRightIcon className="h-3 w-3" />
            ) : (
              <ChevronDownIcon className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <LayerIcon layer={layer} />
        <span className={`flex-1 truncate ${isHidden ? 'line-through opacity-40' : ''}`}>
          {layer.name}
        </span>
        <span
          className="shrink-0 text-txt-3 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onToggleHidden(layer.id)
          }}
        >
          {isHidden ? (
            <EyeOffIcon className="h-3.5 w-3.5 hover:text-txt" />
          ) : (
            <EyeIcon className="h-3.5 w-3.5 hover:text-txt" />
          )}
        </span>
      </div>
      {!isCollapsed &&
        layer.children?.map((child) => (
          <Row
            key={child.id}
            layer={child}
            depth={depth + 1}
            searching={searching}
            hiddenIds={hiddenIds}
            selectedId={selectedId}
            collapsed={collapsed}
            toggleCollapse={toggleCollapse}
            onSelect={onSelect}
            onToggleHidden={onToggleHidden}
          />
        ))}
    </>
  )
}

export default function LayerTree({
  tree,
  hiddenIds,
  selectedId,
  onSelect,
  onToggleHidden
}: Props) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const filtered = useMemo(
    () => filterTree(tree, query.trim().toLowerCase()),
    [tree, query]
  )

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <span className="text-[12px] font-medium text-txt-2">图层</span>
        <span className="text-[11px] text-txt-3">{tree.length}</span>
      </div>
      <div className="border-b border-border p-2">
        <div className="flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1.5">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-txt-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索图层…"
            className="w-full bg-transparent text-[12px] text-txt outline-none placeholder:text-txt-3"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-[12px] text-txt-3">
            {tree.length === 0 ? '尚未打开 PSD 文件' : '没有匹配的图层'}
          </p>
        ) : (
          filtered.map((layer) => (
            <Row
              key={layer.id}
              layer={layer}
              depth={0}
              searching={query.trim().length > 0}
              hiddenIds={hiddenIds}
              selectedId={selectedId}
              collapsed={collapsed}
              toggleCollapse={toggleCollapse}
              onSelect={onSelect}
              onToggleHidden={onToggleHidden}
            />
          ))
        )}
      </div>
    </aside>
  )
}
