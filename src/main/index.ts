import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFile, writeFile, mkdir, stat, access } from 'fs/promises'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'

initializeCanvas((width, height) => createCanvas(width, height))

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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

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

ipcMain.handle('psd:read', async (_e, filePath: string) => {
  const buffer = await readFile(filePath)
  return { name: basename(filePath), buffer: new Uint8Array(buffer) }
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
ipcMain.handle('psd:import', async (_e, paths: string[]): Promise<ImportResult[]> => {
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
  return results
})

// ========== 批量导出 ==========
ipcMain.handle('dir:pick', async (): Promise<string | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择导出目录',
    properties: ['openDirectory', 'createDirectory']
  })
  return canceled || !filePaths[0] ? null : filePaths[0]
})

ipcMain.handle(
  'images:save-batch',
  async (_e, files: { name: string; dataUrl: string }[]): Promise<{ saved: number } | null> => {
    const dir = await dialog.showOpenDialog({
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (dir.canceled || !dir.filePaths[0]) return null
    const outDir = dir.filePaths[0]
    const used = new Set<string>()
    let saved = 0
    for (const f of files) {
      let name = f.name
      let i = 2
      while (used.has(name.toLowerCase())) {
        name = f.name.replace(/(\.[^.]+)$/, `（${i}）$1`)
        i++
      }
      used.add(name.toLowerCase())
      const base64 = f.dataUrl.slice(f.dataUrl.indexOf(',') + 1)
      await writeFile(join(outDir, name), Buffer.from(base64, 'base64'))
      saved++
    }
    return { saved }
  }
)

// ========== 导出保存 ==========
const FORMAT_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  png: { name: 'PNG 图片', extensions: ['png'] },
  jpeg: { name: 'JPEG 图片', extensions: ['jpg'] },
  webp: { name: 'WebP 图片', extensions: ['webp'] }
}

ipcMain.handle(
  'image:save',
  async (_e, defaultName: string, format: string, dataUrl: string): Promise<boolean> => {
    const ext = format === 'jpeg' ? 'jpg' : format
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出图片',
      defaultPath: defaultName,
      filters: [FORMAT_FILTERS[format] ?? FORMAT_FILTERS.png]
    })
    if (canceled || !filePath) return false
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    await writeFile(filePath, Buffer.from(base64, 'base64'))
    return true
  }
)
