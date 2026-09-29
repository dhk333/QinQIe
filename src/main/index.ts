import { app, shell, BrowserWindow, ipcMain, dialog, Menu, protocol, Tray, Notification, nativeImage } from 'electron'
import type { MenuItemConstructorOptions, NativeImage } from 'electron'
import { KEY_COMMANDS, type KeyCommand } from '../shared/keymap'
import { readFile, writeFile, mkdir, stat, access, readdir, rm } from 'fs/promises'
import { readFileSync, writeFileSync } from 'fs'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'

initializeCanvas((width, height) => createCanvas(width, height))

// PSD 字节直供协议：渲染层 fetch('psdfile://f/<分段编码路径>') 流式取文件。
// 替代把 240MB buffer 整体走 invoke 返回（结构化克隆双拷贝 ≈2.3s）。
// 必须在 app ready 前注册为特权 scheme；仅放行 .psd 后缀。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'psdfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

// ========== 应用菜单（与 shared/keymap 同源） ==========
// 所有自定义项 registerAccelerator:false：键位统一由渲染层按 keymap 处理，
// 避免在输入框聚焦时被系统 accelerator 抢键；菜单点击经 menu:exec 回灌同一分发器。
function exec(id: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:exec', id)
}

function cmdItems(groups: KeyCommand['group'][]): MenuItemConstructorOptions[] {
  return KEY_COMMANDS.filter((c) => groups.includes(c.group) && c.accelerator).map(
    (c) => ({
      label: c.accelerator === '?' ? `${c.label}  (?)` : c.label,
      accelerator: c.accelerator === '?' ? undefined : c.accelerator,
      registerAccelerator: false,
      click: () => exec(c.id)
    })
  )
}

function buildAppMenu(): Menu {
  // 开发者工具只在 dev 暴露；安装包（正式包）不带调试入口
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  return Menu.buildFromTemplate([
    {
      label: '轻切',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: '编辑', submenu: cmdItems(['工具', '选择', '编辑']) },
    {
      label: '视图',
      submenu: [
        ...cmdItems(['视图', '界面']),
        { type: 'separator' },
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: '图层', submenu: cmdItems(['图层']) },
    { label: '导出', submenu: cmdItems(['导出']) }
  ])
}

// ========== 关闭确认与托盘 ==========
// 导出与解析都跑在渲染进程，直接关窗会中断它们，所以关窗先问一次去向。
// 「不再询问」落在主进程：渲染层的 localStorage 在「记住 + 立即退出」时来不及 flush。
type CloseChoice = 'quit' | 'tray'

let closeChoice: CloseChoice | null = null
let quitting = false
let tray: Tray | null = null

const closePrefFile = (): string => join(app.getPath('userData'), 'close-pref.json')

function setCloseChoice(action: CloseChoice | null): void {
  closeChoice = action
  try {
    writeFileSync(closePrefFile(), JSON.stringify({ action }), 'utf-8')
  } catch {
    // 写失败只影响下次仍会询问，不影响本次关闭
  }
}

function loadCloseChoice(): void {
  try {
    const v = (JSON.parse(readFileSync(closePrefFile(), 'utf-8')) as { action?: unknown }).action
    if (v === 'quit' || v === 'tray') closeChoice = v
  } catch {
    // 首次运行没有记录
  }
}

function trayIcon(): NativeImage {
  const file = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
  const img = nativeImage.createFromPath(file)
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

function showFromTray(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function ensureTray(win: BrowserWindow): void {
  if (tray && !tray.isDestroyed()) return
  tray = new Tray(trayIcon())
  tray.setToolTip('轻切')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => showFromTray(win) },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => showFromTray(win))
}

// Win11 默认把新托盘图标收进溢出区，只靠图标找回窗口不现实，所以隐藏后补一次通知
let trayHintShown = false
function notifyHiddenToTray(win: BrowserWindow): void {
  if (trayHintShown || !Notification.isSupported()) return
  trayHintShown = true
  const n = new Notification({ title: '轻切仍在后台运行', body: '正在进行的导出不会中断；点这里恢复窗口' })
  n.on('click', () => showFromTray(win))
  n.show()
}

function applyClose(win: BrowserWindow, action: CloseChoice): void {
  if (action === 'quit') {
    quitting = true
    win.close()
    return
  }
  ensureTray(win)
  win.hide()
  notifyHiddenToTray(win)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#f3f5f9',
    title: '轻切',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (e) => {
    if (quitting || mainWindow.webContents.isDestroyed()) return
    e.preventDefault()
    if (closeChoice) applyClose(mainWindow, closeChoice)
    else mainWindow.webContents.send('win:ask-close')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 渲染进程崩溃兜底（超大 PSD 解码吃满内存时的 OOM 是主要来源）：
  // 崩溃后窗口会永远停在黑屏，这里先亮一页说明再自动重载，回到上次的详情页
  const loadContent = (): void => {
    if (process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details.reason, details.exitCode)
    if (mainWindow.isDestroyed() || details.reason === 'clean-exit') return
    const why =
      details.reason === 'oom'
        ? '渲染进程内存耗尽——打开超大 PSD 文件时最常见'
        : details.reason === 'crashed'
          ? '渲染进程意外崩溃'
          : `渲染进程异常退出（${details.reason}）`
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui;background:#f3f5f9"><div style="text-align:center;color:#3a4150"><div style="font-size:17px;font-weight:600;margin-bottom:8px">界面出错了</div><div style="font-size:13px;color:#6b7383">${why}<br>3 秒后自动重新启动，你的项目与编辑记录都已保存</div></div></body>`
    mainWindow.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    )
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) loadContent()
    }, 3000)
  })

  // dev 诊断：渲染层 React 警告（含组件栈）透传
