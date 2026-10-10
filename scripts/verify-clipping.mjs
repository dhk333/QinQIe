// 剪贴蒙版可见区域回归：证明「选中/读数/导出」用的是被剪贴后的可见框，而不是图层自身位图框。
// 跑法：node --import ./scripts/ts-resolve.mjs scripts/verify-clipping.mjs [psd...]
import { initializeCanvas } from 'ag-psd'
import { createCanvas, Canvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

initializeCanvas((w, h) => createCanvas(w, h))
// 渲染器只用到 DOM 的 canvas：Node 下用 napi canvas 顶替元素本身与它的构造器判据
globalThis.HTMLCanvasElement = Canvas
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : {})
}

const DEFAULT = 'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\4-2 新闻资讯--公司动态--详情.psd'

const { parsePsd, renderLayerCanvas, flattenLayers } = await import('../src/renderer/src/lib/psd.ts')
const { clipInfoOf, clipBaseOf } = await import('../src/renderer/src/lib/clipping.ts')

let failed = false
const check = (ok, msg) => {
  if (!ok) failed = true
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`)
}

/** 以 (ox, oy) 为画布左上角落到文档坐标，统计可见框之外的不透明像素数 */
function outsidePixels(canvas, ox, oy, box) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 8) continue
    const p = (i - 3) / 4
    const x = ox + (p % canvas.width)
    const y = oy + Math.floor(p / canvas.width)
    if (x < box.left || y < box.top || x >= box.left + box.width || y >= box.top + box.height) n++
  }
  return n
}

for (const file of process.argv.slice(2).length ? process.argv.slice(2) : [DEFAULT]) {
  console.log(`\n${basename(file)}`)
  const { tree, rnodes } = parsePsd(await readFile(file), basename(file))
  const info = clipInfoOf(rnodes)
  const clippees = flattenLayers(tree).filter((l) => l.clipping && !l.children)
  check(clippees.length > 0, `样本里有 ${clippees.length} 个被剪贴的像素图层`)

  let boxed = 0
  for (const l of clippees) {
    const box = info.boxes.get(l.id)
    const base = clipBaseOf(rnodes, l.id)
    if (!box || !base) {
      check(false, `「${l.name}」没有可见框（基底缺失？）`)
      continue
    }
    boxed++
    const bb = info.boxes.get(base.id)
    const inside =
      !bb ||
      (box.left >= bb.left - 1 &&
        box.top >= bb.top - 1 &&
        box.left + box.width <= bb.left + bb.width + 1 &&
        box.top + box.height <= bb.top + bb.height + 1)
    const shrunk = box.width * box.height < l.width * l.height
    check(
      inside && shrunk,
      `「${l.name}」自身 ${l.width}×${l.height} → 可见 ${box.width}×${box.height} @ X${box.left} Y${box.top}（基底「${base.name}」${
        bb ? `${bb.width}×${bb.height}` : '无框'
      }）`
    )

    // 出图：带 clip 的尺寸就是可见框；像素层面基底以外必须被裁干净
    const raw = renderLayerCanvas(l, rnodes, new Set(), null)
    const clipped = renderLayerCanvas(l, rnodes, new Set(), { base, box })
    if (!raw || !clipped) {
      check(false, `「${l.name}」出图失败`)
      continue
    }
    check(
      clipped.width === box.width && clipped.height === box.height,
      `「${l.name}」导出 ${clipped.width}×${clipped.height} == 可见框（未剪贴 ${raw.width}×${raw.height}）`
    )
    const leakBefore = outsidePixels(raw, l.left, l.top, box)
    const leakAfter = outsidePixels(clipped, box.left, box.top, box)
    check(
      leakBefore > 0 && leakAfter === 0,
      `「${l.name}」基底以外像素：剪贴前 ${leakBefore} 个 → 剪贴后 ${leakAfter} 个`
    )
  }
  check(boxed === clippees.length, `${clippees.length} 个剪贴图层全部拿到可见框（实际 ${boxed}）`)

  const plain = flattenLayers(tree).find((l) => !l.clipping && !l.children && l.width > 50)
  if (plain) {
    const b = info.boxes.get(plain.id)
    check(
      !b || (b.width <= plain.width + 1 && b.height <= plain.height + 1),
      `未剪贴图层「${plain.name}」未被误伤：${b ? `${b.width}×${b.height}` : `${plain.width}×${plain.height}`}（自身 ${plain.width}×${plain.height}）`
    )
  }
}

console.log(failed ? '\n剪贴回归失败' : '\n剪贴回归通过')
process.exit(failed ? 1 : 0)
