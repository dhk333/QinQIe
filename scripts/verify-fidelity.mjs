// PSD 保真度回归：用应用同一份合成器渲染，与 PSD 内嵌的 PS 合成图逐像素比对。
// 用法：node scripts/verify-fidelity.mjs [psd...]   （不带参数时跑默认的三个样本文件）
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { writeFile, mkdir } from 'fs/promises'
import { basename } from 'path'
import { buildRNode, compositeDocument } from '../src/renderer/src/lib/compositor.ts'

initializeCanvas((w, h) => createCanvas(w, h))

const DEFAULTS = [
  'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\4-2 新闻资讯--公司动态--详情.psd',
  'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
]

/**
 * 已知且尚未归零的样本差异上限（差异像素百分比），2026-09-28 在 origin/main 上 A/B 实测：
 * 4-2 详情页 1.347% / 平均偏差 0.297，是抗锯齿级别的累积差，本批改动前就存在。
 * 只用来把「已知」和「新引入的回归」分开——超过这个上限仍然算失败，不许悄悄放宽。
 */
const KNOWN_DIFF_PCT = new Map([['4-2 新闻资讯--公司动态--详情.psd', 1.4]])

const OUT = new URL('./out/', import.meta.url)
await mkdir(OUT, { recursive: true })

let failed = false
for (const file of process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS) {
  const buf = await readFileSafe(file)
  // 样本读不到就等于没跑：必须算失败，否则整条命令会在「零个文件被检查」时输出全部达标
  if (!buf) {
    failed = true
    continue
  }
  const psd = readPsd(buf, { skipLinkedFilesData: true, skipThumbnail: true })
  if (!psd.canvas) {
    console.log(`${basename(file)}: 无内嵌合成图，跳过像素比对`)
    continue
  }
  let seq = 0
  const tree = (psd.children ?? []).map((l) => buildRNode(l, () => ++seq))
  const ours = compositeDocument(tree, { env: { createCanvas: (w, h) => createCanvas(w, h) } }, { width: psd.width, height: psd.height })

  const W = psd.width
  const H = psd.height
  const a = ours.getContext('2d').getImageData(0, 0, W, H).data
  const b = psd.canvas.getContext('2d').getImageData(0, 0, W, H).data

  let diffPx = 0
  let sum = 0
  let max = 0
  let worst = { x: 0, y: 0, score: -1 }
  const cell = 256
  const bands = new Map()
  for (let y = 0; y < H; y++) {
    let rowAcc = 0
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3])
      if (d > 8) diffPx++
      sum += d
      if (d > max) max = d
      rowAcc += d
    }
    const band = Math.floor(y / cell)
    bands.set(band, (bands.get(band) ?? 0) + rowAcc / W)
  }
  const sorted = [...bands.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3)
  const mean = sum / (W * H) / 4
  const pct = (diffPx / (W * H)) * 100
  const budget = KNOWN_DIFF_PCT.get(basename(file))
  const clean = mean < 1 && pct < 1
  const tag = clean ? 'PASS' : budget !== undefined && pct <= budget ? 'KNOWN' : 'FAIL'
  if (tag === 'FAIL') failed = true
  console.log(
    `${tag}  ${basename(file).padEnd(16)} ${W}x${H}  差异像素 ${pct.toFixed(3)}%  平均偏差 ${mean.toFixed(3)}/255  最大 ${max}  最脏带 y=${sorted.map((s) => `${s[0] * cell}-${s[0] * cell + cell}`).join(',')}`
  )
  await writeFile(new URL(`verify-${basename(file)}.ours.png`, OUT), ours.toBuffer('image/png'))
}
console.log(failed ? '\n存在未达标的文件' : '\n全部达标（KNOWN = 已知未归零的差异，未超过记录上限）')

async function readFileSafe(p) {
  try {
    const { readFile } = await import('fs/promises')
    return new Uint8Array(await readFile(p))
  } catch (e) {
    console.log(`读取失败: ${p} (${e.code ?? e.message})`)
    return null
  }
}
