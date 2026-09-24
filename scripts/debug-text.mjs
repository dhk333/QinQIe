import { readFileSync } from 'fs'
import { readPsd, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'

initializeCanvas((w, h) => createCanvas(w, h))

const buf = readFileSync(process.argv[2])
const psd = readPsd(new Uint8Array(buf), { skipLinkedFilesData: true, skipThumbnail: true })

let count = 0
const walk = (layers) => {
  for (const l of layers ?? []) {
    if (l.text) {
      count++
      if (count <= 2) {
        console.log('=== layer:', l.name)
        console.log(JSON.stringify(l.text, (k, v) => (k === 'canvas' || typeof v === 'function' ? '<skip>' : v), 2))
      }
    }
    if (l.children) walk(l.children)
  }
}
walk(psd.children)
console.log('text layers:', count)
