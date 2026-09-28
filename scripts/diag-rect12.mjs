// 证据脚本：7-2招聘岗位「矩形 12」圆角编辑无视觉变化 + 面板宽高/圆角测量不准。
// 直接跑应用侧 psd.ts 的同一套测量代码，并算多种阈值/估法，确定正确算法后再改。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-rect12.mjs [psd路径] [图层名关键字]
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.document = { createElement: () => createCanvas(1, 1) }
globalThis.ImageData = (await import('@napi-rs/canvas')).ImageData ?? globalThis.ImageData
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
globalThis.ImageBitmap = class ImageBitmap {}

const { parsePsd, decodeLayerCanvases, flattenLayers, measureLayerContent, indexRNodes } =
  await import('../src/renderer/src/lib/psd.ts')

const file =
  process.argv[2] ?? 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
const keyword = process.argv[3] ?? '矩形 12'

const buf = new Uint8Array(await readFile(file))
const s1 = parsePsd(buf, basename(file), true)
const { canvasMap, rnodes } = decodeLayerCanvases(buf, s1.tree)
const all = flattenLayers(s1.tree)
const hits = all.filter((l) => l.type === 'layer' && (l.name ?? '').includes(keyword))
console.log(basename(file), `${s1.doc.width}x${s1.doc.height}，匹配「${keyword}」${hits.length} 个`)

for (const layer of hits) {
  const canvas = canvasMap.get(layer.id)
  console.log(`\n── 「${layer.name}」id=${layer.id} 位图边界 [${Math.round(layer.left)},${Math.round(layer.top)}] ${layer.width}x${layer.height}`)
  if (!canvas) {
    console.log('   无位图（可能剪贴蒙版/空层）')
    continue
  }
  console.log('   measureLayerContent:', JSON.stringify(measureLayerContent(canvas)))
  const W = canvas.width
  const H = canvas.height
  const d = canvas.getContext('2d').getImageData(0, 0, W, H).data
  const A = (x, y) => d[(y * W + x) * 4 + 3]
  const bbox = (t) => {
    let l = 0, tp = 0, r = W - 1, b = H - 1
    while (l < W && !colAny(tp, b, l, t)) l++
    while (b > tp && !rowAny(l, r, b, t)) b--
    while (r > l && !colAny(tp, b, r, t)) r--
    while (tp < b && !rowAny(l, r, tp, t)) tp++
    return { l, tp, r, b, w: r - l + 1, h: b - tp + 1 }
    function rowAny(x0, x1, y, t) { for (let x = x0; x <= x1; x++) if (A(x, y) > t) return true; return false }
    function colAny(y0, y1, x, t) { for (let y = y0; y <= y1; y++) if (A(x, y) > t) return true; return false }
  }
  for (const t of [8, 60, 128, 240]) {
    const bb = bbox(t)
    console.log(`   阈值>${String(t).padStart(3)}: 内容左上(${bb.l},${bb.tp}) ${bb.w}x${bb.h}`)
  }
  // 圆角多估法：取内框后
  const bb = bbox(128)
  const { l: L, tp: T, r: R, b: B } = bb
  // 旧估法：左列首个不透明行偏移
  let y0 = 0
  while (y0 < B - T && A(L, T + y0) <= 8) y0++
  // 弧拟合：每行 x 偏移 → r=(x²+y²)/(2(r? )) 设圆角圆：顶部行 y 处左缘 x，则 (r-x)² + (r-y)² = r² → r=(x²+y²-2... 用标准式
  const est = []
  for (let y = 1; y <= 40; y++) {
    let x = 0
    while (x < 80 && A(L + x, T + y) <= 128) x++
    if (x === 0) break
    // 圆在 (r, r) 半径 r：(x-r)²+(y-r)²=r² → r² -2r(x+y) +x²+y² =0 → r=(x²+y²)/(2(x+y))
    est.push((x * x + y * y) / (2 * (x + y)))
  }
  const med = est.length ? est.slice().sort((a, b) => a - b)[est.length >> 1] : 0
  console.log(`   旧估法(左列首个不透明,y<=64): ${y0}px；128 阈值弧拟合中位数: ${med.toFixed(1)}px（样本 ${est.length}）`)
  // 每行左缘偏移前 12 行，人工核对
  const prof = []
  for (let y = 0; y < 12; y++) {
    let x = 0
    while (x < 80 && A(L + x, T + y) <= 128) x++
    prof.push(x)
  }
  console.log('   顶部每行左缘偏移:', prof.join(','))
  const rn = indexRNodes(rnodes).get(layer.id)
  console.log(`   RNode: radius=${rn?.radius} effects=${rn?.effects ? Object.keys(rn.effects).join('/') : '无'}`)
}
