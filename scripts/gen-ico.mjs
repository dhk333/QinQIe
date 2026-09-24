// 从 build/icon.svg 生成多尺寸 build/icon.ico（PNG 条目，Vista+ 兼容）
import fs from 'node:fs'
import pkg from '@resvg/resvg-js'

const { Resvg } = pkg
const svg = fs.readFileSync(new URL('../build/icon.svg', import.meta.url), 'utf8')
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((s) => {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s } })
  return { size: s, data: r.render().asPng() }
})

const count = pngs.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(count, 4)

let offset = 6 + count * 16
const entries = pngs.map(({ size, data }) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0)
  e.writeUInt8(size >= 256 ? 0 : size, 1)
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += data.length
  return e
})

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
fs.writeFileSync(new URL('../build/icon.ico', import.meta.url), ico)
console.log('build/icon.ico written,', ico.length, 'bytes,', count, 'entries')
