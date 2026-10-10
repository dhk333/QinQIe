import { readPsd } from 'ag-psd'
import { readFile } from 'fs/promises'

const path =
  process.argv[2] || 'D:/A-戴鸿锟/项目/2026/W-沃尔核材/psd/4-2 新闻资讯--公司动态--详情.psd'
const psd = readPsd(await readFile(path), {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipLinkedFilesData: true
})

let chains = 0
const walk = (nodes, depth, where) => {
  const list = nodes || []
  for (let i = 0; i < list.length; i++) {
    const base = list[i]
    if (base.children) walk(base.children, depth + 1, `${where}/${base.name}`)
    if (base.clipping) continue
    const clippees = []
    for (let j = i + 1; j < list.length && list[j].clipping; j++) clippees.push(list[j])
    if (!clippees.length) continue
    chains++
    const r = (l) =>
      `X${l.left ?? 0} Y${l.top ?? 0} ${l.right ?? 0}×${l.bottom ?? 0} = ${
        (l.right ?? 0) - (l.left ?? 0)
      }x${(l.bottom ?? 0) - (l.top ?? 0)}`
    console.log(
      `\n链#${chains} @ ${where}  基底「${base.name}」${r(base)}` +
        `${base.transparent ? ' [空基底]' : ''}${base.hidden ? ' [隐藏]' : ''}`
    )
    for (const c of clippees) {
      const cw = (c.right ?? 0) - (c.left ?? 0)
      const ch = (c.bottom ?? 0) - (c.top ?? 0)
      const bw = (base.right ?? 0) - (base.left ?? 0)
      const bh = (base.bottom ?? 0) - (base.top ?? 0)
      console.log(
        `   ├ 剪贴层「${c.name}」${r(c)}  相对基底 ${
          bw ? Math.round((cw / bw) * 100) : '?'
        }%x${bh ? Math.round((ch / bh) * 100) : '?'  }%  mask=${c.mask ? `X${c.mask.left ?? 0} Y${c.mask.top ?? 0} ${c.mask.right ?? 0}x${c.mask.bottom ?? 0}` : '-'}`
      )
    }
  }
}
walk(psd.children ?? [], 0, 'root')
console.log(`\n共 ${chains} 条剪贴链；文档 ${psd.width}x${psd.height}`)
