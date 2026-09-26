import { useEffect } from 'react'
import ShortcutsPanel from './ShortcutsPanel'

interface Props {
  onClose: () => void
}

/** ? 呼出的快捷键弹窗壳：遮罩 + 标题 + 共享面板 */
export default function ShortcutsOverlay({ onClose }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // 面板处于「等待新按键」捕获态时不关窗，交给面板处理
      if (document.querySelector('.sc-bind.capturing')) return
      if (e.key === 'Escape' || e.key === '?') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [onClose])

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="sc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <h3>快捷键</h3>
          <span className="sc-sub">对齐 MasterGo 画布操作习惯 · 点击键帽可按新按键自定义</span>
        </div>
        <ShortcutsPanel />
      </div>
    </div>
  )
}
