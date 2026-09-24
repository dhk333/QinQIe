import { useState } from 'react'
import type { Project } from '@/types'
import { useDialog, useToast } from '@/lib/ui'
import { FolderIcon } from '@/components/icons'
import PsdThumb from '@/components/PsdThumb'

interface Props {
  projects: Project[]
  onOpen: (id: string) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export default function HomePage({ projects, onOpen, onCreate, onRename, onDelete }: Props) {
  const [query, setQuery] = useState('')
  const dialog = useDialog()
  const toast = useToast()

  const q = query.trim().toLowerCase()
  const list = projects.filter((p) => p.name.toLowerCase().includes(q))

  const handleCreate = async () => {
    const name = await dialog({
      type: 'prompt',
      title: '新建项目',
      desc: '项目用于归类同一批设计稿，PSD 文件只记录路径、不会被移动',
      placeholder: '项目名称，例如：沃尔核材官网',
      okText: '创建'
    })
    if (!name || typeof name !== 'string') return
    onCreate(name)
  }

  const handleRename = async (p: Project) => {
    const name = await dialog({ type: 'prompt', title: '重命名项目', value: p.name })
    if (!name || typeof name !== 'string' || name === p.name) return
    onRename(p.id, name)
    toast('已重命名')
  }

  const handleDelete = async (p: Project) => {
    const ok = await dialog({
      type: 'confirm',
      title: `删除项目「${p.name}」`,
      desc: p.psds.length ? `该项目包含 ${p.psds.length} 个 PSD 记录，删除后需要重新上传` : '确定要删除该项目吗？',
      okText: '删除',
      danger: true
    })
    if (!ok) return
    onDelete(p.id)
    toast(`已删除项目「${p.name}」`)
  }

  return (
    <main className="home-main">
      <div className="proj-grid">
        {list.map((p, i) => (
          <div
            key={p.id}
            className="proj-card pop-in"
            style={{ animationDelay: `${Math.min(i * 40, 480)}ms` }}
            onClick={() => onOpen(p.id)}
          >
            <div className="proj-cover">
              <PsdThumb thumbPath={p.psds.find((s) => s.thumbPath && !s.missing)?.thumbPath} kind="cover" />
              <span className="cnt-badge">{p.psds.length} 画板</span>
              <span className="ops">
                <span title="重命名" onClick={(e) => { e.stopPropagation(); void handleRename(p) }}>✎</span>
                <span title="删除项目" onClick={(e) => { e.stopPropagation(); void handleDelete(p) }}>✕</span>
              </span>
            </div>
            <div className="proj-name">
              <FolderIcon className="h-3.5 w-3.5" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="cnt">{p.psds.length} 个 PSD</span>
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && (
        <div className="art-empty">
          <div className="empty-stack"><i /><i /></div>
          <h4>{q ? '没有匹配的项目' : '还没有项目'}</h4>
          <p>点击右上角「新建项目」开始</p>
        </div>
      )}
    </main>
  )
}
