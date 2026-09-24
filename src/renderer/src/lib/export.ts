import type { ExportFormat, PsdLayer } from '@/types'

export function layerToDataUrl(
  layer: PsdLayer,
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  scale: number
): string {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(layer.width * scale))
  c.height = Math.max(1, Math.round(layer.height * scale))
  const ctx = c.getContext('2d')!
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.scale(scale, scale)
  ctx.drawImage(canvas, 0, 0)
  return c.toDataURL(`image/${format}`, 0.92)
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
  if (color && !layer.isText) {
    lines.push(`background-color: ${color};`)
  }
  if (layer.isText) {
    lines.push('/* 文本图层：字体样式可在后续版本导出 */')
  }
  return lines.join('\n')
}
