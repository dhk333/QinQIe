import { readFileSync } from 'node:fs'
import Psd from '@webtoon/psd'

const file = 'D:/A-戴鸿锟/项目/2026/W-沃尔核材/psd/4-2 新闻资讯--公司动态--详情.psd'
const buf = readFileSync(file)
const psd = Psd.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

const layers = []
const walk = (ns) => ns.forEach((n) => { if (n.type === 'Group') walk(n.children); else layers.push(n) })
walk(psd.children)

const text = layers.find((l) => l.text)
console.log('=== text layer sample ===')
console.log('name:', text.name, '| .text type:', typeof text.text, '| value:', JSON.stringify(text.text).slice(0, 40))
const tp = text.textProperties
console.log('textProperties keys:', tp ? Object.keys(tp) : tp)
if (tp?.Style) {
  const run = tp.Style.StyleRun?.[0]
  console.log('StyleRun[0]:', JSON.stringify(run))
  const fontSet = tp.FontSet?.[run?.style?.Font?.value ?? 0]
  console.log('FontSet name:', fontSet?.Name?.value)
  console.log('fontSize:', run?.style?.FontSize, 'fillColor:', JSON.stringify(run?.style?.FillColor))
}

const masked = layers.find((l) => l.maskData?.realData?.width > 0)
console.log('=== masked layer ===')
console.log('name:', masked?.name, 'maskData present:', !!masked?.maskData)
if (masked) {
  const m = await masked.userMask()
  console.log('userMask bytes:', m?.length, '| w*h:', masked.width * masked.height)
}
