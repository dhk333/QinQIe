import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openPsd: (): Promise<{ name: string; buffer: Uint8Array } | null> =>
    ipcRenderer.invoke('psd:open'),
  saveImage: (defaultName: string, format: string, dataUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('image:save', defaultName, format, dataUrl)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
