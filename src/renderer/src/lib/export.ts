import type { ExportFormat, PsdLayer } from '@/types'

function canvasToBlob(canvas: HTMLCanvasElement, format: ExportFormat, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), `image/${format}`, quality ?? 0.92)
  })
}

/**
 * 缩放 + 编码一步到位；srcRect 用于从大画布（整图合成）裁出区域再放大。
 * 返回字节而非 base64，交给主进程直接落盘。
 */
export async function exportCanvasBytes(
  src: HTMLCanvasElement,
  opts: { scale: number; format: ExportFormat; quality?: number; srcRect?: { x: number; y: number; w: number; h: number } }
): Promise<Uint8Array | null> {
  const { scale, format, quality, srcRect } = opts
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round((srcRect?.w ?? src.width) * scale))
  c.height = Math.max(1, Math.round((srcRect?.h ?? src.height) * scale))
  const ctx = c.getContext('2d')!
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.scale(scale, scale)
  if (srcRect) ctx.drawImage(src, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, srcRect.w, srcRect.h)
  else ctx.drawImage(src, 0, 0)
  const blob = await canvasToBlob(c, format, quality)
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}

export function sampleColor(canvas: HTMLCanvasElement): string | null {
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null
    const d = ctx.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    ).data
    if (d[3] === 0) return null
    return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  } catch {
    return null
  }
}

export function layerCssSnippet(layer: PsdLayer, color: string | null): string {
  const lines = [`width: ${layer.width}px;`, `height: ${layer.height}px;`]
  if (layer.isText && layer.textInfo) {
    const ti = layer.textInfo
    if (ti.fontSize) lines.push(`font-size: ${ti.fontSize}px;`)
    if (ti.fontFamily) {
      const fam = ti.fontFamily.replace(/-(Bold|Light|Regular|Medium|Thin|Black|Heavy)$/i, '')
      lines.push(`font-family: '${fam}', sans-serif;`)
    }
    if (ti.fontWeight === 'bold') lines.push('font-weight: 700;')
    if (ti.color) lines.push(`color: ${ti.color};`)
    return lines.join('\n')
  }
  if (color) lines.push(`background-color: ${color};`)
  return lines.join('\n')
}
