import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  // 窗口控制
  winMinimize: (): void => ipcRenderer.send('win:minimize'),
  winMaximize: (): void => ipcRenderer.send('win:maximize'),
  winClose: (): void => ipcRenderer.send('win:close'),
  // 项目数据持久化
  loadProjects: (): Promise<{ projects: unknown[] }> => ipcRenderer.invoke('projects:load'),
  saveProjects: (data: unknown): Promise<boolean> => ipcRenderer.invoke('projects:save', data),
  // PSD 文件（字节由渲染层走 psdfile:// 协议直取，不再过 IPC）
  pickPsdPaths: (): Promise<string[]> => ipcRenderer.invoke('psd:pick'),
  importPsds: (paths: string[]) => ipcRenderer.invoke('psd:import', paths),
  fileExists: (p: string): Promise<boolean> => ipcRenderer.invoke('file:exists', p),
  readDataUrl: (p: string): Promise<string | null> => ipcRenderer.invoke('file:read-dataurl', p),
  pathsForFiles: (files: File[]): string[] =>
    files.map((f) => webUtils.getPathForFile(f)).filter((p): p is string => !!p),
  // 导出（bytes 为渲染层编码好的图片字节，结构化克隆直传）
  saveImage: (defaultName: string, format: string, bytes: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('image:save', defaultName, format, bytes),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('dir:pick'),
  writeExportFile: (dir: string, name: string, bytes: Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('file:write-bytes', dir, name, bytes),
  // 存储与缓存
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:open-data-dir'),
  dataStats: (): Promise<{ root: string; total: number; thumbs: number }> =>
    ipcRenderer.invoke('app:data-stats'),
  clearThumbCache: (): Promise<number> => ipcRenderer.invoke('app:clear-thumb-cache'),
  // 更新检查
  checkUpdate: (): Promise<
    | { status: 'new'; version: string; url: string; notes: string }
    | { status: 'latest' }
    | { status: 'error' }
  > => ipcRenderer.invoke('app:check-update'),
  // 原生菜单点击 → 渲染层命令分发（与快捷键同源）
  onMenuExec: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('menu:exec', listener)
    return () => ipcRenderer.removeListener('menu:exec', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
