/**
 * 切图基准宽度换算：k = 基准宽 / 设计稿宽（如 2560 的稿按 1920 切 → k = 0.75）。
 * 图层坐标、切片坐标与图层编辑量一律存 PSD 原始像素，k 只作用在「读数、出图像素与 CSS 长度」
 * 这三类出口上，所以改基准不会动到已切的区域，切回去数值仍然精确。
 */
export function basisScale(basisWidth: number | undefined, docWidth: number): number {
  if (!basisWidth || basisWidth <= 0 || !docWidth || docWidth <= 0) return 1
  return basisWidth / docWidth
}

/** PSD 像素 → 基准像素（面板/画布上的读数） */
export const toBasis = (px: number, k: number): number => Math.round(px * k)

/** 基准像素 → PSD 像素（用户在面板里输入的值） */
export const fromBasis = (px: number, k: number): number => px / k
