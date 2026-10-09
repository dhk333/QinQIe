export interface TextInfo {
  content: string
  fontSize?: number
  color?: string
  fontFamily?: string
  fontWeight?: string
  /** 行距（px），来自 PS leading */
  leading?: number
  /** 字距（PS tracking，单位 1/1000 em） */
  tracking?: number
}

export interface PsdLayer {
  id: number
  /** 跨会话稳定的图层标识：优先 Photoshop lyid，缺失时退回解析路径。编辑量按它持久化 */
  key: string
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
  /** 由编辑投影写入的「本层生效的编辑量」，供面板回显哪几项被改过、CSS 生成取用。
   *  改过名之后 layer.name 已是新名，只有这里还留着 baseName，写回时靠它续上同一条编辑 */
  edit?: LayerEdit
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
  /** 手工切片，随项目持久化 */
  slices?: DocSlice[]
  /** 切图基准宽度（px）：画布/切片/CSS/导出的口径，缺省跟随设计稿宽度。
   *  图层与切片的坐标始终存 PSD 原始像素，改基准只改「读数与出图倍数」，不会动到已切的区域 */
  basisWidth?: number
  /** 图层编辑量，按 PsdLayer.key 索引；只覆盖渲染输入，不回写 PSD 源文件 */
  layerEdits?: Record<string, LayerEdit>
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
  /** 自定义名，导出文件名优先用它；空则「切片+序号」 */
  name?: string
  /** 覆盖批量导出的格式/倍数；未设则跟随面板参数 */
  format?: ExportFormat
  scale?: number
}

/** 边框：几何语义与 PS/Figma 的 inside-center-outside 一致 */
export interface BorderEdit {
  size: number
  color: string
  opacity: number
  position: 'inside' | 'center' | 'outside'
}

/** 投影：角度为光源方向，与 PSD 内建投影同一套换算 */
export interface ShadowEdit {
  color: string
  opacity: number
  angle: number
  distance: number
  size: number
  choke: number
}

/**
 * 单个图层的编辑量。字段缺省即「跟随 PSD 原值」，因此删字段等于重置该项。
 * baseName 记录打标时的图层名：PSD 结构变化后 key 可能指向别的图层，靠它拦下错位。
 */
export interface LayerEdit {
  baseName: string
  name?: string
  /**
   * 相对 PSD 原位置的偏移（文档 px）。用偏移而不是绝对坐标，
   * 是为了让「组移动 + 组内图层移动」能各自独立累加，面板写回时只需
   * 「新值 − 当前显示值」，不必反算祖先链的位移。
   */
  dx?: number
  dy?: number
  /** 目标宽高（文档 px）：仅叶子图层生效，组不改尺寸 */
  width?: number
  height?: number
  opacity?: number
  blendMode?: string
  /** 四角统一的圆角半径（px） */
  radius?: number
  border?: BorderEdit
  shadow?: ShadowEdit
}
