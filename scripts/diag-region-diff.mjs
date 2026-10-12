// 区域差异定位：打印 ours 与 PS 内嵌合成图差异最大的像素坐标与颜色。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-region-diff.mjs [psd] [x y w h] [topN]
// 环境变量 EXCL=x,y,w,h：排除该矩形（例如框内的文字），用来单独验证渐变/形状本身是否逐像素正确。
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { buildRNode, compositeRegion } from '../src/renderer/src/lib/compositor.ts'

initializeCanvas((w, h) => createCanvas(w, h))
const [, , file = '', xs, ys, ws, hs, topN = '20'] = process.argv
const [RX, RY, RW, RH] = [Number(xs), Number(ys), Number(ws), Number(hs)]
const PAD = 4
const region = { x: RX - PAD, y: RY - PAD, w: RW + PAD * 2, h: RH + PAD * 2 }
const doc = readPsd(await readFile(file), { skipLinkedFilesData: true, skipThumbnail: true })
let seq = 0
const tree = doc.children.map((l) => buildRNode(l, () => ++seq))
const env = { createCanvas: (w, h) => createCanvas(w, h) }
const a = compositeRegion(tree, { env }, region).getContext('2d').getImageData(0, 0, region.w, region.h).data
const b = doc.canvas.getContext('2d').getImageData(region.x, region.y, region.w, region.h).data
const hex = (d, i) => `#${[0, 1, 2].map((k) => d[i + k].toString(16).padStart(2, '0')).join('')}`
const EXCL = (process.env.EXCL || '').split(',').map(Number)
const excluded = (px, py) =>
  EXCL.length === 4 && px >= EXCL[0] && px < EXCL[0] + EXCL[2] && py >= EXCL[1] && py < EXCL[1] + EXCL[3]
const rows = []
for (let y = 0; y < region.h; y++)
  for (let x = 0; x < region.w; x++) {
    const i = (y * region.w + x) * 4
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    if (d > 20 && !excluded(region.x + x, region.y + y))
      rows.push({ x: region.x + x, y: region.y + y, d, o: hex(a, i), p: hex(b, i), oa: a[i + 3], pa: b[i + 3] })
  }
rows.sort((p, q) => q.d - p.d)
let sum = 0
let n = 0
let skipped = 0
for (let y = 0; y < region.h; y++)
  for (let x = 0; x < region.w; x++) {
    if (excluded(region.x + x, region.y + y)) {
      skipped++
      continue
    }
    const i = (y * region.w + x) * 4
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
    n++
  }
console.log(
  `区域 ${RX},${RY} ${RW}×${RH}  平均偏差 ${(sum / (n * 3)).toFixed(3)}/255，差异>20 的像素 ${rows.length} 个${
    skipped ? `（已排除 ${skipped} 个像素）` : ''
  }`
)
for (const r of rows.slice(0, Number(topN))) console.log(`(${r.x},${r.y})  ours=${r.o}/${r.oa}  ps=${r.p}/${r.pa}  Δ=${r.d}`)
