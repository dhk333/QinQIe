// 端到端校验应用侧数据通路：psd.ts 的两阶段解析 → id 映射 → 合成 → 与 PS 内嵌合成图比对。
// 合成器本身的像素保真由 verify-fidelity.mjs 覆盖，这里查的是「应用拿到的树是否就是那棵树」。
// 用法：node scripts/verify-app-path.mjs [psd...]
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { readFile } from 'fs/promises'
import { basename } from 'path'

// psd.ts 是给浏览器写的，用 @napi-rs/canvas 顶掉 DOM canvas，其余逻辑一字不改地跑
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') throw new Error(`未预期的 createElement: ${tag}`)
    return createCanvas(1, 1)
  }
}
initializeCanvas((w, h) => createCanvas(w, h))

const { readPsd } = await import('ag-psd')
const { parsePsd, decodeLayerCanvases, flattenLayers, indexRNodes, buildCompositeCanvas, renderLayerCanvas } =
  await import('../src/renderer/src/lib/psd.ts')
const { compositeDocument } = await import('../src/renderer/src/lib/compositor.ts')

const DEFAULTS = [
  'D:\\项目\\展示型项目\\迈威机器人\\psd\\4-新闻资讯\\新闻.psd',
  'D:\\项目\\展示型项目\\迈威机器人\\psd\\0-首页\\首页3.psd',
  'D:\\项目\\展示型项目\\迈威机器人\\psd\\5-关于迈威\\关于我们3.psd'
]
const argv = process.argv.slice(2)
const env = { createCanvas: (w, h) => createCanvas(w, h) }
let failed = false
const bad = (msg) => {
  failed = true
  console.log(`  FAIL ${msg}`)
}

for (const file of argv.length ? argv : DEFAULTS) {
  const buf = new Uint8Array(await readFile(file))
  const name = basename(file)
  console.log(`\n${name}`)

  // 1) 应用的实际加载顺序：结构阶段 + 位图解码阶段
  const s1 = parsePsd(buf, name, true)
  if (s1.canvasMap.size !== 0) bad(`结构阶段不应解码位图，实际 ${s1.canvasMap.size} 个`)
  const { canvasMap, rnodes } = decodeLayerCanvases(buf, s1.tree)
  const doc = s1.doc

  // 2) PsdLayer 树与 RNode 树必须同 id 同集合，否则显隐/选中会作用错图层
  const layerIds = flattenLayers(s1.tree).map((l) => l.id)
  const nodeMap = indexRNodes(rnodes)
  const kindById = new Map(flattenLayers(s1.tree).map((l) => [l.id, l.type === 'group' ? 'group' : 'layer']))
  const missing = layerIds.filter((id) => !nodeMap.has(id))
  const extra = [...nodeMap.keys()].filter((id) => !kindById.has(id))
  if (missing.length) bad(`${missing.length}/${layerIds.length} 个图层节点在 RNode 树中缺失`)
  if (extra.length) bad(`RNode 树多出 ${extra.length} 个节点`)
  const mismatch = layerIds.filter((id) => nodeMap.get(id)?.kind !== kindById.get(id))
  if (mismatch.length) bad(`${mismatch.length} 个节点 group/layer 类型不一致`)
  if (canvasMap.size === 0) bad('解码阶段没有产出任何位图')

  // 3) 合成结果与 PS 内嵌合成图比对
  const psd = readPsd(buf, { skipLinkedFilesData: true, skipThumbnail: true })
  if (!psd.canvas) {
    console.log('  无内嵌合成图，跳过像素比对')
    continue
  }
  const ours = buildCompositeCanvas(doc, rnodes, new Set())
  const W = psd.width
  const H = psd.height
  const a = ours.getContext('2d').getImageData(0, 0, W, H).data
  const b = psd.canvas.getContext('2d').getImageData(0, 0, W, H).data
  let diffPx = 0
  let sum = 0
  for (let i = 0; i < W * H; i++) {
    const j = i * 4
    const d = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]) + Math.abs(a[j + 3] - b[j + 3])
    if (d > 8) diffPx++
    sum += d
  }
  const mean = sum / (W * H) / 4
  const pct = (diffPx / (W * H)) * 100
  if (!(mean < 1 && pct < 1)) bad(`合成保真度不达标 平均 ${mean.toFixed(3)} 差异像素 ${pct.toFixed(3)}%`)
  else console.log(`  保真度 OK  平均偏差 ${mean.toFixed(3)}/255  差异像素 ${pct.toFixed(3)}%`)

  // 4) 隐藏一个叶子图层，画布必须且只能在它附近发生变化
  const leaf = flattenLayers(s1.tree).find((l) => l.type === 'layer' && !l.hidden && canvasMap.has(l.id) && l.width * l.height > 4000)
  if (!leaf) {
    bad('找不到可用于显隐测试的叶子图层')
    continue
  }
  const hidden = compositeDocument(rnodes, { env, hiddenIds: new Set([leaf.id]) }, { width: W, height: H })
  const c = hidden.getContext('2d').getImageData(0, 0, W, H).data
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, changed = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4
      if (a[j] === c[j] && a[j + 1] === c[j + 1] && a[j + 2] === c[j + 2] && a[j + 3] === c[j + 3]) continue
      changed++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  const pad = Math.max(64, 0.25 * Math.max(leaf.width, leaf.height))
  const inside =
    minX >= leaf.left - pad && minY >= leaf.top - pad && maxX <= leaf.left + leaf.width + pad && maxY <= leaf.top + leaf.height + pad
  if (!changed) bad(`隐藏「${leaf.name}」(id=${leaf.id}) 后画面没有任何变化 → id 映射错位`)
  else if (!inside)
    bad(`隐藏「${leaf.name}」的变化区域 [${minX},${minY},${maxX},${maxY}] 超出其边界 [${leaf.left},${leaf.top},${leaf.left + leaf.width},${leaf.top + leaf.height}]`)
  else console.log(`  显隐映射 OK  「${leaf.name}」id=${leaf.id} 变化 ${changed} 像素`)

  // 5) 单图层导出画布尺寸应等于图层边界（与面板显示一致）
  const one = renderLayerCanvas(leaf, rnodes, new Set())
  if (!one) bad(`「${leaf.name}」隔离出图失败`)
  else if (one.width !== Math.round(leaf.width) || one.height !== Math.round(leaf.height))
    bad(`「${leaf.name}」出图 ${one.width}x${one.height} 与图层 ${Math.round(leaf.width)}x${Math.round(leaf.height)} 不符`)
  else console.log(`  单图层出图 OK  ${one.width}x${one.height}`)
}

console.log(failed ? '\n存在未通过项' : '\n应用数据通路全部通过')
process.exit(failed ? 1 : 0)
