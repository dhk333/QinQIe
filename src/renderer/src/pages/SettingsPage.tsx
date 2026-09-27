import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ShortcutsPanel from '@/components/ShortcutsPanel'
import AppLogo from '@/components/AppLogo'
import Slider from '@/components/Slider'
import ChangelogPage from '@/pages/ChangelogPage'
import { useDialog, useToast } from '@/lib/ui'
import { DEFAULT_TEMPLATE, loadExportPrefs, saveExportPrefs, type ExportPrefs } from '@/lib/exportPrefs'
import {
  CUSTOM_ID,
  THEMES,
  isHex,
  loadCustomTheme,
  saveCustomTheme,
  type CustomTheme
} from '@/lib/themes'
import { RELEASES } from '@/lib/changelog'
import { startOnboarding } from '@/lib/onboarding'
import { FONT_SIZES, type FontSizeId } from '@/lib/uiFont'
import { useT, getLang, setLang, LANGS } from '@/i18n/core'
import { setUiPrefs, useUiPrefs } from '@/lib/uiPrefs'
import type { CssUnit } from '@/lib/cssUnits'
import {
  DownloadIcon,
  FontIcon,
  FolderIcon,
  GlobeIcon,
  HistoryIcon,
  InfoIcon,
  KeyboardIcon,
  MoveIcon,
  OpenIcon,
  PaletteIcon,
  SearchIcon
} from '@/components/icons'

interface Props {
  theme: string
  onThemeChange: (id: string) => void
  fontSize: FontSizeId
  onFontSizeChange: (id: FontSizeId) => void
}

type SectionId =
  | 'themes'
  | 'language'
  | 'storage'
  | 'export'
  | 'fontsize'
  | 'about'
  | 'shortcuts'
  | 'changelog'
  | 'startup'
  | 'canvas'

const NAV: {
  group: string
  items: {
    id: SectionId
    label: string
    Icon: (p: { className?: string }) => ReactNode
    keywords?: string
  }[]
}[] = [
  {
    group: '通用',
    items: [
      { id: 'themes', label: '主题', Icon: PaletteIcon, keywords: '亮色 暗色 明暗 配色 自定义 晴空 墨夜 青瓷 暖沙 绛紫 松墨' },
      { id: 'language', label: '语言', Icon: GlobeIcon, keywords: 'Language 简体 繁体 English 繁體' },
      { id: 'fontsize', label: '字体大小', Icon: FontIcon, keywords: '缩放 显示 大小' },
      { id: 'export', label: '导出设置', Icon: DownloadIcon, keywords: '格式 倍数 质量 png jpg webp 默认 命名 模板' },
      { id: 'startup', label: '启动与更新', Icon: OpenIcon, keywords: '开机 上次 打开 恢复 检查更新 自动' }
    ]
  },
  {
    group: '效率',
    items: [
      { id: 'shortcuts', label: '快捷键', Icon: KeyboardIcon, keywords: '改绑 键位 命令 恢复默认' },
      { id: 'canvas', label: '画布与测量', Icon: MoveIcon, keywords: '悬停 测距 间距 缩放 位置 视口' }
    ]
  },
  {
    group: '关于',
    items: [
      { id: 'storage', label: '存储与缓存', Icon: FolderIcon, keywords: '数据目录 容量 缩略图 清理 隐私 离线' },
      { id: 'changelog', label: '版本记录', Icon: HistoryIcon, keywords: '更新日志 版本 发布' },
      { id: 'about', label: '关于轻切', Icon: InfoIcon, keywords: '介绍 项目 版本 新手引导 教程 重放' }
    ]
  }
]

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 缩略图缓存档位（MB），0 = 不限制 */
const THUMB_CAPS = [0, 128, 256, 512, 1024]

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

/** 关键词是中文原文，非简中界面下不展示；简中下只露前 3 个，长串会压垮 220px 导航 */
function kwPreview(keywords: string, zh: boolean): string {
  if (!zh) return ''
  const words = keywords.split(/\s+/).filter(Boolean)
  const head = words.slice(0, 3).join(' · ')
  return words.length > 3 ? `${head} +${words.length - 3}` : head
}

