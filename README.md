# 轻切（QingQie）

一个轻量的 **PSD 切图桌面工具**，为前端开发者打造。只保留切图工作流真正需要的能力，替代「打开 Photoshop 只为量个尺寸、切张图」的沉重体验。

## 它能做什么

- **项目管理**：新建项目 → 项目内上传（导入）PSD → 横向画板流列表 → 进入切图详情页；PSD 只记路径不拷贝文件，缩略图按「路径+大小+修改时间」缓存
- **PSD 解析与渲染**：还原图层树、图层显隐、不透明度、混合模式、剪贴蒙版、图层蒙版；文本图层自动提取内容、字号、颜色、字体、字重
- **画布交互**：滚轮缩放 / 拖拽平移、移动工具按像素点选图层（所见即所得，不会误选背景层）、取色器点击复制色值、切片工具拖拽画框
- **切片（切图）**：自动编号、拖动、8 控制柄缩放、X/Y/W/H 数值精调、Shift/Ctrl 多选、右上角删除、按选区/全量批量导出
- **属性面板**：图层位置/尺寸/透明度、文本内容与字体信息（一键复制）、CSS 片段（含 font-size/font-family/font-weight/color，一键复制）、图层与组合成预览
- **批量导出**：图层 / 切片两种模式，支持 PNG/JPG/WebP、@1x/@2x/@3x，命名模板（`{名称} {倍数} {格式} {序号}`），一次选目录批量写文件
- **界面**：亮/暗双主题（默认亮色，主色为蓝色渐变不随主题变化）、无边框窗口 + 自绘窗口控制、自定义弹窗与 Toast、全局面板动效

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面容器 | Electron + electron-vite |
| 前端 | React 18 + TypeScript + Vite 5 |
| 样式 | Tailwind CSS v4（@theme/@utility + CSS 变量运行时主题） |
| PSD 解析 | ag-psd（主）+ @webtoon/psd（ZIP 压缩等场景兜底） |
| Node 端绘图 | @napi-rs/canvas（主进程生成缩略图） |
| 打包 | electron-builder（Windows NSIS） |

## 目录结构

```text
qie/
├── design/index.html        # 高保真静态原型（UI 定稿来源，三页 hash 路由）
├── scripts/                 # PSD 诊断脚本（diagnose-psd.mjs / debug-text.mjs）
├── src/main/                # Electron 主进程（窗口、IPC、缩略图、文件写入）
├── src/preload/             # contextBridge 安全桥接 API
└── src/renderer/            # React 渲染进程
    ├── pages/               # HomePage / ProjectPage / DetailPage
    ├── components/          # CanvasView / LayerTree / PropertiesPanel / icons / ui
    └── lib/                 # psd.ts 解析与合成管线 / export.ts / router / projects / ui
```

## 使用说明书

### 1. 安装依赖

需要 Node.js ≥ 20（含 npm）。在项目目录执行：

```bash
npm install
```

> 注意：`@napi-rs/canvas` 必须保持在 `dependencies`（原生模块，放 devDependencies 会被打进主进程 bundle 导致损坏）。

### 2. 开发调试

```bash
npm run dev        # 启动 electron-vite，弹出应用窗口，改动热更新
npm run typecheck  # 类型检查（node + web 两份 tsconfig）
npm run build      # 产出 out/（main + preload + renderer）
```

### 3. 打包发布（Windows）

```bash
npm run dist       # = electron-vite build && electron-builder --win
```

产物在 `release/` 目录（NSIS 安装向导，支持自选安装路径）。打包前建议：

1. `npm run typecheck && npm run build` 全绿；
2. `npm run dev` 用真实 PSD 回归：导入 → 渲染 → 点选 → 切片 → 批量导出。

### 4. 应用操作流程

1. **首页**：顶栏「＋新建项目」→ 输入名称；
2. **项目页**：「上传 PSD」多选导入（或拖拽文件），画板卡片 hover 可重命名/删除，支持分组（新增/重命名/删除分组、拖拽归类）；
3. **详情页**：底部 zoombar 切换工具——`V` 移动选层、`C` 切片、`I` 取色、`H` 抓手；左右面板可拖宽、可收起（进入时默认收起，解析完成自动展开）；
4. **切图导出**：拖拽画切片 → batch-bar 精调尺寸 → 「批量导出」一次导出全部/选中切片；移动工具模式下的 batch-bar 可批量导出全部可见图层；
5. **取样式**：选中图层 → 右侧属性面板复制 CSS / 文本内容 / 色值。

### 5. 数据存放

- 项目元数据：Electron `userData/projects.json`（Windows 下位于 `%APPDATA%/轻切/`）
- PSD 缩略图缓存：`userData/thumbs/`
- 导出文件：每次自行选择目录

### 6. 解析失败排查

个别 PSD（ZIP 压缩图层等）主解析器会失败，应用会自动切换到 `@webtoon/psd` 兜底并 Toast 提示。如需诊断：

```bash
node scripts/diagnose-psd.mjs "X:\path\to\file.psd"   # 输出合成 PNG 对比
node scripts/debug-text.mjs  "X:\path\to\file.psd"    # dump 文本图层原始 JSON
```

## 已知限制

- 智能对象/调整图层暂不做矢量化还原（按位图渲染）
- 文本图层样式取默认 run（同图层多段混排样式暂不细分）
- 仅 Windows 打包目标（macOS 可按需扩展 electron-builder 配置）

## License

Private — © daihongkun
