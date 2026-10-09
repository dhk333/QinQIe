export default {
  // 加载与解析 toast
  '加载 PSD 失败': 'Failed to load PSD',
  '主解析器不支持该文件，已使用备用解析器': 'This file is not supported by the main parser; the fallback parser was used',
  '图层位图解码失败': 'Failed to decode layer bitmaps',
  '图层还在解析中，请稍后导出': 'Layers are still being decoded, please export shortly',
  '图层解析中…': 'decoding layers…',
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
  '切片工具 (S) — 拖拽画切片，自动贴边图层/切片边缘（Ctrl 暂时关闭）': 'Slice tool (S) — drag to draw a slice; edges snap to layers/slices (hold Ctrl to disable)',
  '取色器 (I) — 点击画布取色并复制': 'Picker (I) — click the canvas to copy a color',
  '抓手 (H) — 拖拽平移': 'Hand (H) — drag to pan',
  '显示 / 隐藏切片': 'Show / hide slices',
  // 切片右键菜单与选项弹窗
  '编辑切片选项…': 'Edit slice options…',
  '删除切片': 'Delete slice',
  '切片选项': 'Slice Options',
  '缩小': 'Zoom out',
  '放大': 'Zoom in',
  '适应画布 (Shift+1)': 'Zoom to fit (Shift+1)',
  '缩放至 100% (Ctrl+0)': 'Zoom to 100% (Ctrl+0)',
  '快捷键一览 (?)': 'Keyboard shortcuts (?)',
  // 切图基准宽度（缩放条弹层）
  '切图基准宽度 — 画布、切片与 CSS 都按这个宽度出图，高度按设计稿等比自动':
    'Slice basis width — canvas, slices and CSS all output at this width; the height follows the artboard ratio',
  '切图基准宽度': 'Slice Basis Width',
  '原稿': 'Original',
  '跟随原稿': 'Follow original',
  '设计稿': 'Artboard',
  '出图口径': 'Output',
  '切片与图层的 X/Y/W/H、导出像素、复制的 CSS 全部换算到这个宽度；内部仍存 PSD 原始像素，改回原稿不丢切片':
    'Slice / layer X/Y/W/H, exported pixels and copied CSS are converted to this width. Coordinates stay in original PSD pixels, so switching back never loses slices',
  '按基准宽度 {w}px 计': 'Measured at the {w}px basis width',
  '基准 {w}px': 'Basis {w}px',
  // 切片导出空状态 toast
  '还没有切片，用切片工具在画布上拖拽创建': 'No slices yet — drag on the canvas with the Slice tool to create one',
  // 导出进度浮层
  '正在导出': 'Exporting',
  '取消': 'Cancel',
  // 属性面板：图层编辑（Figma 式改属性，不回写 PSD）
  '恢复 PSD 原值': 'Reset to the PSD value',
  '重置本图层的全部编辑': 'Reset all edits on this layer',
  '重置': 'Reset',
  '图层名': 'Layer name',
  '变换': 'Transform',
  '组的尺寸由子图层决定，不能直接改': 'A group is sized by its layers — this can’t be set directly',
  '锁定宽高比': 'Lock aspect ratio',
  '圆角': 'Radius',
  '四角统一的圆角半径，导出位图与 CSS 都按它裁切':
    'Corner radius applied to both the exported bitmap and the CSS',
  '四角统一的圆角半径，导出位图与 CSS 都按它裁切；未编辑时显示从位图 alpha 估算的原值':
    'Corner radius applied to both the exported bitmap and the CSS; before you edit it, the value is estimated from the bitmap alpha',
  '外观': 'Appearance',
  '边框': 'Border',
  '无': 'None',
  '宽度': 'Width',
  '边框宽度，0 即不加边框': 'Border width; 0 removes the border',
  '内侧': 'Inside',
  '居中': 'Center',
  '外侧': 'Outside',
  '角度': 'Angle',
  '光源方向，与 PS 内建投影同义': 'Light direction, same as the built-in PS drop shadow',
  '距离': 'Distance',
  '大小': 'Size',
  '投影模糊半径': 'Shadow blur radius',
  '阻塞': 'Choke',
  '投影实心程度': 'How solid the shadow stays',
  '把本文档所有图层恢复到 PSD 原值': 'Restore every layer in this document to its PSD values',
  '清空本文档编辑': 'Clear layer edits',
  '清空本文档的图层编辑？': 'Clear all layer edits in this document?',
  '所有图层回到 PSD 原值，可用 Ctrl+Z 撤销。':
    'Every layer returns to its PSD values. Undo with Ctrl+Z.',
  '清空': 'Clear',
  // 图层树：手动隐藏恢复条
  '{n} 个图层被手动隐藏': '{n} layers manually hidden',
  '恢复到 PSD 原始的图层显隐状态': 'Restore the original PSD layer visibility',
  '恢复': 'Restore'
} as Record<string, string>
