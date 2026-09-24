export interface PsdLayer {
  id: number
  name: string
  type: 'group' | 'layer'
  left: number
  top: number
  width: number
  height: number
  opacity: number
  hidden: boolean
  isText: boolean
  clipping: boolean
  blendMode: string
  children?: PsdLayer[]
}

export interface PsdDoc {
  fileName: string
  width: number
  height: number
}

export type ExportFormat = 'png' | 'jpeg' | 'webp'
