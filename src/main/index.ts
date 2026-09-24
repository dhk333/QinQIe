import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join, basename } from 'path'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0a0a',
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

const FORMAT_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  png: { name: 'PNG 图片', extensions: ['png'] },
  jpeg: { name: 'JPEG 图片', extensions: ['jpg'] },
  webp: { name: 'WebP 图片', extensions: ['webp'] }
}

ipcMain.handle('psd:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '打开 PSD 文件',
    properties: ['openFile'],
    filters: [{ name: 'Photoshop 文件', extensions: ['psd'] }]
  })
  if (canceled || filePaths.length === 0) return null
  const filePath = filePaths[0]
  const buffer = await readFile(filePath)
  return { name: basename(filePath), buffer: new Uint8Array(buffer) }
})

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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
