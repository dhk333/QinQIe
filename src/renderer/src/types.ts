export interface TextInfo {
  content: string
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: string
}

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
  textInfo?: TextInfo
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

export interface ProjectGroup {
  id: string
  name: string
}

export interface ProjectPsd {
  id: string
  name: string
  path: string
  w: number
  h: number
  groupId: string | null
  thumbPath?: string
  missing?: boolean
}

export interface Project {
  id: string
  name: string
  createdAt: number
  groups: ProjectGroup[]
  psds: ProjectPsd[]
}

export interface ProjectsData {
  projects: Project[]
}

export interface DocSlice {
  id: string
  no: string
  x: number
  y: number
  w: number
  h: number
}
