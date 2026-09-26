import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  // 窗口控制
  winMinimize: (): void => ipcRenderer.send('win:minimize'),
  winMaximize: (): void => ipcRenderer.send('win:maximize'),
  winClose: (): void => ipcRenderer.send('win:close'),
  // 项目数据持久化
  loadProjects: (): Promise<{ projects: unknown[] }> => ipcRenderer.invoke('projects:load'),
  saveProjects: (data: unknown): Promise<boolean> => ipcRenderer.invoke('projects:save', data),
  // PSD 文件
  pickPsdPaths: (): Promise<string[]> => ipcRenderer.invoke('psd:pick'),
  importPsds: (paths: string[]) => ipcRenderer.invoke('psd:import', paths),
  readPsdByPath: (path: string): Promise<{ name: string; buffer: Uint8Array }> =>
    ipcRenderer.invoke('psd:read', path),
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
  // 更新检查
  checkUpdate: (): Promise<{ version: string; url: string; notes: string } | null> =>
    ipcRenderer.invoke('app:check-update'),
  // 原生菜单点击 → 渲染层命令分发（与快捷键同源）
  onMenuExec: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('menu:exec', listener)
    return () => ipcRenderer.removeListener('menu:exec', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
