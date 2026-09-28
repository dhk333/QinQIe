// 证据脚本：radius 编辑后合成图该层区域 0 像素变化 —— 查清是「没画」还是「被盖住」。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-occlusion.mjs [psd] [layerKey]
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.document = { createElement: () => createCanvas(1, 1) }
globalThis.HTMLCanvasElement = createCanvas(1, 1).constructor
globalThis.ImageBitmap = class ImageBitmap {}

const { parsePsd, decodeLayerCanvases, flattenLayers, indexRNodes, buildCompositeCanvas, renderLayerCanvas } =
  await import('../src/renderer/src/lib/psd.ts')
const { applyLayerEdits } = await import('../src/renderer/src/lib/layerEdits.ts')

const file = process.argv[2] ?? 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
const key = process.argv[3] ?? 'i4581'

const buf = new Uint8Array(await readFile(file))
const s1 = parsePsd(buf, basename(file), true)
const { canvasMap, rnodes } = decodeLayerCanvases(buf, s1.tree)
const leaf = flattenLayers(s1.tree).find((l) => l.key === key)
if (!leaf) {
  console.log('未找到', key)
  process.exit(1)
}
const rn = indexRNodes(rnodes).get(leaf.id)
console.log('PsdLayer:', { id: leaf.id, name: leaf.name, type: leaf.type, left: leaf.left, top: leaf.top, w: leaf.width, h: leaf.height, visible: leaf.visible })
console.log('RNode:', rn && {
  kind: rn.kind,
  rect: [rn.left, rn.top, rn.right - rn.left, rn.bottom - rn.top],
  canvas: rn.canvas ? [rn.canvas.width, rn.canvas.height] : null,
  hidden: rn.hidden,
  clipping: rn.clipping,
  blend: rn.blendMode,
  opacity: rn.opacity,
  fillOpacity: rn.fillOpacity,
  shapeLayer: rn.shapeLayer,
  mask: rn.mask ? [rn.mask.left, rn.mask.top, rn.mask.right - rn.mask.left, rn.mask.bottom - rn.mask.top, 'default=' + rn.mask.defaultColor, 'disabled=' + rn.mask.disabled] : null,
  effects: rn.effects ? Object.keys(rn.effects).join('/') : '无',
  children: rn.children?.length
})

// 父链 + 同层兄弟（判断绘制顺序与遮挡）
const parents = new Map()
const walk = (ns, par) => {
  for (const n of ns) {
    parents.set(n, par)
    if (n.children) walk(n.children, n)
  }
}
walk(rnodes, null)
const chain = []
for (let p = parents.get(rn); p; p = parents.get(p)) chain.push(p)
console.log('\n父链(近→远):')
for (const p of chain)
  console.log('  ', p.kind, JSON.stringify(p.name), 'clip=' + p.clipping, 'hidden=' + p.hidden, 'blend=' + p.blendMode, 'children=' + (p.children?.length ?? 0))

const sibs = (parents.get(rn)?.children ?? rnodes)
const idx = sibs.indexOf(rn)
console.log('\n同层兄弟（绘制顺序 0=先画/在下）:')
for (let i = 0; i < sibs.length; i++) {
  const n = sibs[i]
  const c = n.canvas
  console.log(
    `  ${i}`,
    n.kind,
    JSON.stringify((n.name ?? '').slice(0, 18)),
    'clip=' + n.clipping,
    'hidden=' + n.hidden,
    'rect=[' + [n.left, n.top, n.right - n.left, n.bottom - n.top] + ']',
    'children=' + (n.children?.length ?? 0),
    i === idx ? '<== 目标' : ''
  )
}

// 单列：目标层上方且矩形相交的兄弟（潜在遮挡者）
const R = { x0: rn.left, y0: rn.top, x1: rn.right, y1: rn.bottom }
const cover = []
const collect = (ns) => {
  for (const n of ns) {
    if (n.kind === 'layer' && n.canvas && !n.hidden) {
      if (n.bottom > R.y0 && n.top < R.y1 && n.right > R.x0 && n.left < R.x1) cover.push(n)
    } else if (n.children) collect(n.children)
    void n
  }
}
// 从目标在列表中的位置往后的所有兄弟（同组内）
const after = sibs.slice(idx + 1)
for (const n of after) if (n.kind === 'layer' ? n.canvas && !n.hidden : true) collect([n])
console.log('\n目标之后绘制且相交的图层:')
for (const n of cover.slice(0, 12))
  console.log('  ', JSON.stringify((n.name ?? '').slice(0, 18)), 'rect=[' + [n.left, n.top, n.right - n.left, n.bottom - n.top] + ']', 'clip=' + n.clipping, 'blend=' + n.blendMode)

