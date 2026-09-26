import { useMemo, useRef, useState, type ReactNode } from 'react'
import ShortcutsPanel from '@/components/ShortcutsPanel'
import AppLogo from '@/components/AppLogo'
import ChangelogPage from '@/pages/ChangelogPage'
import {
  CUSTOM_ID,
  THEMES,
  isHex,
  loadCustomTheme,
  saveCustomTheme,
  type CustomTheme
} from '@/lib/themes'
import { RELEASES } from '@/lib/changelog'
import { FONT_SIZES, type FontSizeId } from '@/lib/uiFont'
import {
  FontIcon,
  HistoryIcon,
  InfoIcon,
  KeyboardIcon,
  PaletteIcon,
  SearchIcon,
  SunIcon
} from '@/components/icons'

interface Props {
  theme: string
  onThemeChange: (id: string) => void
  fontSize: FontSizeId
  onFontSizeChange: (id: FontSizeId) => void
}

type SectionId = 'appearance' | 'themes' | 'fontsize' | 'about' | 'shortcuts' | 'changelog'

const NAV: {
  group: string
  items: { id: SectionId; label: string; Icon: (p: { className?: string }) => ReactNode }[]
}[] = [
  {
    group: '通用',
    items: [
      { id: 'appearance', label: '外观', Icon: SunIcon },
      { id: 'themes', label: '主题', Icon: PaletteIcon }
    ]
  },
  {
    group: '字体',
    items: [{ id: 'fontsize', label: '字体大小', Icon: FontIcon }]
  },
  {
    group: '快捷键',
    items: [{ id: 'shortcuts', label: '快捷键设置', Icon: KeyboardIcon }]
  },
  {
    group: '更新日志',
    items: [{ id: 'changelog', label: '更新日志', Icon: HistoryIcon }]
  },
  {
    group: '关于',
    items: [{ id: 'about', label: '关于轻切', Icon: InfoIcon }]
  }
]

const NEW_THEME_DRAFT: CustomTheme = {
  name: '我的主题',
  base: 'light',
  bg: '#f3f5f9',
  panel: '#ffffff',
  txt: '#1f2430',
  accent: '#4c7bf3'
}

const COLOR_FIELDS: { key: 'bg' | 'panel' | 'txt' | 'accent'; label: string }[] = [
  { key: 'bg', label: '背景色' },
  { key: 'panel', label: '面板色' },
  { key: 'txt', label: '文字色' },
  { key: 'accent', label: '主色' }
]

function ThemePreview({ bg, panel, accent }: { bg: string; panel: string; accent: string }) {
  return (
    <div className="th-prev" style={{ background: bg }}>
      <div className="th-bar" style={{ background: panel }}>
        <i style={{ background: accent }} />
        <i style={{ background: accent, opacity: 0.45 }} />
      </div>
      <div className="th-body" style={{ background: panel }}>
        <span style={{ background: accent }} />
        <span style={{ background: accent, opacity: 0.35 }} />
      </div>
    </div>
  )
}

