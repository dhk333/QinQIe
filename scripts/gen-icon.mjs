import { readFileSync, writeFileSync } from 'fs'
import pkg from '@resvg/resvg-js'
const { Resvg } = pkg

const svg = readFileSync(new URL('../build/icon.svg', import.meta.url))
const targets = [
  [1024, '../build/icon.png'],
  [256, '../build/icon-256.png']
]
for (const [size, out] of targets) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(new URL(out, import.meta.url), png)
}
console.log('icons generated')
