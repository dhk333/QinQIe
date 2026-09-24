import { useEffect, useState } from 'react'

export default function PsdThumb({ thumbPath, kind }: { thumbPath?: string; kind: 'cover' | 'thumb' }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSrc(null)
    if (thumbPath) {
      window.api.readDataUrl(thumbPath).then((d) => {
        if (alive) setSrc(d)
      })
    }
    return () => {
      alive = false
    }
  }, [thumbPath])

  if (src) return <img src={src} alt="" />
  if (kind === 'thumb') return null
  return (
    <div className="cover-fallback">
      <i className="h" />
      <i className="hero" />
      <i />
      <i style={{ width: '70%' }} />
    </div>
  )
}
