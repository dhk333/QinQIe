import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@/types'
import { createProject, genId, loadProjectsData, saveProjectsData } from '@/lib/projects'
import { useDialog, useToast } from '@/lib/ui'
import { useHashRoute, navigate } from '@/lib/router'
import { applyTheme, loadTheme } from '@/lib/themes'
import { applyFontSize, loadFontSize, type FontSizeId } from '@/lib/uiFont'
import HomePage from '@/pages/HomePage'
import ProjectPage from '@/pages/ProjectPage'
import DetailPage from '@/pages/DetailPage'
import ChangelogPage from '@/pages/ChangelogPage'
import SettingsPage from '@/pages/SettingsPage'
import ShortcutsOverlay from '@/components/ShortcutsOverlay'
import AppLogo from '@/components/AppLogo'
import { BackIcon, CaretDownIcon, GearIcon, PlusIcon, UploadIcon } from '@/components/icons'

export default function App() {
  const hash = useHashRoute()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [theme, setTheme] = useState<string>(loadTheme)
  const [fontSize, setFontSize] = useState<FontSizeId>(loadFontSize)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [settingsFrom, setSettingsFrom] = useState('#/home')
  const dialog = useDialog()
  const toast = useToast()
  const uploadRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    applyFontSize(fontSize)
  }, [fontSize])

  useEffect(() => {
    const toggle = () => setShortcutsOpen((v) => !v)
    window.addEventListener('qingqie:shortcuts', toggle)
    return () => window.removeEventListener('qingqie:shortcuts', toggle)
  }, [])

  useEffect(() => {
    loadProjectsData().then(setProjects)
  }, [])

  const persist = useCallback((mutate: (list: Project[]) => void) => {
    setProjects((prev) => {
      if (!prev) return prev
      mutate(prev)
      saveProjectsData(prev)
      return [...prev]
    })
  }, [])

  const updateProject = useCallback(
    (id: string, mutate: (p: Project) => void) => {
      persist((list) => {
        const p = list.find((x) => x.id === id)
        if (p) mutate(p)
      })
    },
    [persist]
  )

  const route = hash.startsWith('#/project/')
    ? ({ name: 'project', id: hash.slice(10) } as const)
    : hash.startsWith('#/detail/')
      ? (() => {
          const [projectId, psdId] = hash.slice(9).split('/')
          return { name: 'detail', id: projectId, psdId } as const
        })()
      : hash === '#/changelog'
        ? ({ name: 'changelog' } as const)
        : hash === '#/settings'
          ? ({ name: 'settings' } as const)
          : ({ name: 'home' } as const)

  const currentProject =
    (route.name === 'project' || route.name === 'detail') && projects
      ? projects.find((p) => p.id === route.id) ?? null
      : null
  const detailPsd =
    route.name === 'detail' && currentProject
      ? currentProject.psds.find((s) => s.id === route.psdId) ?? null
      : null

  const handleCreateProject = async () => {
    const name = await dialog({
      type: 'prompt',
      title: '新建项目',
      desc: '项目用于归类同一批设计稿，PSD 文件只记录路径、不会被移动',
      placeholder: '项目名称，例如：沃尔核材官网',
      okText: '创建'
    })
    if (!name || typeof name !== 'string') return
    const p = createProject(name)
    persist((list) => list.unshift(p))
    toast(`已创建项目「${name}」`)
    navigate(`#/project/${p.id}`)
  }

  const handleUpload = () => {
    if (!uploadRef.current) return
    uploadRef.current()
  }

  const loading = projects === null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="g-topbar">
        <div className="brand">
          {route.name !== 'home' && (
            <span
              className="back-btn"
              title="返回"
              onClick={() => {
                if (route.name === 'changelog') navigate('#/settings')
                else if (route.name === 'settings') navigate(settingsFrom)
                else if (route.name === 'detail' && currentProject) navigate(`#/project/${currentProject.id}`)
                else navigate('#/home')
              }}
            >
              <BackIcon />
            </span>
          )}
          <div className="logo">
            <AppLogo size={25} />
          </div>
          <span className="name">轻切</span>
        </div>

        {route.name === 'project' && currentProject && (
          <span className="pname-wrap" style={{ position: 'relative' }}>
            <span
              className="pname"
              onClick={(e) => {
                e.stopPropagation()
                setProjectMenuOpen((v) => !v)
              }}
            >
              {currentProject.name}
              <CaretDownIcon className="h-3 w-3" />
            </span>
            <span
              className={`proj-menu${projectMenuOpen ? ' open' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {projects!.map((p) => (
                <span
                  key={p.id}
                  className={`item${p.id === currentProject.id ? ' on' : ''}`}
                  onClick={() => {
                    setProjectMenuOpen(false)
                    if (p.id !== currentProject.id) navigate(`#/project/${p.id}`)
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 13, height: 13, flexShrink: 0 }}>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                  </svg>
                  {p.name}
                  <span className="n-cnt">{p.psds.length} PSD</span>
                </span>
              ))}
            </span>
          </span>
        )}

        {route.name === 'detail' && detailPsd && currentProject && (
          <div className="file-chip">
            <span className="crumb"><b>{currentProject.name}</b> /</span>
            <span className="path">{detailPsd.name}.psd</span>
            {detailPsd.w > 0 && (
              <span style={{ color: 'var(--txt-3)', fontFamily: 'Consolas, monospace', fontSize: 10 }}>
                {detailPsd.w} × {detailPsd.h}
              </span>
            )}
          </div>
        )}

        <span className="g-spacer" />

        {route.name === 'home' && (
          <>
            <div className="tb-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ width: 13, height: 13, color: 'var(--txt-3)' }}>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目…"
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreateProject}>
              <PlusIcon />
              新建项目
            </button>
          </>
        )}

        {route.name === 'project' && currentProject && (
          <button className="btn btn-primary" onClick={handleUpload}>
            <UploadIcon />
            上传 PSD
          </button>
        )}

        <button
          className="theme-toggle"
          title="设置"
          onClick={() => {
            setSettingsFrom(hash === '#/settings' ? '#/home' : hash)
            navigate('#/settings')
          }}
        >
          <GearIcon />
        </button>

        <div className="win-controls">
          <span className="win-btn" title="最小化" onClick={() => window.api.winMinimize()}>
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M0 5h10" /></svg>
          </span>
          <span className="win-btn" title="最大化 / 还原" onClick={() => window.api.winMaximize()}>
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
          </span>
          <span className="win-btn close" title="关闭" onClick={() => window.api.winClose()}>
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M0 0l10 10M10 0L0 10" /></svg>
          </span>
        </div>
      </header>

      {loading ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--txt-3)', fontSize: 13 }}>
          加载中…
        </div>
      ) : (
        <div className="page page-enter" key={hash} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {route.name === 'home' && (
            <HomePage
              projects={projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))}
              onOpen={(id) => navigate(`#/project/${id}`)}
              onCreate={handleCreateProject}
              onRename={(id, name) => {
                persist((list) => {
                  const p = list.find((x) => x.id === id)
                  if (p) p.name = name
                })
              }}
              onDelete={(id) => {
                persist((list) => list.filter((x) => x.id !== id))
              }}
            />
          )}
          {route.name === 'project' && currentProject && (
            <ProjectPage
              project={currentProject}
              onUpdate={(mutate) => updateProject(currentProject.id, mutate)}
              onOpenPsd={(psd) => navigate(`#/detail/${currentProject.id}/${psd.id}`)}
              registerUpload={(fn) => {
                uploadRef.current = fn
              }}
            />
          )}
          {route.name === 'detail' && currentProject && detailPsd && (
            <DetailPage
              project={currentProject}
              psd={detailPsd}
              onUpdatePsd={(mutate) =>
                updateProject(currentProject.id, (p) => {
                  const s = p.psds.find((x) => x.id === detailPsd.id)
                  if (s) mutate(s)
                })
              }
              onBack={() => navigate(`#/project/${currentProject.id}`)}
            />
          )}
          {route.name === 'changelog' && <ChangelogPage />}
          {route.name === 'settings' && (
            <SettingsPage
              theme={theme}
              onThemeChange={setTheme}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
            />
          )}
          {route.name === 'project' && !currentProject && (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--txt-3)' }}>项目不存在</div>
          )}
        </div>
      )}

      {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}
