// 验证结构缓存往返一致性：parse → stripRNodeCanvases → JSON 序列化/反序列化 → adoptLayerIds
// 断言：树/doc 逐字节一致；rnodes 仅画布与记忆化字段被清空；adopt 后新解析的 id 不与缓存树冲突
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'

initializeCanvas((w, h) => createCanvas(w, h))

const { parsePsd, adoptLayerIds, flattenLayers } = await import('../src/renderer/src/lib/psd.ts')
const { stripRNodeCanvases } = await import('../src/renderer/src/lib/psdCache.ts')

const file =
  process.argv[2] ?? 'D:/A-戴鸿锟/项目/2026/W-沃尔核材/psd/5-2投资者关系-公告与通函.psd'
const buf = new Uint8Array(await readFile(file))
console.log(`file: ${basename(file)} (${(buf.length / 1048576).toFixed(0)}MB)`)

const parsed = parsePsd(buf, basename(file), true)
const entry = { v: 1, doc: parsed.doc, tree: parsed.tree, rnodes: stripRNodeCanvases(parsed.rnodes) }
const round = JSON.parse(JSON.stringify(entry))

let fail = 0
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) fail++
}

// 1) 树与 doc 逐字节一致（编辑量按 layer.key 对齐，键序错了编辑就会贴错图层）
check('tree 往返一致', JSON.stringify(parsed.tree) === JSON.stringify(round.tree))
check('doc 往返一致', JSON.stringify(parsed.doc) === JSON.stringify(round.doc))

// 2) rnodes：结构字段一致；画布/记忆化字段确被清空
const DROP = new Set(['canvas', 'bitmap', 'seg', '_sig', '_sigKey', '_lc', '_indep'])
const sig = (nodes) =>
  JSON.stringify(nodes, (k, v) => (DROP.has(k) ? undefined : v))
check('rnodes 结构字段往返一致', sig(parsed.rnodes) === sig(round.rnodes))
const hasLiveRef = (nodes) =>
  nodes.some(
    (n) =>
      n.canvas != null ||
      n.bitmap != null ||
      n.seg != null ||
      n.mask?.canvas != null ||
      (n.children && hasLiveRef(n.children))
  )
check('rnodes 无残留画布引用', !hasLiveRef(round.rnodes))

// 3) layer.key 保留（跨会话编辑量的索引）
const keysA = flattenLayers(round.tree)
  .map((n) => n.key)
  .join('|')
const keysB = flattenLayers(parsed.tree)
  .map((n) => n.key)
  .join('|')
check('layer.key 往返一致', keysA === keysB)

// 4) adoptLayerIds：随后解析分配的 id 必须整体大于缓存树的最大 id，避免同会话撞号
const maxId = flattenLayers(round.tree).reduce((m, n) => Math.max(m, n.id), 0)
adoptLayerIds(round.tree)
const again = parsePsd(buf, basename(file), true)
const minNewId = flattenLayers(again.tree).reduce((m, n) => Math.min(m, n.id), Infinity)
check(`adopt 后新解析最小 id(${minNewId}) > 缓存最大 id(${maxId})`, minNewId > maxId)

console.log(fail ? `\n${fail} 项失败` : '\n全部通过')
process.exit(fail ? 1 : 0)
