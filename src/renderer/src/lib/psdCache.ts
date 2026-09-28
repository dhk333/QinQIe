// PSD 详情页结构缓存：重开同一文件时跳过主线程 readPsd 结构解析。
// 结构树 + 去位图的合成器节点树存 JSON，内嵌合成图存 WebP，随主进程落 userData/psd-cache；
// 键 = md5(路径|大小|mtime)，源文件一变即换新键自动失效，旧条目由主进程封顶清理。
// 缓存是尽力而为：读写任何一步失败都静默回退全量解析，不弹错误。
import type { PsdDoc, PsdLayer } from '@/types'
import type { RNode } from './compositor'

export interface PsdCacheEntry {
  v: 1
  doc: PsdDoc
  tree: PsdLayer[]
  rnodes: RNode[]
}

export async function readPsdCache(
  path: string
): Promise<{ entry: PsdCacheEntry; preview: HTMLCanvasElement | null } | null> {
  try {
    const res = await window.api.psdCacheRead(path)
    const entry = res?.entry as PsdCacheEntry | undefined
    if (!res?.hit || entry?.v !== 1 || !entry.tree?.length || !Array.isArray(entry.rnodes)) {
      return null
    }
    let preview: HTMLCanvasElement | null = null
    if (res.preview) {
      const img = new Image()
      img.src = res.preview
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')?.drawImage(img, 0, 0)
      preview = c
    }
    return { entry, preview }
  } catch {
    return null
  }
}

/** 拷给缓存前甩掉全部画布/位图引用：结构化克隆带不动 canvas，位图由 Worker 解码重新生成 */
export function stripRNodeCanvases(nodes: RNode[]): RNode[] {
  const walk = (n: RNode): RNode => ({
    ...n,
    canvas: null,
    bitmap: null,
    seg: null,
    _sig: undefined,
    _sigKey: undefined,
    _lc: undefined,
    _indep: undefined,
    mask: n.mask ? { ...n.mask, canvas: null } : n.mask,
    children: n.children?.map(walk)
  })
  return nodes.map(walk)
}

/** 解析成功后异步写缓存：WebP 编码放在 2s 后，避开打开瞬间的入场动画 */
export function writePsdCache(
  path: string,
  doc: PsdDoc,
  tree: PsdLayer[],
  rnodes: RNode[],
  composite: HTMLCanvasElement | null
): void {
  void (async () => {
    try {
      await new Promise((r) => setTimeout(r, 2000))
      let preview: { bytes: Uint8Array; ext: 'webp' | 'png' } | undefined
      if (composite) {
        const blob = await new Promise<Blob | null>((resolve) =>
          composite.toBlob(resolve, 'image/webp', 0.85)
        )
        if (blob) {
          preview = {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            ext: blob.type === 'image/png' ? 'png' : 'webp'
          }
        }
      }
      if (!preview) return // 无预览的条目读回来永远 miss，写了也白写
      const entry: PsdCacheEntry = { v: 1, doc, tree, rnodes: stripRNodeCanvases(rnodes) }
      await window.api.psdCacheWrite(path, { entry, preview })
    } catch {
      // 缓存失败不影响本次打开
    }
  })()
}
