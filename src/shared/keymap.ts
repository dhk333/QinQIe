// 快捷键单一来源：渲染层键盘 handler、? 帮助面板、右键菜单提示、主进程原生菜单 accelerator 全部由此生成。
// 修改键位只改这里；display 用于 UI 展示，accelerator 用于 Electron 菜单语法。

export interface Chord {
  /** 归一化后的按键：单字符小写，或 'Delete' | 'Backspace' | 'Escape' | 'ArrowLeft'... */
  key?: string
  /** 需要按物理键码匹配时（Shift+数字在不同布局符号不同）用 code，如 'Digit1' */
  code?: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export interface KeyCommand {
  id: string
  label: string
  group: '工具' | '视图' | '选择' | '编辑' | '图层' | '导出' | '界面'
  display: string
  accelerator?: string
  chords: Chord[]
}

export const KEY_COMMANDS: KeyCommand[] = [
  { id: 'tool.move', label: '选择 / 移动工具', group: '工具', display: 'V',
    accelerator: 'V', chords: [{ key: 'v' }] },
  { id: 'tool.slice', label: '切片工具', group: '工具', display: 'S',
    accelerator: 'S', chords: [{ key: 's' }, { key: 'c' }] },
  { id: 'tool.picker', label: '取色器', group: '工具', display: 'I',
    accelerator: 'I', chords: [{ key: 'i' }] },
  { id: 'tool.hand', label: '抓手工具', group: '工具', display: 'H',
    accelerator: 'H', chords: [{ key: 'h' }] },

  {
    id: 'view.zoomIn',
    label: '放大画布',
    group: '视图',
    display: 'Ctrl +',
    accelerator: 'CommandOrControl+=',
    chords: [
      { key: '=', ctrl: true },
      { key: '+', ctrl: true },
      { key: '+', ctrl: true, shift: true }
    ]
  },
  {
    id: 'view.zoomOut',
    label: '缩小画布',
    group: '视图',
    display: 'Ctrl -',
    accelerator: 'CommandOrControl+-',
    chords: [{ key: '-', ctrl: true }]
  },
  {
    id: 'view.zoom100',
    label: '缩放至 100%',
    group: '视图',
    display: 'Ctrl+0',
    accelerator: 'CommandOrControl+0',
    chords: [{ key: '0', ctrl: true }]
  },
  {
    id: 'view.fit',
    label: '缩放以适应画布',
    group: '视图',
    display: 'Shift+1',
    accelerator: 'Shift+1',
    chords: [{ code: 'Digit1', shift: true }]
  },
  {
    id: 'view.zoomSel',
    label: '缩放至所选',
    group: '视图',
    display: 'Shift+2',
    accelerator: 'Shift+2',
    chords: [{ code: 'Digit2', shift: true }]
  },
  {
    id: 'view.slices',
    label: '显示 / 隐藏切片',
    group: '视图',
    display: 'Shift+S',
    accelerator: 'Shift+S',
    chords: [{ key: 's', shift: true }]
  },

  {
    id: 'sel.all',
    label: '全选（切片 / 可见图层）',
    group: '选择',
    display: 'Ctrl+A',
    accelerator: 'CommandOrControl+A',
    chords: [{ key: 'a', ctrl: true }]
  },
  { id: 'sel.clear', label: '取消选择 / 退回选择工具', group: '选择', display: 'Esc',
    accelerator: 'Escape', chords: [{ key: 'Escape' }] },
  {
    id: 'sel.delete',
    label: '删除所选切片',
    group: '选择',
    display: 'Delete',
    accelerator: 'Delete',
    chords: [{ key: 'Delete' }, { key: 'Backspace' }]
  },

  { id: 'edit.undo', label: '撤销', group: '编辑', display: 'Ctrl+Z',
    accelerator: 'CommandOrControl+Z', chords: [{ key: 'z', ctrl: true }] },
  {
    id: 'edit.redo',
    label: '重做',
    group: '编辑',
    display: 'Ctrl+Shift+Z',
    accelerator: 'CommandOrControl+Shift+Z',
    chords: [{ key: 'z', ctrl: true, shift: true }, { key: 'y', ctrl: true }]
  },
  {
    id: 'slice.rename',
    label: '重命名所选切片',
    group: '编辑',
    display: 'Ctrl+R',
    accelerator: 'CommandOrControl+R',
    chords: [{ key: 'r', ctrl: true }]
  },
  {
    id: 'slice.dup',
    label: '复制所选切片',
    group: '编辑',
    display: 'Ctrl+D',
    accelerator: 'CommandOrControl+D',
    chords: [{ key: 'd', ctrl: true }]
  },
  { id: 'slice.nudge', label: '微调所选切片（Shift 为 10px）', group: '编辑', display: '方向键', chords: [] },
  { id: 'slice.dupDrag', label: '复制并拖动切片', group: '编辑', display: 'Alt+拖拽', chords: [] },

  {
    id: 'layer.hide',
    label: '隐藏 / 显示所选图层',
    group: '图层',
    display: 'Ctrl+Shift+H',
    accelerator: 'CommandOrControl+Shift+H',
    chords: [{ key: 'h', ctrl: true, shift: true }]
  },
  {
    id: 'layer.collapse',
    label: '展开 / 收起全部图层分组',
    group: '图层',
    display: 'Alt+L',
    accelerator: 'Alt+L',
    chords: [{ key: 'l', alt: true }]
  },

  {
    id: 'export.batch',
    label: '批量导出（所选切片 / 可见图层）',
    group: '导出',
    display: 'Ctrl+Shift+E',
    accelerator: 'CommandOrControl+Shift+E',
    chords: [{ key: 'e', ctrl: true, shift: true }]
  },

  {
    id: 'panel.toggle',
    label: '折叠 / 展开两侧面板',
    group: '界面',
    display: 'Ctrl+\\',
    accelerator: 'CommandOrControl+\\',
    chords: [{ key: '\\', ctrl: true }]
  },
  {
    id: 'search.focus',
    label: '聚焦图层搜索',
    group: '界面',
    display: 'Ctrl+F',
    accelerator: 'CommandOrControl+F',
    chords: [{ key: 'f', ctrl: true }]
  },
  {
    id: 'help.toggle',
    label: '快捷键一览',
    group: '界面',
    display: '?',
    accelerator: '?',
    chords: [{ key: '?' }, { key: '?', shift: true }]
  }
]

export const COMMAND_MAP: Record<string, KeyCommand> = Object.fromEntries(
  KEY_COMMANDS.map((c) => [c.id, c])
)

// ========== 用户自定义覆盖 ==========
// 渲染层从 localStorage 读入后调 setUserOverrides；主进程不设置，永远走默认。
let overrides: Record<string, Chord[]> = {}

export function setUserOverrides(map: Record<string, Chord[]>): void {
  overrides = map
}
export function getOverride(id: string): Chord[] | undefined {
  return overrides[id]
}
export function hasOverrides(): boolean {
  return Object.keys(overrides).length > 0
}

export function effectiveChords(cmd: KeyCommand): Chord[] {
  return overrides[cmd.id] ?? cmd.chords
}

const MOD_LABEL: (keyof Chord)[] = ['ctrl', 'alt', 'shift']
export function formatChord(ch: Chord): string {
  const mods: string[] = []
  if (ch.ctrl) mods.push('Ctrl')
  if (ch.alt) mods.push('Alt')
  if (ch.shift) mods.push('Shift')
  let base: string
  if (ch.code) {
    base = /^Digit\d$/.test(ch.code) ? ch.code.slice(5) : ch.code
  } else {
    base = ch.key ?? ''
    base = base.length === 1 ? base.toUpperCase() : base
  }
  return [...mods, base].join('+')
}

export function effectiveDisplay(cmd: KeyCommand): string {
  const ov = overrides[cmd.id]
  if (!ov || !ov.length) return cmd.display
  return ov.map(formatChord).join(' / ')
}

const IGNORED_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'Unidentified'])

