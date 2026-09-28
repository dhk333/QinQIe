// 工具图形唯一数据源：工具栏按钮和画布自定义光标必须画同一枚形状，各抄一份就会在换行拼接时丢掉数字间的空格。
// viewBox 是用 getBBox 实测的内容框（照抄 24 网格会把图形挤小），tip 是光标「笔尖」在 viewBox 里的坐标。
import { KNIFE_D, KNIFE_TIP, KNIFE_VIEWBOX } from './knifeShape'

export interface ToolGlyph {
  viewBox: string
  tip: { x: number; y: number }
  /** 闭合图形：白填 + 深色描边 */
  solid?: string[]
  /** 线条图形：先粗深色打底、再细浅色上身，深浅底色上都看得清 */
  line?: string[]
  /** line 的浅色线宽（viewBox 单位，与工具栏图标一致） */
  stroke?: number
  /** 深色比浅色每侧多出多少像素 */
  halo?: number
}

export const CURSOR_TOOLS = ['move', 'slice', 'picker', 'hand'] as const
export type CursorTool = (typeof CURSOR_TOOLS)[number]

export const TOOL_GLYPHS: Record<CursorTool, ToolGlyph> = {
  move: {
    viewBox: '1.5 1 21 21',
    tip: { x: 6, y: 3 },
    solid: ['M6 3l12 9-5.5 1L15 19l-2.5 1-2.4-5.8L6 17V3Z']
  },
  slice: {
    viewBox: KNIFE_VIEWBOX,
    tip: KNIFE_TIP,
    solid: [KNIFE_D]
  },
  picker: {
    viewBox: '2 0.8 21.2 21.2',
    tip: { x: 4, y: 20 },
    solid: ['M13.5 6.5l4 4L8 20H4v-4l9.5-9.5Z'],
    line: ['M11.5 8.5l4 4M15 3.5a2.1 2.1 0 0 1 3 0l2.5 2.5a2.1 2.1 0 0 1 0 3L19 10.5'],
    stroke: 1.6,
    halo: 0.4
  },
  hand: {
    viewBox: '0.5 1 22 22',
    tip: { x: 11.5, y: 12 },
    line: [
      'M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m-9-1v-1.5a1.5 1.5 0 0 0-3 0V16a5 5 0 0 0 5 5h3a5 5 0 0 0 5-5v-2'
    ],
    stroke: 1.6,
    halo: 0.35
  }
}

/** 工具栏图标只要线条，不区分 solid/line */
export function glyphPaths(g: ToolGlyph): string[] {
  return [...(g.solid ?? []), ...(g.line ?? [])]
}
