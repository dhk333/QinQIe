export default {
  // 加载与解析 toast
  '加载 PSD 失败': 'Failed to load PSD',
  '主解析器不支持该文件，已使用备用解析器': 'This file is not supported by the main parser; the fallback parser was used',
  '图层位图解码失败': 'Failed to decode layer bitmaps',
  '图层还在解析中，请稍后导出': 'Layers are still being decoded, please export shortly',
  '加载中，马上就好…': 'Loading, almost there…',
  // 左侧图层面板
  '图 层': 'Layers',
  // 右键菜单
  '导出所选 {n} 个图层…': 'Export {n} selected layers…',
  '从图层创建切片': 'Create slice from layer',
  '隔离显示': 'Isolate',
  '显示全部图层': 'Show all layers',
  '已从图层创建 {n} 个切片': 'Created {n} slices from layers',
  '已隔离显示 {n} 个图层/组': 'Isolated {n} layers/groups',
  // 导出 toast
  '没有可导出的内容': 'Nothing to export',
  '已取消，导出 {saved} / {total} 个文件': 'Cancelled — exported {saved} / {total} files',
  '已导出 {saved} 个文件到所选目录': 'Exported {saved} files to the selected folder',
  '该图层没有可导出的位图内容（文本或空图层）': 'This layer has no exportable bitmap content (text or empty layer)',
  '该图层导出失败': 'Failed to export this layer',
  '已导出 {file}': 'Exported {file}',
  // 取色 toast
  '已取色 {hex} 并复制到剪贴板': 'Picked {hex} and copied to clipboard',
  // 命名模板对话框
  '命名模板': 'Naming template',
  '可用变量：{名称} {倍数} {格式} {序号}': 'Available variables: {名称} {倍数} {格式} {序号}',
  '命名模板已更新': 'Naming template updated',
  // 底部批量导出条
  '共': 'Total',
  '个切片': 'slices',
  ' · 已选 {n} 个': ' · {n} selected',
  '个可见图层': 'visible layers',
  '批量导出': 'Batch export',
  // 切片编辑器
  '切片{no}': 'Slice {no}',
  '切片名，导出文件名用它': 'Slice name; used for the exported file name',
  '该切片的导出格式（默认跟随批量设置）': 'Export format for this slice (follows batch settings by default)',
  '格式·跟随': 'Format · follows batch',
  '该切片的导出倍数（默认跟随批量设置）': 'Export scale for this slice (follows batch settings by default)',
  '倍数·跟随': 'Scale · follows batch',
  '删除': 'Delete',
  // 导出弹层
  '格式': 'Format',
  '倍数': 'Scale',
  '质量': 'Quality',
  '导出 {n} 个文件': 'Export {n} files',
  // 画布工具栏 title
  '移动 / 选择图层 (V)': 'Move / select layers (V)',
  '切片工具 (S) — 拖拽画切片': 'Slice tool (S) — drag to draw a slice',
  '取色器 (I) — 点击画布取色并复制': 'Picker (I) — click the canvas to copy a color',
  '抓手 (H) — 拖拽平移': 'Hand (H) — drag to pan',
  '显示 / 隐藏切片': 'Show / hide slices',
  '缩小': 'Zoom out',
  '放大': 'Zoom in',
  '适应画布 (Shift+1)': 'Zoom to fit (Shift+1)',
  '缩放至 100% (Ctrl+0)': 'Zoom to 100% (Ctrl+0)',
  '快捷键一览 (?)': 'Keyboard shortcuts (?)',
  // 切片导出空状态 toast
  '还没有切片，用切片工具在画布上拖拽创建': 'No slices yet — drag on the canvas with the Slice tool to create one',
  // 导出进度浮层
  '正在导出': 'Exporting',
  '取消': 'Cancel'
} as Record<string, string>
