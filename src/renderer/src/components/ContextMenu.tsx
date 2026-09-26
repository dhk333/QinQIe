import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label?: string
  danger?: boolean
  onClick?: () => void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/** 极简上下文菜单：portal 到 body，点外/Escape 关闭，贴边时自动翻转 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y, ready: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: x + width > innerWidth ? Math.max(4, x - width) : x,
      y: y + height > innerHeight ? Math.max(4, y - height) : y,
      ready: true
    })
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.label ? (
          <div
            key={i}
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              it.onClick?.()
              onClose()
            }}
          >
            {it.label}
          </div>
        ) : (
          <div key={i} className="ctx-sep" />
        )
      )}
    </div>,
    document.body
  )
}