ipcMain.on('app:renderer-log', (_e, text: string) => {
  console.log('[renderer:stack]', text)
})

// dev：渲染层 console 的 warn/error 透传到主进程 stdout，排查偶发白屏/崩溃时有据可查
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) {
        console.log(`[renderer:${level === 3 ? 'error' : 'warn'}] ${message} @${sourceId}:${line}`)
      }
    })
  }

  loadContent()
}

// psdfile:// → 本地文件流式响应；渲染层把路径按段 encodeURIComponent（standard scheme 的
// host 不接受 % 编码，整段塞进单一路径段会被解析成 host 而失败）。
// 仅放行 .psd 后缀，避免协议变成任意文件读取口子。
// 不走 net.fetch：其请求受会话代理配置影响（本机代理会重置 file: 请求），直接回文件流
function registerPsdFileProtocol(): void {
  protocol.handle('psdfile', (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.replace(/^\//, '').split('/').map(decodeURIComponent)
      // 首段带盘符为普通路径；否则视为 UNC（渲染层已去掉前导 \\，这里补回）
      const filePath = /^[a-zA-Z]:/.test(parts[0] ?? '')
        ? parts.join('\\')
        : `\\\\${parts.join('\\')}`
      if (!filePath.toLowerCase().endsWith('.psd')) {
        return new Response('forbidden', { status: 403 })
      }
      const st = createReadStream(filePath)
      return new Response(Readable.toWeb(st) as unknown as ReadableStream, {
        headers: { 'Content-Type': 'application/octet-stream' }
      })
    } catch (err) {
      console.error('[psdfile]', err)
      return new Response('bad request', { status: 400 })
    }
  })
}

app.whenReady().then(() => {
  registerPsdFileProtocol()
  loadCloseChoice()
  Menu.setApplicationMenu(buildAppMenu())
  createWindow()
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ========== 自定义窗口控制 ==========
ipcMain.on('win:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize()
})
ipcMain.on('win:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('win:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close()
})
// 确认框的两个出口；remember 时把选择落盘，下次关窗直接执行
ipcMain.on('win:close-choice', (e, action: unknown, remember: boolean) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win || (action !== 'quit' && action !== 'tray')) return
  if (remember) setCloseChoice(action)
  applyClose(win, action)
})
ipcMain.handle('app:close-pref', (): CloseChoice | null => closeChoice)
ipcMain.on('app:reset-close-pref', () => setCloseChoice(null))

// ========== 项目数据持久化 ==========
const projectsFile = (): string => join(app.getPath('userData'), 'projects.json')

