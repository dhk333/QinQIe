// 真相基准：PSD 文件里自带的合并图（psd.canvas = PS 自己存的原图）。
// 对比我们合成图同一像素，判断「矩形 12 区域一片白」是我们的合成错了还是它真被盖住。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-truth.mjs [psd] [layerKey]
import { initializeCanvas, readPsd } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.document = { createElement: () => createCanvas(1, 1) }
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
globalThis.ImageBitmap = class ImageBitmap {}

const { parsePsd, decodeLayerCanvases, flattenLayers, indexRNodes, buildCompositeCanvas } =
  await import('../src/renderer/src/lib/psd.ts')

const file = process.argv[2] ?? 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
const key = process.argv[3] ?? 'i4581'
const buf = new Uint8Array(await readFile(file))

const psd = readPsd(buf, { skipThumbnail: true, useRawBlendMode: false })
const tc = psd.canvas
const tctx = tc.getContext('2d')
const leaf = flattenLayers(parsePsd(buf, basename(file), true).tree).find((l) => l.key === key)
console.log('原图尺寸', tc.width, 'x', tc.height, '目标层', leaf.name, [leaf.left, leaf.top, leaf.width, leaf.height])

const s1 = parsePsd(buf, basename(file), true)
const { rnodes } = decodeLayerCanvases(buf, s1.tree)
const comp = buildCompositeCanvas(s1.doc, rnodes, new Set())
const cctx = comp.getContext('2d')

const pts = [
  [leaf.left + 20, leaf.top + 23],
  [leaf.left + 71, leaf.top + 23],
  [leaf.left + 4, leaf.top + 4],
  [leaf.left - 30, leaf.top - 30],
  [leaf.left - 30, leaf.top + 23]
]
const fmt = (a) => a.join(',')
for (const [x, y] of pts) {
  const t = Array.from(tctx.getImageData(x, y, 1, 1).data)
  const c = Array.from(cctx.getImageData(x, y, 1, 1).data)
  const same = fmt(t.slice(0, 3)) === fmt(c.slice(0, 3))
  console.log(`(${x},${y}) PS原图=${fmt(t)}  我们=${fmt(c)}  ${same ? 'OK' : 'DIFF'}`)
}

// 找出所有覆盖中心点的可见图层（按树序，最后面的在最上）
const idx = indexRNodes(rnodes)
void idx
const cx = leaf.left + 71
const cy = leaf.top + 23
const hits = []
const walk = (ns, path) => {
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i]
    if (n.kind === 'layer' && n.canvas && !n.hidden && n.left <= cx && cx < n.right && n.top <= cy && cy < n.bottom) {
      const d = n.canvas.getContext('2d').getImageData(cx - n.left, cy - n.top, 1, 1).data
      hits.push({ path: path.concat(`${i}:${n.name}`), alpha: d[3], rgb: fmt(Array.from(d.slice(0, 3))) })
    }
    if (n.children) walk(n.children, path.concat(`${i}:${(n.name ?? '').slice(0, 10)}`))
  }
}
walk(rnodes, [])
console.log('\n覆盖中心点的图层（树序，越靠后越在上）:')
for (const h of hits.slice(-12)) console.log('  a=' + h.alpha, 'rgb=' + h.rgb, h.path.join(' > '))
