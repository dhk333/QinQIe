import { useState } from 'react'
import type { Project } from '@/types'
import { useDialog, useToast } from '@/lib/ui'
import { useT } from '@/i18n/core'
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
  const t = useT()
  const [query, setQuery] = useState('')
  const dialog = useDialog()
  const toast = useToast()

  const q = query.trim().toLowerCase()
  const list = projects.filter((p) => p.name.toLowerCase().includes(q))

  const handleCreate = async () => {
    const name = await dialog({
      type: 'prompt',
      title: t('新建项目'),
      desc: t('项目用于归类同一批设计稿，PSD 文件只记录路径、不会被移动'),
      placeholder: t('项目名称，例如：沃尔核材官网'),
      okText: t('创建')
    })
    if (!name || typeof name !== 'string') return
    onCreate(name)
  }

  const handleRename = async (p: Project) => {
    const name = await dialog({ type: 'prompt', title: t('重命名项目'), value: p.name })
    if (!name || typeof name !== 'string' || name === p.name) return
    onRename(p.id, name)
    toast(t('已重命名'))
  }

  const handleDelete = async (p: Project) => {
    const ok = await dialog({
      type: 'confirm',
      title: t('删除项目「{name}」', { name: p.name }),
      desc: p.psds.length ? t('该项目包含 {n} 个 PSD 记录，删除后需要重新上传', { n: p.psds.length }) : t('确定要删除该项目吗？'),
      okText: t('删除'),
      danger: true
    })
    if (!ok) return
    onDelete(p.id)
    toast(t('已删除项目「{name}」', { name: p.name }))
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
              <span className="cnt-badge">{t('{n} 画板', { n: p.psds.length })}</span>
              <span className="ops">
                <span title={t('重命名')} onClick={(e) => { e.stopPropagation(); void handleRename(p) }}>✎</span>
                <span title={t('删除项目')} onClick={(e) => { e.stopPropagation(); void handleDelete(p) }}>✕</span>
              </span>
            </div>
            <div className="proj-name">
              <FolderIcon className="h-3.5 w-3.5" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="cnt">{t('{n} 个 PSD', { n: p.psds.length })}</span>
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && (
        <div className="art-empty">
          <div className="empty-stack"><i /><i /></div>
          <h4>{q ? t('没有匹配的项目') : t('还没有项目')}</h4>
          <p>{t('点击右上角「新建项目」开始')}</p>
        </div>
      )}
    </main>
  )
}
