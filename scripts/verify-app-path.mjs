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
const { applyLayerEdits } = await import('../src/renderer/src/lib/layerEdits.ts')
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

  // 6) 图层编辑投影：位移/圆角/透明度/边框/投影要落到树与 RNode，且合成画面变化只出现在新旧区域并集内
  const DX = 37
  const DY = 25
  const edits = {
    [leaf.key]: {
      baseName: leaf.name,
      dx: DX,
      dy: DY,
      radius: 8,
      opacity: 0.6,
      border: { size: 3, color: '#ff0000', opacity: 1, position: 'inside' },
      shadow: { size: 12, distance: 6, angle: 135, choke: 0, color: '#000000', opacity: 0.5 }
    }
  }
  const proj = applyLayerEdits(s1.tree, rnodes, edits)
  const pLeaf = flattenLayers(proj.tree).find((l) => l.id === leaf.id)
  const pNode = indexRNodes(proj.rnodes).get(leaf.id)
  if (!pLeaf || !pNode) bad(`编辑投影后找不到目标图层 id=${leaf.id}`)
  else {
    const moveOK =
      Math.abs(pLeaf.left - (leaf.left + DX)) < 0.01 &&
      Math.abs(pNode.left - (leaf.left + DX)) < 0.01 &&
      Math.abs(pNode.top - (leaf.top + DY)) < 0.01
    const radiusOK = Math.abs(pNode.radius - 8) < 0.01
    const opacityOK = Math.abs(pNode.opacity - 0.6) < 0.01
    const fxOK = (pNode.effects?.stroke?.length ?? 0) >= 1 && (pNode.effects?.dropShadow?.length ?? 0) >= 1
    if (!moveOK) bad(`编辑位移未生效: 树 [${pLeaf.left},${pLeaf.top}] RNode [${pNode.left},${pNode.top}] 期望 [${leaf.left + DX},${leaf.top + DY}]`)
    if (!radiusOK) bad(`圆角未投影到 RNode: radius=${pNode.radius}`)
    if (!opacityOK) bad(`透明度未投影: opacity=${pNode.opacity}`)
    if (!fxOK) bad(`边框/投影未追加进 effects 通道: stroke=${pNode.effects?.stroke?.length} dropShadow=${pNode.effects?.dropShadow?.length}`)
    if (moveOK && radiusOK && opacityOK && fxOK) console.log(`  编辑投影 OK  「${leaf.name}」位移/圆角/透明度/描边/投影`)
  }
  // 幂等：对同一原始树重复投影，结果边界必须一致（编辑只读叠加，不累积）
  const proj2 = applyLayerEdits(s1.tree, rnodes, edits)
  const p2 = indexRNodes(proj2.rnodes).get(leaf.id)
  if (p2 && pNode && (Math.abs(p2.left - pNode.left) > 0.01 || Math.abs(p2.right - pNode.right) > 0.01))
    bad('编辑投影不幂等：两次投影结果边界不一致')
  // 合成变化区域必须被新旧矩形并集 + 阴影/描边余量包住
  const edited = compositeDocument(proj.rnodes, { env }, { width: W, height: H })
  const d = edited.getContext('2d').getImageData(0, 0, W, H).data
  let eMinX = 1e9, eMinY = 1e9, eMaxX = -1, eMaxY = -1, eChanged = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 4
      if (a[j] === d[j] && a[j + 1] === d[j + 1] && a[j + 2] === d[j + 2] && a[j + 3] === d[j + 3]) continue
      eChanged++
      if (x < eMinX) eMinX = x
      if (y < eMinY) eMinY = y
      if (x > eMaxX) eMaxX = x
      if (y > eMaxY) eMaxY = y
    }
  }
  const epad = Math.max(96, 0.5 * Math.max(leaf.width, leaf.height))
  const eInside =
    eMinX >= leaf.left - epad &&
    eMinY >= leaf.top - epad &&
    eMaxX <= leaf.left + leaf.width + DX + epad &&
    eMaxY <= leaf.top + leaf.height + DY + epad
  if (!eChanged) bad(`编辑「${leaf.name}」后合成画面无变化 → 投影后的 rnodes 没有被合成器采用`)
  else if (!eInside)
    bad(`编辑变化区域 [${eMinX},${eMinY},${eMaxX},${eMaxY}] 超出新旧矩形并集 (leaf [${leaf.left},${leaf.top},${leaf.left + leaf.width},${leaf.top + leaf.height}] dx=${DX} dy=${DY})`)
  else console.log(`  编辑合成 OK  变化 ${eChanged} 像素，落在预期区域`)
}

console.log(failed ? '\n存在未通过项' : '\n应用数据通路全部通过')
process.exit(failed ? 1 : 0)
