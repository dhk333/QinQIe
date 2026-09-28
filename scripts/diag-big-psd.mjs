// 诊断「关于我们.psd」黑屏：统计画布分配量，并实测 napi/Skia 能否创建最大单画布与整文档画布。
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvasMod()
function initializeCanvasMod() {
  // 只统计结构，不需要 canvas 后端
}

const file = process.argv[2]
const { readPsd } = await import('ag-psd')
const buf = new Uint8Array(await readFile(file))
console.log(basename(file), (buf.length / 1048576).toFixed(1) + 'MB')

const psd = readPsd(buf, {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipLayerNames: false,
  skipLinkedFilesData: true,
  skipThumbnail: true
})

let maxW = 0, maxH = 0, maxA = 0, maxName = ''
let leaf = 0, group = 0
let totalBytes = 0
const walk = (nodes) => {
  for (const n of nodes ?? []) {
    const w = (n.right ?? 0) - (n.left ?? 0)
    const h = (n.bottom ?? 0) - (n.top ?? 0)
    if (n.children) { group++; walk(n.children) } else {
      leaf++
      totalBytes += w * h * 4
      if (w * h > maxA) { maxA = w * h; maxW = w; maxH = h; maxName = n.name }
    }
  }
}
walk(psd.children)
console.log(`叶子 ${leaf} / 组 ${group}，位图总量 ${(totalBytes / 1048576).toFixed(0)}MB`)
console.log(`最大单层 ${maxName}: ${maxW}x${maxH} (${(maxA * 4 / 1048576).toFixed(0)}MB)`)
console.log(`文档画布 ${psd.width}x${psd.height} (${psd.width * psd.height * 4 / 1048576 | 0}MB)`)

// 逐档实测 Skia 能创建多大画布
const tests = [
  [maxW, maxH, '最大单层'],
  [psd.width, psd.height, '整文档']
]
for (let mb = 256; mb <= 2048; mb *= 2) {
  const side = Math.floor(Math.sqrt((mb * 1048576) / 4))
  tests.push([side, side, `正方 ${mb}MB`])
}
for (const [w, h, label] of tests) {
  try {
    const c = createCanvas(w, h)
    console.log(`OK   ${label}: ${w}x${h}`)
    c._canvas?.delete?.()
  } catch (e) {
    console.log(`FAIL ${label}: ${w}x${h} -> ${e.message}`)
  }
}
