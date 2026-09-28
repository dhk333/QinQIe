// 可视化「矩形 12」位图：ASCII 打印 alpha/颜色，人工判断用户眼中的实际外形尺寸。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-ascii.mjs [psd] [layerKey]
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.document = { createElement: () => createCanvas(1, 1) }
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
globalThis.ImageBitmap = class ImageBitmap {}

const { parsePsd, decodeLayerCanvases, flattenLayers, measureLayerContent } = await import(
  '../src/renderer/src/lib/psd.ts'
)

const file = process.argv[2] ?? 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
const key = process.argv[3] ?? 'i4581'

const buf = new Uint8Array(await readFile(file))
const s1 = parsePsd(buf, basename(file), true)
const { canvasMap } = decodeLayerCanvases(buf, s1.tree)
const leaf = flattenLayers(s1.tree).find((l) => l.key === key)
const canvas = canvasMap.get(leaf.id)
const W = canvas.width
const H = canvas.height
const d = canvas.getContext('2d').getImageData(0, 0, W, H).data
console.log(`${leaf.name} 位图 ${W}x${H}`)
console.log('measureLayerContent:', JSON.stringify(measureLayerContent(canvas)))

// 每行：首个/末个 alpha>128 的列；以及该行 alpha>=250 的最左/最右
const rows = []
for (let y = 0; y < H; y++) {
  let a = -1
  let b = -1
  for (let x = 0; x < W; x++) {
    const v = d[(y * W + x) * 4 + 3]
    if (v > 128) {
      if (a < 0) a = x
      b = x
    }
  }
  rows.push([a, b])
}
console.log('每行 [首,末] alpha>128:')
console.log(rows.map((r, i) => `${String(i).padStart(2)}:${String(r[0]).padStart(3)},${String(r[1]).padStart(3)}`).join('  '))

// 每列同理
const cols = []
for (let x = 0; x < W; x++) {
  let a = -1
  let b = -1
  for (let y = 0; y < H; y++) {
    const v = d[(y * W + x) * 4 + 3]
    if (v > 128) {
      if (a < 0) a = y
      b = y
    }
  }
  cols.push([a, b])
}
console.log('每列 [首,末] alpha>128:')
console.log(cols.map((r, i) => `${String(i).padStart(2)}:${String(r[0]).padStart(3)},${String(r[1]).padStart(3)}`).join('  '))

// 左缘 alpha 值（第 2 行到第 20 行，前 8 列）——看抗锯齿过渡带
console.log('左上角 alpha 矩阵 (行 0..11, 列 0..11):')
for (let y = 0; y < 12; y++) {
  const line = []
  for (let x = 0; x < 12; x++) line.push(String(d[(y * W + x) * 4 + 3]).padStart(3))
  console.log(`  ${String(y).padStart(2)} ` + line.join(''))
}
// 颜色样本（内容中心一行）
const mid = H >> 1
console.log('中间行颜色采样 (x=2,10,30,70,130,139):')
for (const x of [2, 10, 30, 70, 130, 139]) {
  const i = (mid * W + x) * 4
  console.log(`  x=${x}: rgb(${d[i]},${d[i + 1]},${d[i + 2]}) a=${d[i + 3]}`)
}
