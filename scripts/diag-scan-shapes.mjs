// 扫描：找出「在合成图里视觉上真的可见、且有实体填充」的候选图层，
// 用来验证 radius 编辑在文档合成链路上是否真的生效。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-scan-shapes.mjs [psd]
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.document = { createElement: () => createCanvas(1, 1) }
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
globalThis.ImageBitmap = class ImageBitmap {}

const { parsePsd, decodeLayerCanvases, flattenLayers, measureLayerContent, indexRNodes } =
  await import('../src/renderer/src/lib/psd.ts')

const file = process.argv[2] ?? 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\4-2 详情.psd'
const buf = new Uint8Array(await readFile(file))
const s1 = parsePsd(buf, basename(file), true)
const { canvasMap, rnodes } = decodeLayerCanvases(buf, s1.tree)
const idx = indexRNodes(rnodes)
const leaves = flattenLayers(s1.tree).filter((l) => l.type === 'layer' && canvasMap.has(l.id))
console.log(basename(file), '图层数', leaves.length)

const out = []
for (const l of leaves) {
  if (l.width < 60 || l.height < 24 || l.width > 900) continue
  const rn = idx.get(l.id)
  if (!rn) continue
  const fx = rn.effects
  const solid = fx?.solidFill?.some((s) => s.enabled) || fx?.gradientOverlay?.some((s) => s.enabled)
  const m = measureLayerContent(canvasMap.get(l.id))
  if (!m) continue
  out.push({
    key: l.key,
    name: l.name,
    id: l.id,
    w: l.width,
    h: l.height,
    cw: m.cw,
    ch: m.ch,
    padL: m.padL,
    padT: m.padT,
    radius: m.radius,
    shape: rn.shapeLayer,
    solid,
    shadow: fx?.dropShadow?.some((s) => s.enabled)
  })
}
// 优先展示：实体填充 + 有内容留白（说明带柔边/圆角）的图层
const ranked = out
  .filter((o) => o.solid || o.shape)
  .sort((a, b) => b.cw * b.ch - a.cw * a.ch)
  .slice(0, 40)
for (const o of ranked)
  console.log(
    `${o.key}\t${o.name}\t${o.w}x${o.h}\t内容${o.cw}x${o.ch}\tpad(${o.padL},${o.padT})\t估算R=${o.radius}\tshape=${o.shape}\tsolid=${o.solid}\tshadow=${o.shadow}`
  )
console.log('候选总数', out.length)
