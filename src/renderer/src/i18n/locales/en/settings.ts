export default {
  // SettingsPage.tsx — 左侧导航（分组 / 条目，NAV 数据键）
  '通用': 'General',
  '效率': 'Efficiency',
  '快捷键': 'Shortcuts',
  '版本记录': 'Release Notes',
  '主题': 'Theme',
  '语言': 'Language',
  '存储与缓存': 'Storage & Cache',
  '导出设置': 'Export Settings',
  '字体': 'Font',
  '字体大小': 'Font Size',
  '快捷键设置': 'Shortcut Settings',
  '更新日志': 'Changelog',
  '关于': 'About',
  '关于轻切': 'About 轻切',
  // 搜索与空态
  '搜索设置…': 'Search settings…',
  '没有匹配的设置': 'No matching settings',
  // 主题分区
  '全局配色方案（含明暗），点击即切换，重启后保持': 'Global color scheme (light & dark). Click to switch; persists after restart',
  '亮色': 'Light',
  '暗色': 'Dark',
  '自定义': 'Custom',
  '＋ 自定义主题': '＋ Custom theme',
  '名称': 'Name',
  '基准': 'Base',
  '背景色': 'Background',
  '面板色': 'Panel',
  '文字色': 'Text',
  '主色': 'Accent',
  '色值需为 #rrggbb 十六进制格式': 'Colors must be #rrggbb hexadecimal',
  '保存并应用': 'Save & apply',
  '删除自定义': 'Delete custom',
  '我的主题': 'My theme',
  // 存储与缓存分区
  '所有数据只保存在本机用户目录，不联网、不上传': 'All data stays in your local user directory — no network, no uploads',
  '数据目录': 'Data directory',
  '读取中…': 'Reading…',
  '总占用': 'Total usage',
  '缩略图缓存': 'Thumbnail cache',
  '{size}（重新导入 PSD 会再生成）': '{size} (regenerated on PSD re-import)',
  '偏好设置': 'Preferences',
  '主题 / 字体 / 快捷键 / 导出默认，存于本机渲染层存储': 'Theme / font / shortcuts / export defaults, stored in local renderer storage',
  '打开数据目录': 'Open data directory',
  '清理缩略图缓存': 'Clear thumbnail cache',
  '删除后已导入画板的缩略图显示为占位图，重新导入 PSD 会再次生成。不影响 PSD 源文件与项目记录。': 'Thumbnails of imported artboards become placeholders; re-importing a PSD regenerates them. PSD source files and project records are unaffected.',
  '清理': 'Clear',
  '已释放 {size}': 'Freed {size}',
  // 导出设置分区
  '详情页导出面板的默认值，修改后立即保存、重启后保持': 'Defaults for the detail-page export panel. Saved instantly; persists after restart',
  '默认格式': 'Default format',
  '默认倍数': 'Default scale',
  '默认质量': 'Default quality',
  'PNG 为无损格式，质量设置仅在 JPG / WebP 时生效': 'PNG is lossless; the quality setting applies to JPG / WebP only',
  // 语言分区
  '界面语言': 'Interface language',
  '切换后立即生效，重启后保持': 'Takes effect immediately; persists after restart',
  // 字体大小分区
  '界面整体等比缩放，立即生效，重启后保持': 'Scales the whole UI proportionally; immediate and persistent',
  '轻切 Aa': '轻切 Aa',
  '小': 'Small',
  '默认，适合 1080P 及更小屏幕': 'Default, for 1080P and smaller screens',
  '中': 'Medium',
  '界面整体放大一档': 'One step larger overall',
  '大': 'Large',
  '高分屏或远距离阅读': 'For high-DPI screens or distance reading',
  // 关于分区
  '本地 PSD 切图工具 · 完全离线': 'Local PSD slicing tool · fully offline',
  '直接读取 Photoshop 设计稿，图层树浏览、画布预览与导出与 PS 逐像素对齐；按图层 / 切片批量导出多格式多倍图。设计稿只记录路径、不会被移动或上传，全部处理发生在本机。':
    'Reads Photoshop design files directly; layer tree, canvas preview and exports align pixel-perfectly with PS. Batch-export layers / slices in multiple formats and scales. Designs are referenced by path only — never moved or uploaded; everything runs on this machine.',
  '核心能力': 'Core capabilities',
  '项目 / PSD 两级管理，缩略图缓存秒开列表': 'Two-level Project / PSD management with thumbnail-cached lists',
  '自研合成器：显隐、蒙版、图层样式与 Photoshop 对齐': 'Custom compositor: visibility, masks and layer effects aligned with Photoshop',
  'PNG · JPEG · WebP 与 @1x/@2x/@3x 批量导出': 'PNG · JPEG · WebP batch export at @1x/@2x/@3x',
  'MasterGo 式画布：空格抓手、Ctrl+滚轮缩放、S 切片': 'MasterGo-style canvas: space to pan, Ctrl+wheel zoom, S to slice',
  '快捷键自由改绑，切片命名 / 持久化 / 撤销': 'Freely rebindable shortcuts; slice naming / persistence / undo',
  '数据与缓存管理见「设置 → 通用 → 存储与缓存」；全部处理发生在本机，不联网、不上传。':
    'Data & cache management lives in “Settings → General → Storage & Cache”; everything runs locally, no network or uploads.',
  // 检查更新
  '检查更新': 'Check for updates',
  '检查中…': 'Checking…',
  '发现新版本 v{version}': 'New version v{version} found',
  '前往 GitHub 下载页获取最新版本。': 'Get the latest version from the GitHub releases page.',
  '去下载': 'Download',
  '已是最新版本 v{version}': 'You’re on the latest version v{version}',
  '检查更新失败，请检查网络后重试': 'Update check failed — check your network and retry',
  // 快捷键分区
  '点击键帽后按下新组合即可改绑，自动提示冲突；单条 ↺ 恢复，或全部恢复默认。自定义仅保存在本机。':
    'Click a keycap, then press a new combination to rebind; conflicts are detected automatically. Use ↺ to reset one, or reset all to defaults. Customizations are stored locally only.',
  // 导出设置：命名模板与 CSS 单位（词条 '命名模板' / '可用变量：…' 见 detail.ts）
  '变量：{名称} 图层或切片名 · {倍数} @2x 中的 2 · {格式} png / jpg / webp · {序号} 批量内递增':
    'Variables: {名称} layer or slice name · {倍数} the 2 in @2x · {格式} png / jpg / webp · {序号} counter inside one batch',
  'CSS 单位': 'CSS unit',
  '基准 px': 'base px',
  '画布宽 px': 'canvas width px',
  '详情页属性面板导出的 CSS 代码按此单位换算；vw 默认按当前画布宽度换算，画布未知时用上面的基准值':
    'CSS shown in the detail-page properties panel converts to this unit; vw uses the current artboard width, falling back to the base value above',
  // 启动与更新
  '启动与更新': 'Startup & Updates',
  '开关改动立即保存，重启后保持': 'Toggles save immediately and persist across restarts',
  '启动时打开上次的 PSD': 'Reopen the last PSD on startup',
  '直接进入最后编辑的设计稿；关闭后启动停在项目页':
    'Jump straight into the design file you were editing; when off, startup stays on the project page',
  '自动检查更新': 'Check for updates automatically',
  '启动时静默查询一次 GitHub Releases，仅发现新版本才提示；关闭后可在「关于轻切」手动检查':
    'Query GitHub Releases once at startup and notify only when a newer version exists; you can still check manually in “About 轻切”',
  // 画布与测量
  '画布与测量': 'Canvas & Measuring',
  '详情页画布的行为，改动立即生效': 'Behaviour of the detail-page canvas; changes apply immediately',
  '悬停测距': 'Hover measuring',
  '选择工具下选中图层后，悬停其它图层显示 Figma 式的边缘间距':
    'With the move tool and a layer selected, hovering another layer shows Figma-style edge gaps',
  '恢复上次缩放与位置': 'Restore last zoom and position',
  '重新打开同一份 PSD 时回到上次的画布视口；关闭后每次适配整图':
    'Reopening the same PSD returns to its last canvas viewport; when off, every open fits the whole artboard',
  '导出 CSS 的长度单位在「导出设置」里选择。': 'The length unit for exported CSS is chosen under “Export Settings”.',
  // 存储与缓存上限
  '缓存上限': 'Cache limit',
  '不限制': 'Unlimited',
  '超出上限时，导入新 PSD 后自动删除最久未用的缩略图。缩略图只是列表预览，删掉不影响 PSD 源文件，重新导入即可再生成。':
    'Above the limit, importing a new PSD drops the least recently used thumbnails. They are only list previews — removing them never touches the PSD files, and re-importing regenerates them.',
  '已按上限清理 {n} 个缩略图，释放 {size}': 'Trimmed {n} thumbnails to the limit, freed {size}'
} as Record<string, string>
