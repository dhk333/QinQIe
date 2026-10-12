// 文本图层「有效字号」取证：用应用自己的解析器出 textInfo.fontSize，
// 再拿 PS 存的图层位图墨迹高度反查真实字号，两者对不上就是解析口径错了。
// 跑法：node --import ./scripts/ts-resolve.mjs scripts/diag-text-size.mjs [psd...]
import { readFileSync } from 'fs'
import { basename } from 'path'
import { initializeCanvas } from 'ag-psd'
import { createCanvas, Canvas } from '@napi-rs/canvas'

initializeCanvas((w, h) => createCanvas(w, h))
globalThis.HTMLCanvasElement = Canvas
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : {})
}

const DEFAULTS = [
  'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\4-2 新闻资讯--公司动态--详情.psd',
  'D:\\A-戴鸿锟\\项目\\2026\\W-沃尔核材\\psd\\7-2招聘岗位.psd'
]

const { parsePsd, renderLayerCanvas, flattenLayers } = await import('../src/renderer/src/lib/psd.ts')
const { readPsd } = await import('ag-psd')

/** 位图墨迹包围盒高度（alpha > 40） */
function inkBox(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let min = Infinity
  let max = -1
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (d[(y * canvas.width + x) * 4 + 3] > 40) {
        if (y < min) min = y
        if (y > max) max = y
        break
      }
  return max < 0 ? null : { top: min, height: max - min + 1 }
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS
for (const file of files) {
  console.log(`\n=== ${basename(file)}`)
  const { tree, rnodes } = parsePsd(readFileSync(file), basename(file))
  // transform / verticalScale 只在原始 ag-psd 结构里，用来核对「放大前的输入字号」
  const raw = readPsd(new Uint8Array(readFileSync(file)), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipLinkedFilesData: true,
    skipThumbnail: true
  })
  const rawText = []
  const collect = (layers) => {
    for (const l of layers ?? []) {
      if (l.text) rawText.push(l)
      if (l.children) collect(l.children)
    }
  }
  collect(raw.children)

  // 两棵树遍历顺序一致，按序号配对（按图层名取会撞上重名层，读数就串了）
  const texts = flattenLayers(tree).filter((l) => l.isText && l.textInfo)
  if (rawText.length !== texts.length)
    console.log(`  （原始文本层 ${rawText.length} ≠ 解析后 ${texts.length}，输入列仅供参考）`)
  texts.forEach((l, idx) => {
    const c = renderLayerCanvas(l, rnodes, new Set())
    const box = c ? inkBox(c) : null
    if (!box) return
    const t = rawText[idx]?.text
    const input = t?.style?.fontSize
    const tr = t?.transform?.[3] ?? 1
    const vS = t?.style?.verticalScale ?? 1
    const size = l.textInfo.fontSize ?? 0
    // 单行才可比：CJK 字形墨迹高≈字号，拉丁/数字约 0.72 em；多行（墨迹>2.2 字号）不参与判定
    const single = box.height <= size * 2.2
    const suspicious = single && box.height > size + 3
    console.log(
      `${suspicious ? '!!' : '  '} ${String(l.name).slice(0, 16).padEnd(16)}` +
        ` css=${size} 墨迹=${box.height}${single ? '' : '(多行)'} 输入=${input}` +
        ` ×tr=${Math.round(tr * 1000) / 1000} ×vS=${vS} 行距=${l.textInfo.leading}` +
        ` 位图=${c.width}x${c.height}`
    )
  })
}