/** 把一次 keydown 归一化成 Chord；纯修饰键按下返回 null（继续等待） */
export function chordFromEvent(e: KeyEventLike): Chord | null {
  if (IGNORED_KEYS.has(e.key)) return null
  // 未修饰的 F 键/特殊键也允许（如 F2、Escape 单键在某些场景无意义，但保持一致性）
  const chord: Chord = {}
  if (e.ctrlKey || e.metaKey) chord.ctrl = true
  if (e.altKey) chord.alt = true
  if (e.shiftKey) chord.shift = true
  // Shift+数字/符号在不同布局下产生不同 key，落 code 更稳
  if (e.shiftKey && /^Digit\d$/.test(e.code ?? '')) {
    chord.code = e.code
  } else {
    chord.key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  }
  // 只按了 Shift 修饰的组合若既无字符也无 code（罕见），忽略
  if (!chord.key && !chord.code) return null
  return chord
}

interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** 找出与指定 chord 冲突的其他命令（按各自当前生效键位判断） */
export function findChordConflict(cmdId: string, chord: Chord): KeyCommand | null {
  const fake: KeyEventLike = {
    key: chord.key ?? '',
    code: chord.code,
    ctrlKey: !!chord.ctrl,
    metaKey: false,
    shiftKey: !!chord.shift,
    altKey: !!chord.alt
  }
  for (const cmd of KEY_COMMANDS) {
    if (cmd.id === cmdId) continue
    if (effectiveChords(cmd).some((c) => chordMatch(c, fake))) return cmd
  }
  return null
}

function chordMatch(chord: Chord, e: KeyEventLike): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl !== !!chord.ctrl) return false
  if (e.shiftKey !== !!chord.shift) return false
  if (e.altKey !== !!chord.alt) return false
  if (chord.code) return e.code === chord.code
  if (!chord.key) return false
  // Shift 会把数字/符号键变成上档字符，key 匹配失败时交给 code 分支的调用方处理
  return e.key.toLowerCase() === chord.key.toLowerCase()
}

export function matchCommand(e: KeyEventLike): KeyCommand | null {
  // 自定义覆盖优先：两组扫描，先扫有 override 的命令
  for (const cmd of KEY_COMMANDS) {
    if (overrides[cmd.id] && overrides[cmd.id].some((c) => chordMatch(c, e))) return cmd
  }
  for (const cmd of KEY_COMMANDS) {
    if (!overrides[cmd.id] && cmd.chords.some((c) => chordMatch(c, e))) return cmd
  }
  return null
}