function Toggle({
  name,
  desc,
  on,
  onChange
}: {
  name: string
  desc: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="so-row">
      <span className="so-main">
        <span className="so-name">{name}</span>
        <span className="so-desc">{desc}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`sw-btn${on ? ' on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <i />
      </button>
    </div>
  )
}

export default function SettingsPage({ theme, onThemeChange, fontSize, onFontSizeChange }: Props) {
  const t = useT()
  const lang = getLang()
  const ui = useUiPrefs()
  const [active, setActive] = useState<SectionId>('themes')
  const [pending, setPending] = useState<SectionId | null>(null)
  const swapTimer = useRef<number>(0)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState<CustomTheme | null>(() => loadCustomTheme())
  const [draft, setDraft] = useState<CustomTheme | null>(null)
  const [prefs, setPrefs] = useState<ExportPrefs>(() => loadExportPrefs())
  const [stats, setStats] = useState<{ root: string; total: number; thumbs: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const dialog = useDialog()
  const toast = useToast()

  const shown = pending ?? active

  useEffect(() => {
    if (active === 'storage') window.api.dataStats().then(setStats).catch(() => setStats(null))
  }, [active])

  const setPref = (patch: Partial<ExportPrefs>) => {
    const next = { ...prefs, ...patch }
    if (!next.scales.length) return
    setPrefs(next)
    saveExportPrefs(next)
  }

  const clearThumbs = async () => {
    const ok = await dialog({
      type: 'confirm',
      title: t('清理缩略图缓存'),
      desc: t('删除后已导入画板的缩略图显示为占位图，重新导入 PSD 会再次生成。不影响 PSD 源文件与项目记录。'),
      okText: t('清理')
    })
    if (!ok) return
    const freed = await window.api.clearThumbCache()
    setStats(await window.api.dataStats())
    toast(t('已释放 {size}', { size: fmtBytes(freed) }))
  }

  // 选定档位立刻按新上限裁剪一次，用户当场能看到容量变化
  const applyThumbCap = async (mb: number) => {
    setUiPrefs({ thumbCapMB: mb })
    if (!mb) return
    const r = await window.api.trimThumbCache(mb * 1024 * 1024)
    setStats(await window.api.dataStats())
    if (r.deleted) toast(t('已按上限清理 {n} 个缩略图，释放 {size}', { n: r.deleted, size: fmtBytes(r.freed) }))
  }

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
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) =>
            t(i.label).toLowerCase().includes(q) ||
            i.label.toLowerCase().includes(q) ||
            (i.keywords ?? '').toLowerCase().includes(q)
        )
      }))
      .filter((g) => g.items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lang])

  const draftValid = !!draft && COLOR_FIELDS.every((f) => isHex(draft[f.key]))

  const saveDraft = () => {
    if (!draft || !draftValid) return
    const ct: CustomTheme = { ...draft, name: draft.name.trim() || t('我的主题') }
    saveCustomTheme(ct)
    setCustom(ct)
    setDraft(null)
    onThemeChange(CUSTOM_ID)
  }

  const removeCustom = () => {
    saveCustomTheme(null)
    setCustom(null)
    setDraft(null)
    if (theme === CUSTOM_ID) onThemeChange('light')
  }

  const checkNow = async () => {
    if (checking) return
    setChecking(true)
    try {
      const r = await window.api.checkUpdate()
      if (r.status === 'new') {
        const go = await dialog({
          type: 'confirm',
          title: t('发现新版本 v{version}', { version: r.version }),
          desc: r.notes || t('前往 GitHub 下载页获取最新版本。'),
          okText: t('去下载')
        })
        if (go) window.open(r.url)
      } else if (r.status === 'latest') {
        toast(t('已是最新版本 v{version}', { version: RELEASES[0]?.version?.replace(/^v/i, '') ?? 'dev' }))
      } else {
        toast(t('检查更新失败，请检查网络后重试'), 'error')
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div id="page-settings" className="flex flex-1 min-h-0">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-panel">
        <div className="set-search">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-txt-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('搜索设置…')}
          />
        </div>
        <div className="set-nav-scroll">
          {groups.map((g) => (
            <section key={g.group}>
              <h5>{t(g.group)}</h5>
              {g.items.map((i) => (
                <div
                  key={i.id}
                  className={`set-item${i.id === shown ? ' on' : ''}`}
                  onClick={() => switchTo(i.id)}
                >
                  <i.Icon className="h-3.5 w-3.5" />
                  <span className="flex min-w-0 flex-col gap-px">
                    {t(i.label)}
                    {query.trim() && i.keywords && (
                      <small className="overflow-hidden text-ellipsis text-[10px] font-normal whitespace-nowrap text-txt-3">
                        {kwPreview(i.keywords, lang === 'zh-CN')}
                      </small>
                    )}
                  </span>
                </div>
              ))}
            </section>
          ))}
          {!groups.length && <p className="px-[10px] py-4 text-center text-[12px] text-txt-3">{t('没有匹配的设置')}</p>}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-bg">
        <div key={active} className={`set-pane${pending ? ' out' : ''}`}>
        {active === 'themes' && (
          <div className="set-sec set-sec-wide">
            <h4>{t('主题')}</h4>
            <p className="m-0 mb-[18px] text-[12px] leading-[1.6] text-txt-3">{t('全局配色方案（含明暗），点击即切换，重启后保持')}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-[14px]">
              {THEMES.map((th) => (
                <div
                  key={th.id}
                  className={`theme-card${theme === th.id ? ' on' : ''}`}
                  onClick={() => {
                    setDraft(null)
                    onThemeChange(th.id)
                  }}
                >
                  <ThemePreview bg={th.preview[0]} panel={th.preview[1]} accent={th.preview[2]} />
                  <div className="mt-2 flex flex-col gap-px">
                    <span className="text-[12.5px] font-medium text-txt">{t(th.name)}</span>
                    <span className="text-[10.5px] text-txt-3">{t(th.desc)}</span>
                  </div>
                  {theme === th.id && (
                    <span className="absolute right-[6px] top-[6px] grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[11px] text-white">
                      ✓
                    </span>
                  )}
                </div>
              ))}
              {custom ? (
                <div
                  className={`theme-card${theme === CUSTOM_ID ? ' on' : ''}`}
                  onClick={() => onThemeChange(CUSTOM_ID)}
                >
                  <ThemePreview bg={custom.bg} panel={custom.panel} accent={custom.accent} />
                  <div className="mt-2 flex flex-col gap-px">
                    <span className="text-[12.5px] font-medium text-txt">{custom.name}</span>
                    <span className="text-[10.5px] text-txt-3">{t('自定义')} · {custom.base === 'dark' ? t('暗色') : t('亮色')}</span>
                  </div>
                  {theme === CUSTOM_ID && (
                    <span className="absolute right-[6px] top-[6px] grid h-[18px] w-[18px] place-items-center rounded-full bg-accent text-[11px] text-white">
                      ✓
                    </span>
                  )}
                  <button
                    className="th-edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraft(custom)
                    }}
                  >
                    {t('编辑')}
                  </button>
                </div>
              ) : (
                <div className="theme-card th-dashed" onClick={() => setDraft({ ...NEW_THEME_DRAFT })}>
                  <span>{t('＋ 自定义主题')}</span>
                </div>
              )}
            </div>
            {draft && (
              <div className="ct-editor pop-in">
                <div className="ct-row ct-row-top">
                  <label className="ct-name">
                    <span>{t('名称')}</span>
                    <input
                      value={draft.name}
                      maxLength={12}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <div className="ct-base">
                    <span>{t('基准')}</span>
                    {(['light', 'dark'] as const).map((b) => (
                      <button
                        key={b}
                        className={draft.base === b ? 'on' : ''}
                        onClick={() => setDraft({ ...draft, base: b })}
                      >
                        {b === 'light' ? t('亮色') : t('暗色')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {COLOR_FIELDS.map((f) => (
                    <label key={f.key} className={`ct-color${isHex(draft[f.key]) ? '' : ' ct-bad'}`}>
                      <input
                        type="color"
                        value={isHex(draft[f.key]) ? draft[f.key] : '#000000'}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                      <span className="ct-field">
                        <b>{t(f.label)}</b>
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
                  {!draftValid && <span className="text-[11px] text-[#ef4444]">{t('色值需为 #rrggbb 十六进制格式')}</span>}
                </div>
                <div className="mt-4 flex gap-[10px]">
                  <button className="btn btn-primary" disabled={!draftValid} onClick={saveDraft}>
                    {t('保存并应用')}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                    {t('取消')}
                  </button>
                  {custom && (
                    <button className="btn btn-ghost ct-del" onClick={removeCustom}>
                      {t('删除自定义')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {active === 'storage' && (
          <div className="set-sec">
            <h4>{t('存储与缓存')}</h4>
            <p className="m-0 mb-[18px] text-[12px] leading-[1.6] text-txt-3">{t('所有数据只保存在本机用户目录，不联网、不上传')}</p>
            <dl className="ab-kv st-kv">
              <dt>{t('数据目录')}</dt>
              <dd>{stats?.root ?? t('读取中…')}</dd>
              <dt>{t('总占用')}</dt>
              <dd>{stats ? fmtBytes(stats.total) : '—'}</dd>
              <dt>{t('缩略图缓存')}</dt>
              <dd>{stats ? t('{size}（重新导入 PSD 会再生成）', { size: fmtBytes(stats.thumbs) }) : '—'}</dd>
              <dt>{t('偏好设置')}</dt>
              <dd>{t('主题 / 字体 / 快捷键 / 导出默认，存于本机渲染层存储')}</dd>
            </dl>
            <div className="m-0 mt-4 flex gap-[10px]">
              <button className="btn btn-secondary" onClick={() => window.api.openDataDir()}>
                <FolderIcon className="h-3.5 w-3.5" />
                {t('打开数据目录')}
              </button>
              <button className="btn btn-secondary" onClick={() => void clearThumbs()}>
                <DownloadIcon className="h-3.5 w-3.5" />
                {t('清理缩略图缓存')}
              </button>
            </div>
            <div className="mt-[22px] mb-[14px] flex items-center gap-4">
              <span className="w-20 shrink-0 text-[12px] text-txt-2">{t('缓存上限')}</span>
              <div className="es-seg">
                {THUMB_CAPS.map((mb) => (
                  <button
                    key={mb}
                    className={ui.thumbCapMB === mb ? 'on' : ''}
                    onClick={() => void applyThumbCap(mb)}
                  >
                    {mb ? `${mb} MB` : t('不限制')}
                  </button>
                ))}
              </div>
            </div>
            <p className="es-note leading-[1.6] text-txt-3">
              {t('超出上限时，导入新 PSD 后自动删除最久未用的缩略图。缩略图只是列表预览，删掉不影响 PSD 源文件，重新导入即可再生成。')}
            </p>
          </div>
        )}
        {active === 'export' && (
          <div className="set-sec">
            <h4>{t('导出设置')}</h4>
            <p className="m-0 mb-[18px] text-[12px] leading-[1.6] text-txt-3">{t('详情页导出面板的默认值，修改后立即保存、重启后保持')}</p>
            <div className="mb-[14px] flex items-center gap-4">
              <span className="w-16 shrink-0 text-[12px] text-txt-2">{t('默认格式')}</span>
              <div className="es-seg">
                {([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']] as const).map(([f, label]) => (
                  <button key={f} className={prefs.format === f ? 'on' : ''} onClick={() => setPref({ format: f })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-[14px] flex items-center gap-4">
              <span className="w-16 shrink-0 text-[12px] text-txt-2">{t('默认倍数')}</span>
              <div className="es-seg">
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    className={prefs.scales.length === 1 && prefs.scales[0] === s ? 'on' : ''}
                    onClick={() => setPref({ scales: [s] })}
                  >
                    @{s}x
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-[14px] flex items-center gap-4">
              <span className="w-16 shrink-0 text-[12px] text-txt-2">{t('默认质量')}</span>
              <div className="es-q">
                <Slider
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={prefs.quality}
                  disabled={prefs.format === 'png'}
                  onChange={(q) => setPref({ quality: q })}
                />
                <b>{Math.round(prefs.quality * 100)}%</b>
              </div>
            </div>
            {prefs.format === 'png' && <p className="es-note leading-[1.6] text-txt-3">{t('PNG 为无损格式，质量设置仅在 JPG / WebP 时生效')}</p>}
            <div className="mt-[18px] mb-[14px] flex items-center gap-4">
              <span className="w-16 shrink-0 text-[12px] text-txt-2">{t('命名模板')}</span>
              <input
                className="so-input so-tpl"
                value={prefs.template}
                spellCheck={false}
                placeholder={DEFAULT_TEMPLATE}
                onChange={(e) => setPref({ template: e.target.value })}
                onBlur={(e) => {
                  if (!e.target.value.trim()) setPref({ template: DEFAULT_TEMPLATE })
                }}
              />
            </div>
            <p className="es-note leading-[1.6] text-txt-3">
              {t('变量：{名称} 图层或切片名 · {倍数} @2x 中的 2 · {格式} png / jpg / webp · {序号} 批量内递增')}
            </p>
            <div className="mt-[18px] mb-[14px] flex items-center gap-4">
              <span className="w-16 shrink-0 text-[12px] text-txt-2">{t('CSS 单位')}</span>
              <div className="es-seg">
                {(['px', 'rem', 'vw'] as CssUnit[]).map((u) => (
                  <button
                    key={u}
                    className={ui.cssUnits.unit === u ? 'on' : ''}
                    onClick={() => setUiPrefs({ cssUnits: { ...ui.cssUnits, unit: u } })}
                  >
                    {u}
                  </button>
                ))}
              </div>
              {ui.cssUnits.unit !== 'px' && (
                <label className="flex items-center gap-2 text-[12px] text-txt-2">
                  {ui.cssUnits.unit === 'rem' ? t('基准 px') : t('画布宽 px')}
                  <input
                    className="so-input so-num"
                    type="number"
                    min={1}
                    value={ui.cssUnits.unit === 'rem' ? ui.cssUnits.remBase : ui.cssUnits.vwBase}
                    onChange={(e) =>
                      setUiPrefs({
                        cssUnits:
                          ui.cssUnits.unit === 'rem'
                            ? { ...ui.cssUnits, remBase: Number(e.target.value) }
                            : { ...ui.cssUnits, vwBase: Number(e.target.value) }
                      })
                    }
                  />
                </label>
              )}
            </div>
            <p className="es-note leading-[1.6] text-txt-3">
              {t('详情页属性面板导出的 CSS 代码按此单位换算；vw 默认按当前画布宽度换算，画布未知时用上面的基准值')}
            </p>
          </div>
        )}
        {active === 'startup' && (
          <div className="set-sec">
            <h4>{t('启动与更新')}</h4>
            <p className="m-0 mb-[10px] text-[12px] leading-[1.6] text-txt-3">{t('开关改动立即保存，重启后保持')}</p>
            <Toggle
              name={t('启动时打开上次的 PSD')}
              desc={t('直接进入最后编辑的设计稿；关闭后启动停在项目页')}
              on={ui.lastPsdOnStartup}
              onChange={(v) => setUiPrefs({ lastPsdOnStartup: v })}
            />
            <Toggle
              name={t('自动检查更新')}
              desc={t('启动时静默查询一次 GitHub Releases，仅发现新版本才提示；关闭后可在「关于轻切」手动检查')}
              on={ui.autoUpdateCheck}
              onChange={(v) => setUiPrefs({ autoUpdateCheck: v })}
            />
          </div>
        )}
        {active === 'canvas' && (
          <div className="set-sec">
            <h4>{t('画布与测量')}</h4>
            <p className="m-0 mb-[10px] text-[12px] leading-[1.6] text-txt-3">{t('详情页画布的行为，改动立即生效')}</p>
            <Toggle
              name={t('悬停测距')}
              desc={t('选择工具下选中图层后，悬停其它图层显示 Figma 式的边缘间距')}
              on={ui.hoverMeasure}
              onChange={(v) => setUiPrefs({ hoverMeasure: v })}
            />
            <Toggle
              name={t('恢复上次缩放与位置')}
              desc={t('重新打开同一份 PSD 时回到上次的画布视口；关闭后每次适配整图')}
              on={ui.restoreViewport}
              onChange={(v) => setUiPrefs({ restoreViewport: v })}
            />
            <p className="es-note mt-3 leading-[1.6] text-txt-3">
              {t('导出 CSS 的长度单位在「导出设置」里选择。')}
            </p>
          </div>
        )}
        {active === 'language' && (
          <div className="set-sec">
            <h4>{t('语言')}</h4>
            <p className="m-0 mb-[18px] text-[12px] leading-[1.6] text-txt-3">{t('切换后立即生效，重启后保持')}</p>
            <div className="flex flex-col gap-[10px]">
              {LANGS.map((l) => (
                <div
                  key={l.id}
                  className={`fs-row${lang === l.id ? ' on' : ''}`}
                  onClick={() => setLang(l.id)}
                >
                  <span className="fs-meta" style={{ marginTop: 0 }}>
                    <b>{l.label}</b>
                  </span>
                  {lang === l.id && (
                    <span className="ml-auto grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent text-[11px] text-white">
                      ✓
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {active === 'fontsize' && (
          <div className="set-sec">
            <h4>{t('字体大小')}</h4>
            <p className="m-0 mb-[18px] text-[12px] leading-[1.6] text-txt-3">{t('界面整体等比缩放，立即生效，重启后保持')}</p>
            <div className="flex flex-col gap-[10px]">
              {FONT_SIZES.map((f) => (
                <div
                  key={f.id}
                  className={`fs-row${fontSize === f.id ? ' on' : ''}`}
                  onClick={() => onFontSizeChange(f.id)}
                >
                  <span className="w-[92px] shrink-0 font-medium text-txt" style={{ fontSize: `${12.5 * f.zoom}px` }}>
                    {t('轻切 Aa')}
                  </span>
                  <span className="fs-meta">
                    <b>{t(f.name)}</b>
                    <i>{t(f.desc)}</i>
                  </span>
                  {fontSize === f.id && (
                    <span className="ml-auto grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent text-[11px] text-white">
                      ✓
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {active === 'about' && (
          <div className="max-w-[880px] px-[34px] pb-[44px] pt-7">
            <header className="flex items-center gap-4">
              <div className="ah-logo">
                <AppLogo size={40} />
              </div>
              <div>
                <div className="ab-title-row">
                  <h3>{t('轻切')}</h3>
                  <span className="ab-ver">
                    v{RELEASES[0]?.version?.replace(/^v/i, '') ?? 'dev'}
                  </span>
                </div>
                <p className="m-0 mt-[5px] text-[12px] text-txt-3">{t('本地 PSD 切图工具 · 完全离线')}</p>
              </div>
            </header>
            <p className="m-0 mb-6 mt-[18px] max-w-[660px] select-text text-[12.5px] leading-[1.9] text-txt-2">
              {t('直接读取 Photoshop 设计稿，图层树浏览、画布预览与导出与 PS 逐像素对齐；按图层 / 切片批量导出多格式多倍图。设计稿只记录路径、不会被移动或上传，全部处理发生在本机。')}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[14px]">
              <section className="ab-card">
                <h5>{t('核心能力')}</h5>
                <ul>
                  <li>{t('项目 / PSD 两级管理，缩略图缓存秒开列表')}</li>
                  <li>{t('自研合成器：显隐、蒙版、图层样式与 Photoshop 对齐')}</li>
                  <li>{t('PNG · JPEG · WebP 与 @1x/@2x/@3x 批量导出')}</li>
                  <li>{t('MasterGo 式画布：空格抓手、Ctrl+滚轮缩放、S 切片')}</li>
                  <li>{t('快捷键自由改绑，切片命名 / 持久化 / 撤销')}</li>
                </ul>
              </section>
            </div>
            <div className="m-0 mt-4 flex items-center gap-[10px]">
              <button className="btn btn-secondary" disabled={checking} onClick={() => void checkNow()}>
                <DownloadIcon className="h-3.5 w-3.5" />
                {checking ? t('检查中…') : t('检查更新')}
              </button>
              <button className="btn btn-secondary" onClick={startOnboarding}>{t('重放新手引导')}</button>
            </div>
            <p className="m-0 mt-[14px] max-w-[660px] select-text text-[11.5px] leading-[1.9] text-txt-3">
              {t('数据与缓存管理见「设置 → 通用 → 存储与缓存」；全部处理发生在本机，不联网、不上传。')}
            </p>
          </div>
        )}
        {active === 'changelog' && <ChangelogPage />}
        {active === 'shortcuts' && (
          <div className="set-sec set-sec-wide">
            <h4>{t('快捷键')}</h4>
            <p className="m-0 mb-[18px] text-[12px] leading-[1.6] text-txt-3">
              {t('点击键帽后按下新组合即可改绑，自动提示冲突；单条 ↺ 恢复，或全部恢复默认。自定义仅保存在本机。')}
            </p>
            <ShortcutsPanel />
          </div>
        )}
        </div>
      </main>
    </div>
  )
}
