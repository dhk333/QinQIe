// 区域对照：把指定矩形从「我们的合成」「PS 内嵌合成图」裁出来放大存图，并列出与该区域相交的全部图层。
// 用法：node --import ./scripts/ts-resolve.mjs scripts/diag-gradient-fx.mjs [psd] [x y w h] [放大倍数]
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile, mkdir } from 'fs/promises'
import { basename } from 'path'
import { buildRNode, compositeDocument } from '../src/renderer/src/lib/compositor.ts'

initializeCanvas((w, h) => createCanvas(w, h))

const file = process.argv[2] || 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\4-2 新闻资讯--公司动态--详情.psd'
const nums = process.argv.slice(3).filter((a) => /^-?\d+$/.test(a)).map(Number)
const [RX, RY, RW, RH] = nums.length >= 4 ? nums.slice(0, 4) : [381, 1607, 53, 22]
const ZOOM = nums.length >= 5 ? nums[4] : 4
const PAD = 8
const CX = RX - PAD
const CY = RY - PAD
const CW = RW + PAD * 2
const CH = RH + PAD * 2

await mkdir(new URL('./out/', import.meta.url), { recursive: true })

const psd = readPsd(await readFile(file), { skipLinkedFilesData: true, skipThumbnail: true })
const hex = (c) =>
  c && `#${[c.r, c.g, c.b].map((v) => Math.round(v <= 1 ? v * 255 : v).toString(16).padStart(2, '0')).join('')}`

// 与区域相交的图层，按绘制顺序（children 自底向上）排列，越靠后越在上
const hits = []
const walk = (layers, path, depth) => {
  for (const l of layers ?? []) {
    const p = `${path}/${l.name ?? '?'}`
    const w = (l.right ?? 0) - (l.left ?? 0)
    const h = (l.bottom ?? 0) - (l.top ?? 0)
    const overlap = !(l.right < CX || l.left > CX + CW || l.bottom < CY || l.top > CY + CH)
    if (overlap && !l.children) {
      const go = (l.effects?.gradientOverlay ?? []).map(
        (g) =>
          `${g.enabled === false ? '禁用' : '启用'}:${g.type ?? g.gradient?.type} angle=${g.angle ?? '-'} ${
            (g.gradient?.colorStops ?? []).map((s) => `${hex(s.color)}@${s.location}`).join('→')
          }`
      )
      hits.push({
        顺序: hits.length,
        路径: p,
        矩形: `${l.left},${l.top} ${w}×${h}`,
        隐藏: l.hidden ? '是' : '',
        剪贴: l.clipping ? '是' : '',
        填充: l.vectorFill ? `${l.vectorFill.type} ${hex(l.vectorFill.color ?? '')}` : '',
        位图: l.canvas ? `${l.canvas.width}×${l.canvas.height}` : '无',
        蒙版: l.mask ? `${(l.mask.right ?? 0) - (l.mask.left ?? 0)}×${(l.mask.bottom ?? 0) - (l.mask.top ?? 0)}` : '',
        渐变叠加: go.join(' | ')
      })
    }
    walk(l.children, p, depth + 1)
  }
}
walk(psd.children, '', 0)
console.log(`区域 ${RX},${RY} ${RW}×${RH}（裁切含 ${PAD}px 余量）相交图层 ${hits.length} 个，按绘制顺序：\n`)
for (const h of hits) console.log(JSON.stringify(h, null, 0).replace(/","/g, '  '))

const cropSave = (src, name) => {
  const out = createCanvas(CW * ZOOM, CH * ZOOM)
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#202020'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(src, CX, CY, CW, CH, 0, 0, CW * ZOOM, CH * ZOOM)
  return out
}

/** 三联图：我们的合成 | PS 合成图 | 差异×8 */
function triple(a, b) {
  const gap = 6
  const out = createCanvas(CW * ZOOM * 3 + gap * 2, CH * ZOOM + 16)
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(a, gap * 0, 16)
  ctx.drawImage(b, CW * ZOOM + gap, 16)
  const diff = createCanvas(CW * ZOOM, CH * ZOOM)
  const dctx = diff.getContext('2d')
  dctx.drawImage(a, 0, 0)
  dctx.globalCompositeOperation = 'difference'
  dctx.drawImage(b, 0, 0)
  dctx.globalCompositeOperation = 'source-in' // 保留 alpha 形状
  dctx.globalCompositeOperation = 'source-over'
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data
  const db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
  const dd = dctx.createImageData(a.width, a.height)
  for (let i = 0; i < da.length; i += 4) {
    for (let k = 0; k < 3; k++) dd.data[i + k] = Math.min(255, Math.abs(da[i + k] - db[i + k]) * 8)
    dd.data[i + 3] = 255
  }
  dctx.putImageData(dd, 0, 0)
  ctx.drawImage(diff, (CW * ZOOM + gap) * 2, 16)
  ctx.fillStyle = '#e8e8e8'
  ctx.font = '11px sans-serif'
  ctx.fillText('ours', 2, 12)
  ctx.fillText('photoshop', CW * ZOOM + gap + 2, 12)
  ctx.fillText('diff x8', (CW * ZOOM + gap) * 2 + 2, 12)
  return out
}

let seq = 0
const tree = (psd.children ?? []).map((l) => buildRNode(l, () => ++seq))
const ours = compositeDocument(tree, { env: { createCanvas: (w, h) => createCanvas(w, h) } }, {
  width: psd.width,
  height: psd.height
})

if (!psd.canvas) {
  console.log('文件没有内嵌合成图，无法对照')
} else {
  const img = triple(cropSave(ours), cropSave(psd.canvas))
  const url = new URL(`./out/grad-${basename(file, '.psd')}-${RX}-${RY}-cmp.png`, import.meta.url)
  const { writeFile } = await import('fs/promises')
  await writeFile(url, img.toBuffer('image/png'))
  console.log(`对照图: ${decodeURIComponent(url.pathname.replace(/^\//, ''))}`)
}
