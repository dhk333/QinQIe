import { useEffect, useRef, useState } from 'react'
import type { Project, ProjectPsd } from '@/types'
import { genId } from '@/lib/projects'
import { useDialog, useToast } from '@/lib/ui'
import { FolderIcon } from '@/components/icons'
import PsdThumb from '@/components/PsdThumb'

interface Props {
  project: Project
  onUpdate: (mutate: (p: Project) => void) => void
  onOpenPsd: (psd: ProjectPsd) => void
  registerUpload: (fn: () => void) => void
}

const AllIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </svg>
)
const FolderSvg = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
)
const GridLayoutIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
)
const StripLayoutIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="3" y="5" width="5.5" height="14" rx="1.5" />
    <rect x="9.5" y="5" width="5" height="14" rx="1.5" />
    <rect x="15.5" y="5" width="5.5" height="14" rx="1.5" />
  </svg>
)

async function importPaths(paths: string[]): Promise<{ ok: ProjectPsd[]; failed: string[] }> {
  const results = (await window.api.importPsds(paths)) as Array<{
    path: string
    name: string
    w: number
    h: number
    dataUrl: string | null
    thumbPath: string
    error?: string
  }>
  const ok: ProjectPsd[] = []
  const failed: string[] = []
  for (const r of results) {
    if (r.error || !r.dataUrl) {
      failed.push(r.name)
      continue
    }
    ok.push({
      id: genId('s'),
      name: r.name,
      path: r.path,
      w: r.w,
      h: r.h,
      groupId: null,
      thumbPath: r.thumbPath
    })
  }
  return { ok, failed }
}