ipcMain.handle('projects:load', async () => {
  try {
    return JSON.parse(await readFile(projectsFile(), 'utf-8'))
  } catch {
    return { projects: [] }
  }
})

ipcMain.handle('projects:save', async (_e, data: unknown): Promise<boolean> => {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(projectsFile(), JSON.stringify(data, null, 2), 'utf-8')
  return true
})

// ========== 存储与缓存 ==========
async function dirSize(dir: string): Promise<number> {
  let sum = 0
  try {
    for (const it of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, it.name)
      sum += it.isDirectory() ? await dirSize(p) : (await stat(p)).size
    }
  } catch {
    // 目录不存在按 0 计
  }
  return sum
}

ipcMain.handle('app:open-data-dir', (): Promise<string> => shell.openPath(app.getPath('userData')))

ipcMain.handle('app:data-stats', async (): Promise<{ root: string; total: number; thumbs: number }> => {
  const root = app.getPath('userData')
  return { root, total: await dirSize(root), thumbs: await dirSize(join(root, 'thumbnails')) }
})

ipcMain.handle('app:clear-thumb-cache', async (): Promise<number> => {
  const thumbDir = join(app.getPath('userData'), 'thumbnails')
  const freed = await dirSize(thumbDir)
  await rm(thumbDir, { recursive: true, force: true })
  return freed
})

// 缩略图缓存限量：按最后使用时间从新到旧保留，超出额度的整文件删除。
// maxBytes<=0 表示不限制。
async function trimThumbCache(maxBytes: number): Promise<{ deleted: number; freed: number }> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { deleted: 0, freed: 0 }
  const thumbDir = join(app.getPath('userData'), 'thumbnails')
  const files: { path: string; size: number; used: number }[] = []
  try {
    for (const name of await readdir(thumbDir)) {
      if (!name.endsWith('.png')) continue
      const p = join(thumbDir, name)
      const st = await stat(p)
      files.push({ path: p, size: st.size, used: Math.max(st.mtimeMs, st.atimeMs) })
    }
  } catch {
    return { deleted: 0, freed: 0 }
  }
  files.sort((a, b) => b.used - a.used)
  let keep = 0
  let deleted = 0
  let freed = 0
  for (const f of files) {
    if (keep + f.size <= maxBytes) {
      keep += f.size
      continue
    }
    try {
      await rm(f.path, { force: true })
      deleted++
      freed += f.size
    } catch {
      // 文件被占用时跳过，下次再清
    }
  }
  return { deleted, freed }
}

ipcMain.handle('app:trim-thumb-cache', (_e, maxBytes: number) => trimThumbCache(maxBytes))

// ========== PSD 详情页结构缓存 ==========
// 键与缩略图同一套：md5(路径|大小|mtime)，源文件一变即换新键自动失效。
// JSON 存结构树 + 去位图节点树，WebP 存内嵌合成图；重开同一文件渲染层可跳过结构解析。
const PSD_CACHE_DIR = 'psd-cache'
const PSD_CACHE_MAX_ENTRIES = 200

async function psdCacheLocate(p: string): Promise<{ dir: string; key: string }> {
  const st = await stat(p)
  const key = createHash('md5').update(`${p}|${st.size}|${st.mtimeMs}`).digest('hex')
  return { dir: join(app.getPath('userData'), PSD_CACHE_DIR), key }
}

ipcMain.handle(
  'psd-cache:read',
  async (_e, p: string): Promise<{ hit: boolean; entry?: unknown; preview?: string | null }> => {
    try {
      const { dir, key } = await psdCacheLocate(p)
      const entry = JSON.parse(await readFile(join(dir, `${key}.json`), 'utf-8'))
      let preview: string | null = null
      for (const [ext, mime] of [
        ['webp', 'image/webp'],
        ['png', 'image/png']
      ] as const) {
        try {
          preview = `data:${mime};base64,${(await readFile(join(dir, `${key}.${ext}`))).toString('base64')}`
          break
        } catch {
          // 换下一个扩展名
        }
      }
      // 没有预览图的条目撑不起「先见画面后解码」，当 miss 重新解析
      if (!preview) return { hit: false }
      return { hit: true, entry, preview }
    } catch {
      return { hit: false }
    }
  }
)