// 合成图采样：角部 + 中心
const comp = buildCompositeCanvas(s1.doc, rnodes, new Set())
const cx = comp.getContext('2d')
const px = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data).join(',')
console.log('\n合成图采样 (x,y:rgba):')
for (const [dx, dy] of [[0, 0], [2, 2], [4, 4], [rn.right - rn.left >> 1, 0], [0, (rn.bottom - rn.top) >> 1], [(rn.right - rn.left) >> 1, (rn.bottom - rn.top) >> 1]])
  console.log(`  (${rn.left + dx},${rn.top + dy}) ->`, px(rn.left + dx, rn.top + dy))

// 隔离渲染该层（真实外观）
const iso = renderLayerCanvas(leaf, rnodes, new Set())
if (iso) {
  const g = iso.getContext('2d')
  console.log('\n隔离渲染尺寸:', iso.width, 'x', iso.height)
  console.log('  角部 alpha:', [
    g.getImageData(0, 0, 1, 1).data[3],
    g.getImageData(Math.max(0, iso.width - 1), 0, 1, 1).data[3],
    g.getImageData(0, Math.max(0, iso.height - 1), 1, 1).data[3]
  ].join(','))
  const prof0 = []
  for (let y = 0; y < 14; y++) {
    let x = 0
    while (x < iso.width && g.getImageData(x, y, 1, 1).data[3] < 128) x++
    prof0.push(x)
  }
  console.log('  原图每行首个>128 的 x:', prof0.join(','))
  // 每列首个>128 的 y（顶边弧线）
  const profC = []
  for (let x = 0; x < 14; x++) {
    let y = 0
    while (y < iso.height && g.getImageData(x, y, 1, 1).data[3] < 128) y++
    profC.push(y)
  }
  console.log('  原图每列首个>128 的 y:', profC.join(','))
} else console.log('\n隔离渲染: 无输出')

// 编辑 radius=20 后，隔离渲染的角部 alpha 变化
const proj = applyLayerEdits(s1.tree, rnodes, { [key]: { baseName: leaf.name, radius: Number(process.argv[4] ?? 20) } })
const prn = indexRNodes(proj.rnodes).get(leaf.id)
console.log('\n投影后 radius=', prn?.radius, 'radiusPad=', JSON.stringify(prn?.radiusPad))
const iso2 = renderLayerCanvas(leaf, proj.rnodes, new Set())
if (iso2) {
  const g = iso2.getContext('2d')
  console.log('编辑后隔离尺寸:', iso2.width, 'x', iso2.height)
  const prof = []
  for (let y = 0; y < 10; y++) {
    let x = 0
    while (x < iso2.width && g.getImageData(x, y, 1, 1).data[3] < 128) x++
    prof.push(x)
  }
  console.log('  每行首个>128 的 x:', prof.join(','))
}
const after2 = buildCompositeCanvas(s1.doc, proj.rnodes, new Set())
const a = comp.getContext('2d').getImageData(rn.left - 2, rn.top - 2, rn.right - rn.left + 4, rn.bottom - rn.top + 4).data
const b = after2.getContext('2d').getImageData(rn.left - 2, rn.top - 2, rn.right - rn.left + 4, rn.bottom - rn.top + 4).data
let d = 0
for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) d++
console.log('\n编辑后合成图变化像素:', d)

// 该层在合成里到底有没有贡献像素：隐藏它再比一次
const hid = buildCompositeCanvas(s1.doc, rnodes, new Set([leaf.id]))
const ha = comp.getContext('2d').getImageData(rn.left - 2, rn.top - 2, rn.right - rn.left + 4, rn.bottom - rn.top + 4).data
const hb = hid.getContext('2d').getImageData(rn.left - 2, rn.top - 2, rn.right - rn.left + 4, rn.bottom - rn.top + 4).data
let dh = 0
for (let i = 0; i < ha.length; i += 4) if (ha[i] !== hb[i] || ha[i + 1] !== hb[i + 1] || ha[i + 2] !== hb[i + 2] || ha[i + 3] !== hb[i + 3]) dh++
console.log('隐藏该层后合成图变化像素:', dh, '（0 说明下层把它完全盖住）')

// 效果开关与颜色：解释「改了圆角看不见」
const fx = rn.effects ?? {}
const line = (k, o) => console.log('  ', k, o && `enabled=${o.enabled} color=${JSON.stringify(o.color)} size=${o.size} dist=${o.distance} choke=${o.choke}`)
console.log('\n效果:')
line('dropShadow', fx.dropShadow?.[0])
line('innerShadow', fx.innerShadow?.[0])
line('outerGlow', fx.outerGlow)
line('innerGlow', fx.innerGlow)
line('stroke', fx.stroke?.[0])
line('solidFill', fx.solidFill?.[0])
line('gradientOverlay', fx.gradientOverlay?.[0])
