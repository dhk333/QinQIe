import { readPsd, type Layer, type Psd } from 'ag-psd'
import type { PsdDoc, PsdLayer } from '@/types'

export interface ParseResult {
  doc: PsdDoc
  tree: PsdLayer[]
  canvasMap: Map<number, HTMLCanvasElement>
}

let nextId = 1

// ag-psd 的 mask.canvas 用 RGB 明度编码蒙版（alpha 恒为 255），
// 这里转成 alpha 并烘焙进图层 canvas，mask 矩形之外的区域用 defaultColor 填充
function bakeMask(layer: Layer): HTMLCanvasElement | null {
  const mask = layer.mask
  if (!mask || mask.disabled || !layer.canvas) return null
  const l = layer.left ?? 0
  const t = layer.top ?? 0
  const mL = mask.left ?? 0
  const mT = mask.top ?? 0
  const uL = Math.min(mL, l)
  const uT = Math.min(mT, t)
  const uR = Math.max(mask.right ?? mL, (layer.right ?? 0))
  const uB = Math.max(mask.bottom ?? mT, (layer.bottom ?? 0))
  const uw = Math.max(1, uR - uL)
  const uh = Math.max(1, uB - uT)

  const plane = document.createElement('canvas')
  plane.width = uw
  plane.height = uh
  const pctx = plane.getContext('2d')!
  const def = mask.defaultColor ?? 0
  pctx.fillStyle = `rgb(${def},${def},${def})`
  pctx.fillRect(0, 0, uw, uh)
  if (mask.canvas) pctx.drawImage(mask.canvas, mL - uL, mT - uT)

  const img = pctx.getImageData(0, 0, uw, uh)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i]
    d[i] = 255
    d[i + 1] = 255
    d[i + 2] = 255
  }
  pctx.putImageData(img, 0, 0)

  const out = document.createElement('canvas')
  out.width = layer.canvas.width
  out.height = layer.canvas.height
  const octx = out.getContext('2d')!
  octx.drawImage(layer.canvas, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(plane, uL - l, uT - t)
  return out
}

function toNode(layer: Layer, canvasMap: Map<number, HTMLCanvasElement>): PsdLayer {
  const id = nextId++
  const canvas = layer.canvas
  if (canvas) canvasMap.set(id, canvas)
  const baked = bakeMask(layer)
  if (baked) canvasMap.set(id, baked)
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  return {
    id,
    name: layer.name?.trim() || (layer.children ? '未命名组' : '未命名图层'),
    type: layer.children ? 'group' : 'layer',
    left,
    top,
    width: (layer.right ?? left) - left,
    height: (layer.bottom ?? top) - top,
    // ag-psd v29 的 opacity 已归一化为 0~1，不要再除以 255
    opacity: layer.opacity ?? 1,
    hidden: !!layer.hidden,
    isText: !!layer.text,
    clipping: !!layer.clipping,
    blendMode: layer.blendMode ?? 'normal',
    children: layer.children?.length ? layer.children.map((c) => toNode(c, canvasMap)) : undefined
  }
}

export function parsePsd(buffer: Uint8Array, fileName: string): ParseResult {
  const psd: Psd = readPsd(buffer, { skipLinkedFilesData: true, skipThumbnail: true })
  const canvasMap = new Map<number, HTMLCanvasElement>()
  let tree: PsdLayer[] = (psd.children ?? []).map((l) => toNode(l, canvasMap))
  if (tree.length === 0 && psd.canvas) {
    const id = nextId++
    canvasMap.set(id, psd.canvas)
    tree = [
      {
        id,
        name: fileName,
        type: 'layer',
        left: 0,
        top: 0,
        width: psd.width,
        height: psd.height,
        opacity: 1,
        hidden: false,
        isText: false,
        clipping: false,
        blendMode: 'normal'
      }
    ]
  }
  return { doc: { fileName, width: psd.width, height: psd.height }, tree, canvasMap }
}

export function flattenLayers(nodes: PsdLayer[], out: PsdLayer[] = []): PsdLayer[] {
  for (const n of nodes) {
    out.push(n)
    if (n.children) flattenLayers(n.children, out)
  }
  return out
}