ipcMain.handle(
  'psd-cache:write',
  async (
    _e,
    p: string,
    payload: { entry: unknown; preview?: { bytes: Uint8Array; ext: string } }
  ): Promise<boolean> => {
    try {
      if (!payload?.entry || !payload.preview?.bytes?.length) return false
      const { dir, key } = await psdCacheLocate(p)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${key}.json`), JSON.stringify(payload.entry))
      await writeFile(
        join(dir, `${key}.${payload.preview.ext === 'png' ? 'png' : 'webp'}`),
        payload.preview.bytes
      )
      await prunePsdCache(dir)
      return true
    } catch {
      return false
    }
  }
)

// 条目封顶：超限时从旧到新删（json 连同配套预览图），防止换名打开的文件无限堆积
async function prunePsdCache(dir: string): Promise<void> {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
    if (names.length <= PSD_CACHE_MAX_ENTRIES) return
    const list = await Promise.all(
      names.map(async (n) => ({ n, m: (await stat(join(dir, n))).mtimeMs }))
    )
    list.sort((a, b) => b.m - a.m)
    for (const { n } of list.slice(PSD_CACHE_MAX_ENTRIES)) {
      const base = join(dir, n.replace(/\.json$/, ''))
      for (const ext of ['.json', '.webp', '.png']) await rm(`${base}${ext}`, { force: true })
    }
  } catch {
    // 清理失败不影响主流程
  }
}

// ========== 更新检查（GitHub Releases，无后端；失败一律静默） ==========
function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

const REPO = 'dhk333/QinQIe'

ipcMain.handle(
  'app:check-update',
  async (): Promise<
    | { status: 'new'; version: string; url: string; notes: string }
    | { status: 'latest' }
    | { status: 'error' }
  > => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'qingqie-desktop' }
      })
      if (!res.ok) return { status: 'error' }
      const rel = (await res.json()) as { tag_name?: string; html_url?: string; body?: string }
      const version = (rel.tag_name || '').replace(/^v/i, '')
      if (!/^\d+(\.\d+)*$/.test(version)) return { status: 'error' }
      if (cmpVer(version, app.getVersion()) <= 0) return { status: 'latest' }
      return {
        status: 'new',
        version,
        url: rel.html_url || `https://github.com/${REPO}/releases`,
        notes: rel.body || ''
      }
    } catch {
      return { status: 'error' }
    }
  }
)

// ========== PSD 文件 ==========
const PSD_FILTERS = [{ name: 'Photoshop 文件', extensions: ['psd'] }]

ipcMain.handle('psd:pick', async (): Promise<string[]> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '上传 PSD 文件',
    properties: ['openFile', 'multiSelections'],
    filters: PSD_FILTERS
  })
  return canceled ? [] : filePaths
})

ipcMain.handle('file:exists', async (_e, p: string): Promise<boolean> => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
})