export default function ProjectPage({ project, onUpdate, onOpenPsd, registerUpload }: Props) {
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [dragOverGrp, setDragOverGrp] = useState<string | null>(null)
  const [grpCollapsed, setGrpCollapsed] = useState(false)
  const [stripMode, setStripMode] = useState(() => localStorage.getItem('qc-art-layout') === 'strip')
  const toggleLayout = () =>
    setStripMode((v) => {
      localStorage.setItem('qc-art-layout', v ? 'grid' : 'strip')
      return !v
    })
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const dialog = useDialog()
  const toast = useToast()
  const selectedGroupRef = useRef(selectedGroup)
  selectedGroupRef.current = selectedGroup

  const upload = async (paths?: string[]) => {
    let target = paths
    if (!target) {
      target = await window.api.pickPsdPaths()
      if (!target.length) return
    }
    const existing = new Set(project.psds.map((p) => p.path))
    const fresh = target.filter((p) => !existing.has(p))
    if (!fresh.length) {
      toast('所选文件已在项目中', 'warning')
      return
    }
    const groupId = selectedGroup !== 'all' && selectedGroup !== 'ungrouped' ? selectedGroup : null
    const { ok, failed } = await importPaths(fresh)
    onUpdate((p) => {
      for (const item of ok) {
        item.groupId = groupId
        p.psds.push(item)
      }
    })
    if (failed.length) toast(`${failed.length} 个文件解析失败`, 'error')
    if (ok.length) toast(`已添加 ${ok.length} 个 PSD`)
  }

  useEffect(() => {
    registerUpload(() => void upload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, selectedGroup])

  // 分组操作
  const handleAddGroup = async () => {
    const name = await dialog({ type: 'prompt', title: '新建分组', placeholder: '分组名称' })
    if (!name || typeof name !== 'string') return
    if (project.groups.some((g) => g.name === name)) {
      toast('分组名称已存在', 'warning')
      return
    }
    const id = genId('g')
    onUpdate((p) => p.groups.push({ id, name }))
    setSelectedGroup(id)
    toast(`已创建分组「${name}」`)
  }

  const handleRenameGroup = async (gId: string) => {
    const target = project.groups.find((g) => g.id === gId)
    if (!target) return
    const name = await dialog({ type: 'prompt', title: '重命名分组', value: target.name })
    if (!name || typeof name !== 'string' || name === target.name) return
    if (project.groups.some((g) => g.name === name && g.id !== gId)) {
      toast('分组名称已存在', 'warning')
      return
    }
    onUpdate((p) => {
      const t = p.groups.find((g) => g.id === gId)
      if (t) t.name = name
    })
    toast('已重命名')
  }

  const handleDeleteGroup = async (gId: string) => {
    const target = project.groups.find((g) => g.id === gId)
    if (!target) return
    const cnt = project.psds.filter((p) => p.groupId === gId).length
    const ok = await dialog({
      type: 'confirm',
      title: `删除分组「${target.name}」`,
      desc: cnt ? `分组内的 ${cnt} 个画板将移入「未分组」` : '该分组为空，确定删除吗？',
      okText: '删除',
      danger: true
    })
    if (!ok) return
    onUpdate((p) => {
      p.psds.forEach((s) => {
        if (s.groupId === gId) s.groupId = null
      })
      p.groups = p.groups.filter((g) => g.id !== gId)
    })
    if (selectedGroup === gId) setSelectedGroup('all')
    toast(`已删除分组「${target.name}」`)
  }

  const handleDeletePsd = async (psd: ProjectPsd) => {
    const ok = await dialog({
      type: 'confirm',
      title: `删除「${psd.name}」`,
      desc: '只从项目中移除记录，不会删除本地文件',
      okText: '删除',
      danger: true
    })
    if (!ok) return
    onUpdate((p) => {
      p.psds = p.psds.filter((s) => s.id !== psd.id)
    })
    toast(`已删除「${psd.name}」`)
  }

  const handleRenamePsd = async (psd: ProjectPsd) => {
    const name = await dialog({ type: 'prompt', title: '重命名 PSD', value: psd.name })
    if (!name || typeof name !== 'string' || name === psd.name) return
    onUpdate((p) => {
      const s = p.psds.find((x) => x.id === psd.id)
      if (s) s.name = name
    })
    toast('已重命名')
  }

  // 拖拽归类
  const onCardDragStart = (e: React.DragEvent, psd: ProjectPsd) => {
    e.dataTransfer.setData('text/plain', psd.id)
  }
  const onGroupDragOver = (e: React.DragEvent, g: string) => {
    if (g === 'all') return
    e.preventDefault()
    setDragOverGrp(g)
  }
  const onGroupDrop = (e: React.DragEvent, g: string) => {
    e.preventDefault()
    setDragOverGrp(null)
    const psdId = e.dataTransfer.getData('text/plain')
    if (!psdId) return
    onUpdate((p) => {
      const s = p.psds.find((x) => x.id === psdId)
      if (s) s.groupId = g === 'ungrouped' ? null : g
    })
  }

  // 检查文件是否丢失
  useEffect(() => {
    let alive = true
    Promise.all(
      project.psds.map(async (s) => {
        const exists = await window.api.fileExists(s.path)
        return { id: s.id, exists }
      })
    ).then((checks) => {
      if (!alive) return
      const missingIds = checks.filter((c) => !c.exists).map((c) => c.id)
      if (missingIds.length === 0) return
      onUpdate((p) => {
        p.psds.forEach((s) => {
          if (missingIds.includes(s.id)) s.missing = true
        })
      })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.psds.length])

  const list = project.psds.filter((s) =>
    selectedGroup === 'all' ? true : selectedGroup === 'ungrouped' ? !s.groupId : s.groupId === selectedGroup
  )
  const cnt = (g: string) =>
    project.psds.filter((s) =>
      g === 'all' ? true : g === 'ungrouped' ? !s.groupId : s.groupId === g
    ).length

  const grpClass = (g: string) => `grp${selectedGroup === g ? ' on' : ''}${dragOverGrp === g ? ' dragover' : ''}`

  return (
    <div className={`proj-body${grpCollapsed ? ' grp-collapsed' : ''}`}>
      <aside className={`group-panel${grpCollapsed ? ' collapsed' : ''}`}>
        <span className={grpClass('all')} onClick={() => setSelectedGroup('all')}>
          {AllIcon}
          全部<span className="cnt">{cnt('all')}</span>
        </span>
        {project.groups.map((g) => (
          <span
            key={g.id}
            className={grpClass(g.id)}
            onClick={() => setSelectedGroup(g.id)}
            onDragOver={(e) => onGroupDragOver(e, g.id)}
            onDragLeave={() => setDragOverGrp(null)}
            onDrop={(e) => onGroupDrop(e, g.id)}
          >
            {FolderSvg}
            {g.name}
            <span className="cnt">{cnt(g.id)}</span>
            <span className="g-ops">
              <span title="重命名分组" onClick={(e) => { e.stopPropagation(); void handleRenameGroup(g.id) }}>✎</span>
              <span title="删除分组" onClick={(e) => { e.stopPropagation(); void handleDeleteGroup(g.id) }}>✕</span>
            </span>
          </span>
        ))}
        <span className={grpClass('ungrouped')} onClick={() => setSelectedGroup('ungrouped')}
          onDragOver={(e) => onGroupDragOver(e, 'ungrouped')}
          onDragLeave={() => setDragOverGrp(null)}
          onDrop={(e) => onGroupDrop(e, 'ungrouped')}>
          {FolderSvg}
          未分组<span className="cnt">{cnt('ungrouped')}</span>
        </span>
        <span className="grp-add" onClick={() => void handleAddGroup()}>＋ 新建分组</span>
      </aside>
      <span
        className="gp-chev"
        title={grpCollapsed ? '展开分组栏' : '收起分组栏'}
        onClick={() => setGrpCollapsed((v) => !v)}
      >
        {grpCollapsed ? '›' : '‹'}
      </span>

      <button
        className="icon-btn art-layout-btn"
        title={stripMode ? '切换为网格布局' : '切换为横向滚动布局'}
        onClick={toggleLayout}
      >
        {stripMode ? GridLayoutIcon : StripLayoutIcon}
      </button>

      <main
        className={`art-flow${stripMode ? ' strip' : ''}`}
        onWheel={(e) => {
          if (stripMode && Math.abs(e.deltaY) > Math.abs(e.deltaX))
            e.currentTarget.scrollLeft += e.deltaY
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          const paths = window.api.pathsForFiles([...e.dataTransfer.files]).filter((p) =>
            p.toLowerCase().endsWith('.psd')
          )
          if (paths.length) void upload(paths)
        }}
      >
        {list.length === 0 ? (
          <div className="art-empty">
            <div className="empty-stack"><i /><i /></div>
            {selectedGroup === 'all' ? (
              <>
                <h4>项目还没有设计稿</h4>
                <p>点击右上角「上传 PSD」<br />或把 PSD 文件直接拖到这里</p>
              </>
            ) : (
              <>
                <h4>该分组还没有画板</h4>
                <p>把「全部」里的画板拖到左侧分组上即可归类</p>
                <button className="btn btn-ghost" onClick={() => setSelectedGroup('all')}>查看全部画板</button>
              </>
            )}
          </div>
        ) : (
          list.map((psd, i) => (
            <div
              key={psd.id}
              className={`art-card${psd.missing ? ' missing' : ''}`}
              style={{
                width:
                  (stripMode
                    ? Math.round(560 * (psd.w / Math.max(psd.h, 1)))
                    : Math.max(110, Math.min(420, Math.round(250 * (psd.w / Math.max(psd.h, 1)))))) + 'px',
                animationDelay: `${Math.min(i * 40, 480)}ms`
              }}
              draggable={!psd.missing}
              onDragStart={(e) => onCardDragStart(e, psd)}
              onClick={() => {
                if (!psd.missing) onOpenPsd(psd)
                else toast('文件丢失，请先重新定位', 'warning')
              }}
            >
              <div className={`art-thumb${psd.missing ? ' missing' : ''}`} style={{ height: stripMode ? '560px' : '250px' }}>
                <PsdThumb thumbPath={psd.thumbPath} kind="thumb" />
                <span className="ops">
                  <span title="重命名" onClick={(e) => { e.stopPropagation(); void handleRenamePsd(psd) }}>✎</span>
                  <span title="删除此 PSD" onClick={(e) => { e.stopPropagation(); void handleDeletePsd(psd) }}>✕</span>
                </span>
              </div>
              <div className="art-name">
                {psd.name}
                {psd.w > 0 && <span className="size">{psd.w}×{psd.h}</span>}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  )
}
