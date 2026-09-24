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
  // 导出
  saveImage: (defaultName: string, format: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('image:save', defaultName, format, dataUrl),
  pickDir: (): Promise<string | null> => ipcRenderer.invoke('dir:pick'),
  saveBatchImages: (files: { name: string; dataUrl: string }[]): Promise<{ saved: number } | null> =>
    ipcRenderer.invoke('images:save-batch', files)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
