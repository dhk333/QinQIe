import { readPsd, initializeCanvas } from 'ag-psd'
import { readFile, writeFile } from 'fs/promises'
import { createCanvas } from '@napi-rs/canvas'

initializeCanvas((width, height) => createCanvas(width, height))

const path = process.argv[2]
const buffer = await readFile(path)
const psd = readPsd(buffer, { skipLinkedFilesData: true })

// 烘焙图层蒙版：ag-psd mask.canvas 用 RGB 明度编码（alpha 恒 255）
function bakeMask(layer) {
  const mask = layer.mask
  if (!mask || mask.disabled || !layer.canvas) return
  const l = layer.left ?? 0, t = layer.top ?? 0
  const mL = mask.left ?? 0, mT = mask.top ?? 0
  const uL = Math.min(mL, l), uT = Math.min(mT, t)
  const uR = Math.max(mask.right ?? mL, layer.right ?? 0)
  const uB = Math.max(mask.bottom ?? mT, layer.bottom ?? 0)
  const uw = Math.max(1, uR - uL), uh = Math.max(1, uB - uT)
  const plane = createCanvas(uw, uh)
  const pctx = plane.getContext('2d')
  const def = mask.defaultColor ?? 0
  pctx.fillStyle = `rgb(${def},${def},${def})`
  pctx.fillRect(0, 0, uw, uh)
  if (mask.canvas) pctx.drawImage(mask.canvas, mL - uL, mT - uT)
  const img = pctx.getImageData(0, 0, uw, uh)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) { d[i+3] = d[i]; d[i] = 255; d[i+1] = 255; d[i+2] = 255 }
  pctx.putImageData(img, 0, 0)
  const out = createCanvas(layer.canvas.width, layer.canvas.height)
  const octx = out.getContext('2d')
  octx.drawImage(layer.canvas, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(plane, uL - l, uT - t)
  layer.canvas = out
}
function bakeAll(layers) {
  for (const l of layers) { bakeMask(l); if (l.children) bakeAll(l.children) }
}
bakeAll(psd.children ?? [])

let total = 0, withCanvas = 0
function walk(layers, depth) {
  for (const l of layers) {
    total++
    if (l.canvas) withCanvas++
    const c = l.canvas ? `${l.canvas.width}x${l.canvas.height}` : '-'
    console.log(
      ' '.repeat(depth) +
        `[${l.children ? 'G' : 'L'}] ${JSON.stringify(l.name)} ` +
        `rect=(${l.left},${l.top})-(${l.right},${l.bottom}) hidden=${!!l.hidden} ` +
        `canvas=${c} blend=${l.blendMode}`
    )
    if (l.children) walk(l.children, depth + 2)
  }
}
walk(psd.children ?? [], 0)
console.log(`---\nlayers total=${total}, withCanvas=${withCanvas}`)

// 复现应用的合成方式：children 自底向上，支持剪贴蒙版与常见混合模式
const BLEND_MAP = {
  multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken',
  lighten: 'lighten', 'color dodge': 'color-dodge', 'color burn': 'color-burn',
  'hard light': 'hard-light', 'soft light': 'soft-light', difference: 'difference',
  exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color',
  luminosity: 'luminosity', 'linear dodge': 'lighter'
}

function drawSingle(ctx, l, blend = true) {
  if (l.hidden || !l.canvas) return
  ctx.save()
  ctx.globalAlpha = l.opacity == null ? 1 : l.opacity
  if (blend) ctx.globalCompositeOperation = BLEND_MAP[l.blendMode] ?? 'source-over'
  ctx.drawImage(l.canvas, l.left, l.top, (l.right ?? 0) - (l.left ?? 0), (l.bottom ?? 0) - (l.top ?? 0))
  ctx.restore()
}

function drawSiblings(ctx, layers) {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]
    if (l.children) { drawSiblings(ctx, l.children); continue }
    if (l.hidden) continue
    const clipped = []
    let j = i + 1
    while (j < layers.length && layers[j].clipping && !layers[j].children) { clipped.push(layers[j]); j++ }
    if (!clipped.length) { drawSingle(ctx, l); continue }
    const vis = clipped.filter((c) => !c.hidden && c.canvas)
    if (!vis.length) { drawSingle(ctx, l); i = j - 1; continue }
    const left = Math.min(l.left, ...vis.map((c) => c.left))
    const top = Math.min(l.top, ...vis.map((c) => c.top))
    const right = Math.max(l.right, ...vis.map((c) => c.right))
    const bottom = Math.max(l.bottom, ...vis.map((c) => c.bottom))
    const tmp = createCanvas(right - left, bottom - top)
    const tctx = tmp.getContext('2d')
    drawSingle(tctx, { ...l, left: l.left - left, top: l.top - top }, false)
    for (const c of vis) {
      drawSingle(tctx, { ...c, left: c.left - left, top: c.top - top })
    }
    tctx.globalCompositeOperation = 'destination-in'
    tctx.globalAlpha = 1
    tctx.drawImage(l.canvas, l.left - left, l.top - top, (l.right ?? 0) - (l.left ?? 0), (l.bottom ?? 0) - (l.top ?? 0))
    ctx.save()
    ctx.globalAlpha = l.opacity == null ? 1 : l.opacity
    ctx.drawImage(tmp, left, top)
    ctx.restore()
    i = j - 1
  }
}

const out = createCanvas(psd.width, psd.height)
const ctx = out.getContext('2d')
drawSiblings(ctx, psd.children ?? [])
await writeFile('scripts/debug-composite.png', out.toBuffer('image/png'))
console.log('saved scripts/debug-composite.png')

// 也保存 psd 自带的合成图（如果有）
if (psd.canvas) {
  await writeFile('scripts/debug-psd-composite.png', psd.canvas.toBuffer('image/png'))
  console.log('saved scripts/debug-psd-composite.png')
} else {
  console.log('psd.canvas: none')
}