export default function SettingsPage({ theme, onThemeChange, fontSize, onFontSizeChange }: Props) {
  const [active, setActive] = useState<SectionId>('appearance')
  const [pending, setPending] = useState<SectionId | null>(null)
  const swapTimer = useRef<number>(0)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState<CustomTheme | null>(() => loadCustomTheme())
  const [draft, setDraft] = useState<CustomTheme | null>(null)

  const shown = pending ?? active

  const switchTo = (id: SectionId) => {
    if (id === active && !pending) return
    window.clearTimeout(swapTimer.current)
    setPending(id)
    swapTimer.current = window.setTimeout(() => {
      setActive(id)
      setPending(null)
    }, 130)
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return NAV
    return NAV
      .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length)
  }, [query])

  const draftValid = !!draft && COLOR_FIELDS.every((f) => isHex(draft[f.key]))

  const saveDraft = () => {
    if (!draft || !draftValid) return
    const t: CustomTheme = { ...draft, name: draft.name.trim() || '我的主题' }
    saveCustomTheme(t)
    setCustom(t)
    setDraft(null)
    onThemeChange(CUSTOM_ID)
  }

  const removeCustom = () => {
    saveCustomTheme(null)
    setCustom(null)
    setDraft(null)
    if (theme === CUSTOM_ID) onThemeChange('light')
  }

  return (
    <div className="set-wrap">
      <aside className="set-nav">
        <div className="set-search">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-txt-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索设置…"
          />
        </div>
        <div className="set-nav-scroll">
          {groups.map((g) => (
            <section key={g.group}>
              <h5>{g.group}</h5>
              {g.items.map((i) => (
                <div
                  key={i.id}
                  className={`set-item${i.id === shown ? ' on' : ''}`}
                  onClick={() => switchTo(i.id)}
                >
                  <i.Icon className="h-3.5 w-3.5" />
                  {i.label}
                </div>
              ))}
            </section>
          ))}
          {!groups.length && <p className="set-empty">没有匹配的设置</p>}
        </div>
      </aside>
      <main className="set-main">
        <div key={active} className={`set-pane${pending ? ' out' : ''}`}>
        {active === 'appearance' && (
          <div className="set-sec">
            <h4>外观</h4>
            <p className="set-desc">快速切换明暗，立即生效；更多配色见「主题」</p>
            <div className="set-cards">
              <div className={`set-card${theme === 'light' ? ' on' : ''}`} onClick={() => onThemeChange('light')}>
                <div className="prev prev-light">
                  <i /><i /><i />
                </div>
                <span>亮色</span>
              </div>
              <div className={`set-card${theme === 'dark' ? ' on' : ''}`} onClick={() => onThemeChange('dark')}>
                <div className="prev prev-dark">
                  <i /><i /><i />
                </div>
                <span>暗色</span>
              </div>
            </div>
          </div>
        )}
        {active === 'themes' && (
          <div className="set-sec set-sec-wide">
            <h4>主题</h4>
            <p className="set-desc">全局配色方案，点击即切换，重启后保持</p>
            <div className="theme-grid">
              {THEMES.map((t) => (
                <div
                  key={t.id}
                  className={`theme-card${theme === t.id ? ' on' : ''}`}
                  onClick={() => {
                    setDraft(null)
                    onThemeChange(t.id)
                  }}
                >
                  <ThemePreview bg={t.preview[0]} panel={t.preview[1]} accent={t.preview[2]} />
                  <div className="th-meta">
                    <span className="th-name">{t.name}</span>
                    <span className="th-desc">{t.desc}</span>
                  </div>
                  {theme === t.id && <span className="th-check">✓</span>}
                </div>
              ))}
              {custom ? (
                <div
                  className={`theme-card${theme === CUSTOM_ID ? ' on' : ''}`}
                  onClick={() => onThemeChange(CUSTOM_ID)}
                >
                  <ThemePreview bg={custom.bg} panel={custom.panel} accent={custom.accent} />
                  <div className="th-meta">
                    <span className="th-name">{custom.name}</span>
                    <span className="th-desc">自定义 · {custom.base === 'dark' ? '暗色' : '亮色'}</span>
                  </div>
                  {theme === CUSTOM_ID && <span className="th-check">✓</span>}
                  <button
                    className="th-edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraft(custom)
                    }}
                  >
                    编辑
                  </button>
                </div>
              ) : (
                <div className="theme-card th-dashed" onClick={() => setDraft({ ...NEW_THEME_DRAFT })}>
                  <span>＋ 自定义主题</span>
                </div>
              )}
            </div>
            {draft && (
              <div className="ct-editor pop-in">
                <div className="ct-row ct-row-top">
                  <label className="ct-name">
                    <span>名称</span>
                    <input
                      value={draft.name}
                      maxLength={12}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <div className="ct-base">
                    <span>基准</span>
                    {(['light', 'dark'] as const).map((b) => (
                      <button
                        key={b}
                        className={draft.base === b ? 'on' : ''}
                        onClick={() => setDraft({ ...draft, base: b })}
                      >
                        {b === 'light' ? '亮色' : '暗色'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ct-colors">
                  {COLOR_FIELDS.map((f) => (
                    <label key={f.key} className={`ct-color${isHex(draft[f.key]) ? '' : ' ct-bad'}`}>
                      <input
                        type="color"
                        value={isHex(draft[f.key]) ? draft[f.key] : '#000000'}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                      <span className="ct-field">
                        <b>{f.label}</b>
                        <input
                          value={draft[f.key]}
                          spellCheck={false}
                          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        />
                      </span>
                    </label>
                  ))}
                </div>
                <div className="ct-preview">
                  <ThemePreview bg={draft.bg} panel={draft.panel} accent={draft.accent} />
                  {!draftValid && <span className="ct-warn">色值需为 #rrggbb 十六进制格式</span>}
                </div>
                <div className="ct-foot">
                  <button className="btn btn-primary" disabled={!draftValid} onClick={saveDraft}>
                    保存并应用
                  </button>
                  <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                    取消
                  </button>
                  {custom && (
                    <button className="btn btn-ghost ct-del" onClick={removeCustom}>
                      删除自定义
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {active === 'fontsize' && (
          <div className="set-sec">
            <h4>字体大小</h4>
            <p className="set-desc">界面整体等比缩放，立即生效，重启后保持</p>
            <div className="fs-list">
              {FONT_SIZES.map((f) => (
                <div
                  key={f.id}
                  className={`fs-row${fontSize === f.id ? ' on' : ''}`}
                  onClick={() => onFontSizeChange(f.id)}
                >
                  <span className="fs-sample" style={{ fontSize: `${12.5 * f.zoom}px` }}>
                    轻切 Aa
                  </span>
                  <span className="fs-meta">
                    <b>{f.name}</b>
                    <i>{f.desc}</i>
                  </span>
                  {fontSize === f.id && <span className="fs-check">✓</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {active === 'about' && (
          <div className="about-main">
            <header className="ab-hero">
              <div className="ah-logo">
                <AppLogo size={40} />
              </div>
              <div>
                <div className="ab-title-row">
                  <h3>轻切</h3>
                  <span className="ab-ver">v{RELEASES[0]?.version?.replace(/^v/i, '') ?? 'dev'}</span>
                </div>
                <p className="ab-tag">本地 PSD 切图工具 · 完全离线</p>
              </div>
            </header>
            <p className="ab-desc">
              直接读取 Photoshop 设计稿，图层树浏览、画布预览与导出与 PS 逐像素对齐；
              按图层 / 切片批量导出多格式多倍图。设计稿只记录路径、不会被移动或上传，全部处理发生在本机。
            </p>
            <div className="ab-cards">
              <section className="ab-card">
                <h5>核心能力</h5>
                <ul>
                  <li>项目 / PSD 两级管理，缩略图缓存秒开列表</li>
                  <li>自研合成器：显隐、蒙版、图层样式与 Photoshop 对齐</li>
                  <li>PNG · JPEG · WebP 与 @1x/@2x/@3x 批量导出</li>
                  <li>MasterGo 式画布：空格抓手、Ctrl+滚轮缩放、S 切片</li>
                  <li>快捷键自由改绑，切片命名 / 持久化 / 撤销</li>
                </ul>
              </section>
              <section className="ab-card">
                <h5>数据与隐私</h5>
                <dl className="ab-kv">
                  <dt>项目与缓存</dt>
                  <dd>%APPDATA%/qingqie</dd>
                  <dt>偏好设置</dt>
                  <dd>本机渲染层存储（主题 / 快捷键）</dd>
                  <dt>网络</dt>
                  <dd>完全离线，不联网、不上传</dd>
                </dl>
              </section>
            </div>
          </div>
        )}
        {active === 'changelog' && <ChangelogPage />}
        {active === 'shortcuts' && (
          <div className="set-sec set-sec-wide">
            <h4>快捷键设置</h4>
            <p className="set-desc">
              点击键帽后按下新组合即可改绑，自动提示冲突；单条 ↺ 恢复，或全部恢复默认。自定义仅保存在本机。
            </p>
            <ShortcutsPanel />
          </div>
        )}
        </div>
      </main>
    </div>
  )
}
