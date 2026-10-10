# 轻切（QingQie）v1.0.1

一个轻量的 **PSD 切图桌面工具**，为前端开发者打造。只保留切图工作流真正需要的能力，替代「打开 Photoshop 只为量个尺寸、切张图」的沉重体验。

- 免装 Photoshop，不上传设计稿：PSD 只在本机解析，文件仅记录路径、不会被移动或拷贝
- 从导入到交付一条线走完：导入 → 解析 → 点选/测距 → 切片 → 批量导出 → 复制 CSS
- 合成结果与 Photoshop 逐像素对齐，218MB 大档解析期间界面不冻结

**下载**：[GitHub Releases](https://github.com/dhk333/QinQIe/releases)（Windows NSIS 安装包）

---

## 功能总览

### 项目与文件

- **项目管理**：新建 / 重命名 / 删除项目，首页搜索；项目内可建分组、拖拽归类画板
- **PSD 导入**：多选或拖拽导入，PSD 只记路径；缩略图按「路径 + 大小 + 修改时间」缓存，可设容量上限（不限制 / 128 / 256 / 512 / 1024 MB），超限按最近最少使用自动清理
- **启动行为**：可选「启动时回到上次编辑的 PSD」「重开 PSD 恢复上次的缩放与位置」

### 解析与渲染

- **图层还原**：图层树、显隐、不透明度、混合模式、剪贴蒙版、图层蒙版；文本图层自动提取内容、字号、颜色、字体、字重
- **性能**：读文件走 `psdfile://` 流式协议（不再整体复制字节），位图全量解码放进 Worker 线程，解码完成前先用 PSD 内嵌合成图铺画面，组级分段合成缓存让显隐切换不用全文档重算
- **兜底**：个别 PSD（ZIP 压缩图层等）主解析器失败时自动切换到 `@webtoon/psd` 并提示

### 画布与测量

- **工具**：`V` 移动选层、`C` 切片、`I` 取色、`H` 抓手；滚轮缩放、拖拽平移
- **像素点选**：移动工具下按像素命中图层，所见即所得，不会误选背景层
- **剪贴蒙版所见即所得**：被剪贴的图层，选框、尺寸标注、测距、属性面板读数、CSS 片段与单图层导出全部按「剪贴后真正露出来的那块」算（原始位图 1373×774 被矩形基底裁掉后，选中和出图都是 990×507）；图层树里这类图层名前带 PS 式弯钩箭头标记，面板会写明它「剪贴于」哪个基底
- **测距**：选中图层后悬停另一图层，显示 Figma 式的边到边间距（ΔX / ΔY）；选中图层组时显示子层到组包围盒四边的内边距；可在设置里整体关掉
- **切片**：拖拽画框、自动编号、8 控制柄缩放、X/Y/W/H 数值精调、Shift/Ctrl 多选、颜色标记
- **切图基准宽度**：详情页底部可把画布口径改成任意宽度（如 2560 的稿子按 1920 切），高度按设计稿比例自动跟随；画布显示、尺寸标注、切片数值、CSS 长度与导出像素都按基准换算，而坐标始终存 PSD 原始像素，换基准不会动到已切的区域

### 取样式与导出

- **属性面板**：位置 / 尺寸 / 透明度、文本信息与字体（一键复制）、图层预览与组合成预览
- **CSS 片段**：直接给出定位、尺寸、背景色、字体相关声明；长度单位可选 **px / rem / vw**——rem 基准默认 16px 可改，vw 基准取当前画布宽度（1920 的稿子即 100vw = 1920px），非 px 模式还会附上 PSD 原值注释
- **批量导出**：图层模式与切片模式，PNG / JPG / WebP，@1x / @2x / @3x，JPG/WebP 可调质量，一次选目录批量写盘
- **命名模板**：`{名称} {倍数} {格式} {序号}` 四个变量任意组合（默认 `{名称}@{倍数}x.{格式}`，序号自动补零）

### 界面与效率

- **主题**：亮 / 暗双基调 + 6 套内置配色（晴空、墨夜、青瓷、暖沙、绛紫、松墨），并支持自定义主题；界面纯色扁平，不用渐变
- **字号**：多档界面字号可调
- **多语言**：简体中文 / 繁體中文 / English，设置页切换即时生效
- **快捷键**：全键位可自定义改绑、冲突提示、单条或全部恢复默认；`?` 打开快捷键总览
- **设置页**：「通用 / 效率 / 关于」三组共 10 项，支持搜索定位
- **新手引导**：7 步聚光灯引导，首次启动自动播放，之后可在设置页随时重放
- **窗口**：无边框窗口 + 自绘最小化 / 最大化 / 关闭，自定义弹窗与 Toast，页面切换与加载有入场动效

### 更新

- 应用内自动检查更新（可在设置里关掉），顶栏出现新版胶囊提示
- 内置「更新日志」页与仓库根目录 `更新记录.md` 同一份口径
- 设置页可手动检查更新，明确反馈已是最新 / 发现新版本 / 网络异常

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面容器 | Electron + electron-vite |
| 前端 | React 18 + TypeScript + Vite 5 |
| 样式 | Tailwind CSS v4（@theme/@utility + CSS 变量运行时主题） |
| PSD 解析 | ag-psd（主）+ @webtoon/psd（ZIP 压缩等场景兜底） |
| 并发 | Web Worker（位图解码）+ 自定义 `psdfile://` 流式协议（读文件） |
| Node 端绘图 | @napi-rs/canvas（主进程生成缩略图） |
| 打包 | electron-builder（Windows NSIS） |

## 目录结构

```text
轻切/
├── design/index.html        # 高保真静态原型（UI 定稿来源，三页 hash 路由）
├── scripts/                 # 门禁与排查脚本（verify-fidelity / verify-app-path / diagnose-psd 等）
├── src/main/                # Electron 主进程（窗口、IPC、缩略图与缓存、流式协议、文件写入）
├── src/preload/             # contextBridge 安全桥接 API
└── src/renderer/            # React 渲染进程
    ├── pages/               # HomePage / ProjectPage / DetailPage / SettingsPage / ChangelogPage
    ├── components/          # CanvasView / LayerTree / PropertiesPanel / OnboardingTour / icons
    ├── i18n/                # 国际化核心 + locales/{en,zh-TW} 词典（中文原文作 key）
    └── lib/                 # psd / compositor / psdWorker / export / cssUnits / uiPrefs / session / keymapSettings / themes …
```

## 使用说明书

### 1. 安装依赖

需要 Node.js ≥ 20。在项目目录执行：

```bash
npm install
```

> `@napi-rs/canvas` 必须保持在 `dependencies`（原生模块，放 devDependencies 会被打进主进程 bundle 导致损坏）。

### 2. 开发调试

```bash
npm run dev        # 启动 electron-vite，弹出应用窗口，改动热更新
npm run typecheck  # 类型检查（node + web 两份 tsconfig）
npm run build      # 产出 out/（main + preload + renderer）
npm run verify     # 像素保真度回归 + 应用数据通路回归
```

### 3. 打包发布（Windows）

```bash
npm run dist       # = electron-vite build && electron-builder --win
```

产物在 `release/轻切 Setup <版本>.exe`（NSIS 安装向导，支持自选安装路径）。发布前门禁：

1. `npm run typecheck && npm run build && npm run verify` 全绿；
2. 用真实 PSD 回归一遍：导入 → 渲染 → 点选 → 测距 → 切片 → 批量导出 → 复制 CSS。

### 4. 应用操作流程

1. **首页**：顶栏「＋新建项目」→ 输入名称；
2. **项目页**：「上传 PSD」多选导入（或拖拽文件），画板卡片 hover 可重命名 / 删除，支持分组；
3. **详情页**：底部工具条切换 `V/C/I/H`；左右面板可拖宽、可收起（进入时默认收起，解析完成自动展开）；
4. **切图导出**：拖拽画切片 → 批量条精调尺寸 → 「批量导出」导出全部 / 选中切片；移动工具下的批量条可直接导出全部可见图层；
5. **取样式**：选中图层 → 右侧属性面板复制 CSS / 文本 / 色值，需要 rem 或 vw 就在 CSS 段里切单位。

### 5. 数据存放

- 项目元数据：Electron `userData/projects.json`（Windows 下位于 `%APPDATA%/轻切/`）
- PSD 缩略图缓存：`userData/thumbs/`
- 界面偏好：渲染进程 `localStorage`（主题 / 字号 / 语言 / 快捷键改绑 / 导出设置 / 通用偏好 / 会话恢复，各占独立 key）
- 导出文件：每次自行选择目录，应用不做静默落盘

### 6. 解析失败排查

```bash
node scripts/diagnose-psd.mjs "X:\path\to\file.psd"   # 输出合成 PNG 对比
node scripts/debug-text.mjs  "X:\path\to\file.psd"    # dump 文本图层原始 JSON
```

## 已知限制

- 智能对象 / 调整图层暂不做矢量化还原（按位图渲染）
- 文本图层样式取默认 run（同图层多段混排样式暂不细分）
- 暂不含图层样式（描边、阴影等）的参数化还原，只做视觉合成
- 仅 Windows 打包目标（macOS 可按需扩展 electron-builder 配置）

## License

Private — © daihongkun
