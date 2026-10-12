// 全画布差异归因（AA 判定）：差异像素是否只出现在「有图层带部分 alpha」的地方。
// 若某差异点上所有覆盖图层都是实心（alpha=255）或全空，则不是抗锯齿，而是真正的绘制错误。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-aa-attribution.mjs [psd] [阈值20]
// 结论参考：4-2 详情页剩余差异里 99.3% 落在文字/字形边缘，PS 合成用的抗锯齿与它自己存进图层通道的位图并不完全一致，
// 背景（无字像素）最大偏差只有 3/255，所以这类残差不是我们的合成错误。
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { buildRNode, compositeDocument } from '../src/renderer/src/lib/compositor.ts'

initializeCanvas((w, h) => createCanvas(w, h))
const file =
  process.argv[2] || 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\4-2 新闻资讯--公司动态--详情.psd'
const TH = Number(process.argv[3] || 20)

const doc = readPsd(await readFile(file), { skipLinkedFilesData: true, skipThumbnail: true })
const env = { createCanvas: (w, h) => createCanvas(w, h) }
let seq = 0
const tree = doc.children.map((l) => buildRNode(l, () => ++seq))
const ours = compositeDocument(tree, { env }, { width: doc.width, height: doc.height })
const W = doc.width
const H = doc.height
const A = ours.getContext('2d').getImageData(0, 0, W, H).data
const B = doc.canvas.getContext('2d').getImageData(0, 0, W, H).data

// 每个可见叶子图层的 alpha 通道（按文档坐标取样）
const leaves = []
const walk = (layers, path) => {
  for (const l of layers ?? []) {
    const p = `${path}/${l.name ?? '?'}`
    if (l.children) walk(l.children, p)
    else if (!l.hidden && l.canvas) {
      const w = l.canvas.width
      const h = l.canvas.height
      const d = l.canvas.getContext('2d').getImageData(0, 0, w, h).data
      const al = new Uint8Array(w * h)
      for (let p = 0; p < al.length; p++) al[p] = d[p * 4 + 3]
      leaves.push({
        p,
        x0: l.left ?? 0,
        y0: l.top ?? 0,
        w,
        h,
        a: (x, y) => al[(y - (l.top ?? 0)) * w + (x - (l.left ?? 0))]
      })
    }
  }
}
walk(doc.children, '')

let aa = 0
let solid = 0
let none = 0
const solidHits = []
const solidBy = new Map()
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
    if (d <= TH) continue
    let partial = false
    let covered = false
    for (const l of leaves) {
      const lx = x - l.x0
      const ly = y - l.y0
      if (lx < 0 || ly < 0 || lx >= l.w || ly >= l.h) continue
      covered = true
      const al = l.a(x, y)
      if (al > 0 && al < 255) partial = true
    }
    if (partial) aa++
    else if (covered) {
      solid++
      const cover = leaves.filter((l) => x >= l.x0 && y >= l.y0 && x < l.x0 + l.w && y < l.y0 + l.h)
      const top = cover[cover.length - 1]?.p ?? '?'
      solidBy.set(top, (solidBy.get(top) ?? 0) + 1)
      if (solidHits.length < 15)
        solidHits.push(
          `(${x},${y}) ours=#${[0, 1, 2].map((k) => A[i + k].toString(16).padStart(2, '0')).join('')}/${A[i + 3]} ps=#${[0, 1, 2].map((k) => B[i + k].toString(16).padStart(2, '0')).join('')}/${B[i + 3]} Δ=${d} @${cover.map((l) => l.p).join(' + ')}`
        )
    } else none++
  }
console.log(`Δ>${TH} 的差异像素：抗锯齿（有图层部分 alpha）${aa} 个 ｜ 实心处 ${solid} 个 ｜ 无图层覆盖 ${none} 个`)
for (const h of solidHits) console.log('  实心 ' + h)
console.log('\n实心差异按最上层图层归并：')
for (const [k, n] of [...solidBy.entries()].sort((p, q) => q[1] - p[1]).slice(0, 10)) console.log(`  ${n} 个  ${k}`)