ipcMain.handle('file:read-dataurl', async (_e, p: string): Promise<string | null> => {
  try {
    const buf = await readFile(p)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
})

interface ImportResult {
  path: string
  name: string
  w: number
  h: number
  dataUrl: string | null
  thumbPath: string
  error?: string
}

// 导入 PSD：只读合成图生成缩略图并缓存（不解析图层，列表页秒开）
ipcMain.handle('psd:import', async (_e, paths: string[], maxThumbBytes?: number): Promise<ImportResult[]> => {
  const results: ImportResult[] = []
  const thumbDir = join(app.getPath('userData'), 'thumbnails')
  for (const filePath of paths) {
    try {
      const st = await stat(filePath)
      const key = createHash('md5').update(`${filePath}|${st.size}|${st.mtimeMs}`).digest('hex')
      const cachePath = join(thumbDir, `${key}.png`)
      let dataUrl: string
      let w = 0
      let h = 0
      try {
        const cached = await readFile(cachePath)
        // PNG IHDR：宽高分别位于第 16/20 字节
        w = cached.readUInt32BE(16)
        h = cached.readUInt32BE(20)
        dataUrl = `data:image/png;base64,${cached.toString('base64')}`
      } catch {
        const buf = await readFile(filePath)
        let canvasImg: import('@napi-rs/canvas').Canvas | null = null
        let rgba: Uint8ClampedArray | null = null
        try {
          const psd = readPsd(buf, { skipLayerImageData: true, skipThumbnail: true })
          w = psd.width
          h = psd.height
          canvasImg = psd.canvas
            ? (psd.canvas as unknown as import('@napi-rs/canvas').Canvas)
            : null
        } catch {
          // 主解析器失败时使用 @webtoon/psd 兜底
          const mod = await import('@webtoon/psd')
          const Psd = mod.default
          const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
          const parsed = Psd.parse(ab)
          w = parsed.width
          h = parsed.height
          rgba = new Uint8ClampedArray(await parsed.composite())
        }
        const scale = Math.min(1, 420 / Math.max(w, 1))
        const tw = Math.max(1, Math.round(w * scale))
        const th = Math.max(1, Math.round(h * scale))
        const out = createCanvas(tw, th)
        const ctx = out.getContext('2d')
        if (canvasImg) {
          ctx.drawImage(canvasImg, 0, 0, tw, th)
        } else if (rgba) {
          const img = ctx.createImageData(tw, th)
          // 简单最近邻缩放写入
          for (let y = 0; y < th; y++) {
            const sy = Math.min(h - 1, Math.floor(y / scale))
            for (let x = 0; x < tw; x++) {
              const sx = Math.min(w - 1, Math.floor(x / scale))
              const si = (sy * w + sx) * 4
              const di = (y * tw + x) * 4
              img.data[di] = rgba[si]
              img.data[di + 1] = rgba[si + 1]
              img.data[di + 2] = rgba[si + 2]
              img.data[di + 3] = rgba[si + 3]
            }
          }
          ctx.putImageData(img, 0, 0)
        } else {
          ctx.fillStyle = '#eef1f6'
          ctx.fillRect(0, 0, tw, th)
        }
        const png = out.toBuffer('image/png')
        await mkdir(thumbDir, { recursive: true })
        await writeFile(cachePath, png)
        dataUrl = `data:image/png;base64,${png.toString('base64')}`
      }
      results.push({
        path: filePath,
        name: basename(filePath).replace(/\.psd$/i, ''),
        w,
        h,
        dataUrl,
        thumbPath: cachePath
      })
    } catch (err) {
      results.push({
        path: filePath,
        name: basename(filePath),
        w: 0,
        h: 0,
        dataUrl: null,
        thumbPath: '',
        error: String(err)
      })
    }
  }
  // 新生成的缩略图已写入，此时封顶删掉的是更久没用的旧缓存
  await trimThumbCache(Number(maxThumbBytes))
  return results
})

// ========== 导出保存 ==========
ipcMain.handle('dir:pick', async (): Promise<string | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择导出目录',
    properties: ['openDirectory', 'createDirectory']
  })
  return canceled || !filePaths[0] ? null : filePaths[0]
})

const FORMAT_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  png: { name: 'PNG 图片', extensions: ['png'] },
  jpeg: { name: 'JPEG 图片', extensions: ['jpg'] },
  webp: { name: 'WebP 图片', extensions: ['webp'] }
}

// 字节直写：渲染层已完成编码，主进程只落盘，省掉 base64 编解码开销
ipcMain.handle(
  'image:save',
  async (_e, defaultName: string, format: string, bytes: Uint8Array): Promise<boolean> => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出图片',
      defaultPath: defaultName,
      filters: [FORMAT_FILTERS[format] ?? FORMAT_FILTERS.png]
    })
    if (canceled || !filePath) return false
    await writeFile(filePath, bytes)
    return true
  }
)

ipcMain.handle(
  'file:write-bytes',
  async (_e, dir: string, name: string, bytes: Uint8Array): Promise<boolean> => {
    try {
      // basename 兜底：目录来自系统选择器，文件名只允许最终一段
      await writeFile(join(dir, basename(name)), bytes)
      return true
    } catch {
      return false
    }
  }
)
