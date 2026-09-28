// 复现「矩形 12 编辑 radius=20 画布无变化」：走应用同一条链路
// parse → applyLayerEdits → buildCompositeCanvas，对比新旧画面在图层区域的像素差。
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.document = { createElement: () => createCanvas(1, 1) }
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
globalThis.ImageBitmap = class ImageBitmap {}

const { parsePsd, decodeLayerCanvases, flattenLayers, indexRNodes, buildCompositeCanvas } =
  await import('../src/renderer/src/lib/psd.ts')
const { applyLayerEdits } = await import('../src/renderer/src/lib/layerEdits.ts')

const file = 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
const buf = new Uint8Array(await readFile(file))
const s1 = parsePsd(buf, basename(file), true)
const { canvasMap, rnodes } = decodeLayerCanvases(buf, s1.tree)

const leaf = flattenLayers(s1.tree).find((l) => l.key === 'i4581')
console.log('目标图层:', leaf && { key: leaf.key, id: leaf.id, name: leaf.name, w: leaf.width, h: leaf.height })
if (!leaf) process.exit(1)

const edits = { i4581: { baseName: '矩形 12', radius: 20 } }
const proj = applyLayerEdits(s1.tree, rnodes, edits)
const pn = indexRNodes(proj.rnodes).get(leaf.id)
console.log('投影 RNode: radius=', pn?.radius, ' rect=', pn && [pn.left, pn.top, pn.right - pn.left, pn.bottom - pn.top])

const before = buildCompositeCanvas(s1.doc, rnodes, new Set())
const after = buildCompositeCanvas(s1.doc, proj.rnodes, new Set())
const x0 = leaf.left - 4, y0 = leaf.top - 4
const ww = leaf.width + 8, hh = leaf.height + 8
const db = before.getContext('2d').getImageData(x0, y0, ww, hh).data
const da = after.getContext('2d').getImageData(x0, y0, ww, hh).data
let diff = 0
for (let i = 0; i < db.length; i += 4)
  if (db[i] !== da[i] || db[i + 1] !== da[i + 1] || db[i + 2] !== da[i + 2] || db[i + 3] !== da[i + 3]) diff++
console.log(`合成图该层区域 ${ww}x${hh} 内变化像素: ${diff}`)

// 角部细节：左上角 24x24 的 alpha 变化
const c = after.getContext('2d').getImageData(leaf.left, leaf.top, 24, 24).data
const prof = []
for (let y = 0; y < 8; y++) {
  let x = 0
  while (x < 24 && c[(y * 24 + x) * 4 + 3] < 128) x++
  prof.push(x)
}
console.log('编辑后左上 8 行首个>128 列偏移:', prof.join(','))
