// 解析性能基准：ag-psd 全量解码 vs @webtoon/psd 结构解析/懒解码
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import Psd from '@webtoon/psd'

const file = process.argv[2] ?? 'D:/A-戴鸿锟/项目/2026/W-沃尔核材/psd/4-2 新闻资讯--公司动态--详情.psd'
initializeCanvas((w, h) => createCanvas(w, h))

const t = (label, fn) => {
  const s = performance.now()
  const r = fn()
  console.log(`${label}: ${(performance.now() - s).toFixed(0)}ms`)
  return r
}

const buf = t('readFile', () => readFileSync(file))
console.log(`size: ${(buf.length / 1024 / 1024).toFixed(1)}MB`)

// 1) 现状：ag-psd 一次性全解
const ag = t('ag-psd readPsd(全量)', () =>
  readPsd(new Uint8Array(buf), { skipLinkedFilesData: true, skipThumbnail: true })
)
let agLayers = 0
const countAg = (ls) => ls?.forEach((l) => { if (l.canvas) agLayers++; countAg(l.children) })
countAg(ag.children)
console.log('  ag-psd 已解码位图图层数:', agLayers)

// 2) webtoon：仅结构
const wt = t('webtoon Psd.parse(仅结构)', () => Psd.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))

const tAsync = async (label, fn) => {
  const s = performance.now()
  const r = await fn()
  console.log(`${label}: ${(performance.now() - s).toFixed(0)}ms`)
  return r
}

// 3) webtoon：懒解码全部可见叶子图层（最坏情况=首屏全渲染）
const leaves = []
const walk = (nodes) => { for (const n of nodes) { if (n.type === 'Group') walk(n.children); else if (!n.isBroken && !n.isHidden && n.width > 0 && n.height > 0) leaves.push(n) } }
walk(wt.children)
await tAsync(`webtoon composite 全部可见层(${leaves.length})`, async () => {
  for (const l of leaves) await l.composite(false, true)
})

// 4) webtoon：只解前 10 层（懒加载首屏近似）
await tAsync('webtoon composite 前 10 层', async () => {
  for (const l of leaves.slice(0, 10)) await l.composite(false, true)
})
