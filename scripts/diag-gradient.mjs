// 渐变图层普查：只读文件头部做结构解析（不读位图），列出所有带渐变的图层与其参数。
// 用法：node scripts/diag-gradient.mjs [--head=32] [psd...]   不带路径时扫 D:\A-戴鸿锟\项目\2026 下全部 PSD
import { readPsd } from 'ag-psd'
import { openSync, readSync, closeSync, statSync, readdirSync, readFileSync } from 'fs'

const argAll = []
let HEAD = 32
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--head=')) HEAD = Number(a.slice(7))
  else argAll.push(a)
}
const ROOT = 'D:\\A-戴鸿锟\\项目\\2026'
const files = argAll.length
  ? argAll
  : readdirSync(ROOT)
      .flatMap((d) => {
        try {
          return readdirSync(`${ROOT}\\${d}\\psd`).map((f) => `${ROOT}\\${d}\\psd\\${f}`)
        } catch {
          return []
        }
      })
      .filter((f) => /\.psd$/i.test(f))

/** 只读前 headMB 字节：PSD 的图层记录（名称/矢量/样式）都在前段，位图数据在后面 */
function readHead(path, headMB) {
  const size = statSync(path).size
  const len = Math.min(size, headMB * 1024 * 1024)
  const buf = Buffer.allocUnsafe(len)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, len, 0)
  } finally {
    closeSync(fd)
  }
  return { buf: new Uint8Array(buf.buffer, buf.byteOffset, len), truncated: len < size, size }
}

const hex = (c) =>
  c && `#${[c.r, c.g, c.b].map((v) => Math.round(v <= 1 ? v * 255 : v).toString(16).padStart(2, '0')).join('')}`
const stops = (g) =>
  (g?.colorStops ?? [])
    .map((s) => `${hex(s.color)}@${Math.round((s.location ?? 0) * 100) / 100}`)
    .join(' ')

const hits = []
for (const f of files) {
  let psd
  const parseOpts = {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipLinkedFilesData: true,
    skipThumbnail: true,
    useImageData: true
  }
  try {
    const { buf, truncated } = readHead(f, HEAD)
    psd = readPsd(buf, parseOpts)
    if (truncated) psd.__trunc = true
  } catch {
    try {
      // 头部截断会让尾部段落报「Section exceeds file size」，退回整文件只做结构解析
      const s = statSync(f).size
      if (s > 900 * 1024 * 1024) throw new Error(`文件过大 ${Math.round(s / 1048576)}MB`)
      psd = readPsd(readFileSync(f), parseOpts)
    } catch (e) {
      console.log(`跳过 ${f.split('\\').pop()}：${e.message.slice(0, 80)}`)
      continue
    }
  }
  const walk = (layers, path) => {
    for (const l of layers ?? []) {
      const p = `${path}/${l.name ?? '?'}`
      const vf = l.vectorFill
      const fxOff = l.effects?.disabled === true
      const go = fxOff ? [] : l.effects?.gradientOverlay?.filter((g) => g.enabled !== false) ?? []
      const strokeGrad = fxOff ? [] : (l.effects?.stroke ?? []).filter((s) => s.fillType === 'gradient')
      const kinds = []
      if (vf && vf.type && vf.type !== 'color') kinds.push(`矢量填充:${vf.type}`)
      if (go.length) kinds.push('样式:渐变叠加')
      if (strokeGrad.length) kinds.push('样式:渐变描边')
      // PS 不画但旧代码会画的：图层带着渐变样式、可「效果」总开关是关的
      const styleOnly =
        fxOff &&
        ((l.effects?.gradientOverlay?.length ?? 0) > 0 ||
          (l.effects?.stroke ?? []).some((s) => s.fillType === 'gradient'))
      if (kinds.length || styleOnly)
        hits.push({
          file: f.split('\\').pop(),
          path: p,
          rect: `${l.left ?? 0},${l.top ?? 0} ${Math.max(0, (l.right ?? 0) - (l.left ?? 0))}×${Math.max(0, (l.bottom ?? 0) - (l.top ?? 0))}`,
          clipping: !!l.clipping,
          hidden: !!l.hidden,
          detail: [
            ...kinds,
            styleOnly ? '样式:已关闭(旧代码会画)' : '',
            vf && vf.type !== 'color' ? `[${vf.style} angle=${vf.angle ?? '-'} scale=${vf.scale ?? '-'} ${stops(vf)}]` : '',
            ...go.map((g) => `[叠加 ${g.type ?? g.gradient?.style} angle=${g.angle ?? '-'} ${stops(g.gradient)}]`),
            ...strokeGrad.map((s) => `[描边 ${s.gradient?.style} ${stops(s.gradient)}]`)
          ]
            .filter(Boolean)
            .join(' ')
        })
      walk(l.children, p)
    }
  }
  walk(psd.children, psd.__trunc ? '(头部)' : '')
}

console.log(`\n共 ${hits.length} 个渐变图层 / 扫描 ${files.length} 个文件\n`)
for (const h of hits)
  console.log(`${h.file}  ${h.path}\n   ${h.rect}${h.clipping ? ' [剪贴]' : ''}${h.hidden ? ' [隐藏]' : ''}\n   ${h.detail}`)
