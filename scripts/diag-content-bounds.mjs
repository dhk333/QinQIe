// 证据脚本：对比叶子图层「位图边界」与「alpha 实际内容边界」的差值分布，
// 并按左上角首列首个不透明行的偏移估算圆角半径，回答：
// 1) 面板 W/H 是否普遍比可见内容大几个像素；2) PSD 自带圆角在 alpha 上是否可测。
import { initializeCanvas, readPsd } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))

const file = process.argv[2]
const buf = new Uint8Array(await readFile(file))
const psd = readPsd(buf, { skipLinkedFilesData: true, skipThumbnail: true })
console.log(basename(file), `${psd.width}x${psd.height}`)

const ALPHA_T = 8
// 边缘带最多测 64px：透明留白一般只有几个像素，超大层不必全扫
const BAND = 64
let n = 0
let skipped = 0
let padPx = 0
const pads = []
let rounded = 0
for (const layer of psd.children ?? []) {
  const stack = [layer]
  while (stack.length) {
    const l = stack.pop()
    if (l.children) {
      stack.push(...l.children)
      continue
    }
    const c = l.canvas
    if (!c || !(c.width > 0) || !(c.height > 0)) continue
    let d, W, H
    try {
      W = c.width
      H = c.height
      d = c.getContext('2d').getImageData(0, 0, W, H).data
    } catch {
      skipped++
      continue
    }
    n++
    const A = (x, y) => d[(y * W + x) * 4 + 3]
    // 四条边缘带内找内容边界；整带全透明则记 BAND+（几乎不存在的极端情况按整层处理）
    let top = 0
    while (top < Math.min(H, BAND) && !rowAny(0, W - 1, top)) top++
    let bottom = H - 1
    while (bottom >= H - BAND && bottom > top && !rowAny(0, W - 1, bottom)) bottom--
    let left = 0
    while (left < Math.min(W, BAND) && !colAny(top, bottom, left)) left++
    let right = W - 1
    while (right >= W - BAND && right > left && !colAny(top, bottom, right)) right--
    function rowAny(x0, x1, y) {
      for (let x = x0; x <= x1; x++) if (A(x, y) > ALPHA_T) return true
      return false
    }
    function colAny(y0, y1, x) {
      for (let y = y0; y <= y1; y++) if (A(x, y) > ALPHA_T) return true
      return false
    }
    const dh = bottom - top + 1
    const dw = right - left + 1
    padPx += H - dh + (W - dw)
    pads.push({ name: (l.name ?? '').trim(), w: W, h: H, dw, dh, padL: left, padT: top })
    // 圆角估算：内容左上角起，x=left 列首个不透明行相对 top 的偏移 ≈ 半径
    let rr = 0
    while (rr < Math.min(dw, dh) / 2 && A(left, top + rr) <= ALPHA_T) rr++
    if (rr > 2) {
      rounded++
      if (rounded <= 5) console.log(`  圆角≈${rr}px  「${(l.name ?? '').trim()}」 内容 ${dw}x${dh}`)
    }
  }
}
console.log(`叶子(有位图) ${n}，像素不可读跳过 ${skipped}，平均边界-内容差 ${(padPx / Math.max(1, n)).toFixed(1)}px，alpha 可测圆角层 ${rounded}`)
const withPad = pads.filter((p) => p.w - p.dw > 0 || p.h - p.dh > 0).sort((a, b) => b.w - b.dw + (b.h - b.dh) - (a.w - a.dw + (a.h - a.dh)))
console.log('边界比内容大最多的 8 个：')
for (const p of withPad.slice(0, 8))
  console.log(`  ${p.name.padEnd(18)} 位图 ${p.w}x${p.h} 内容 ${p.dw}x${p.dh} (padL=${p.padL} padT=${p.padT})`)
