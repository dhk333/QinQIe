import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/i18n/core'

/** 关窗确认：导出与解析跑在渲染进程，直接退出会中断它们，所以先问一次去向 */
export default function CloseAskModal() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)

  const leave = useCallback((action: 'quit' | 'tray', keep: boolean) => {
    setOpen(false)
    window.api.winCloseChoice(action, keep)
  }, [])

  useEffect(() => {
    return window.api.onAskClose(() => {
      setRemember(false)
      setOpen(true)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div id="close-ask" className="modal" role="dialog" aria-modal="true">
        <h3>{t('关闭轻切？')}</h3>
        <p>{t('最小化到托盘后，正在进行的导出与解析会继续；退出应用会中断它们。')}</p>
        <label className="mt-[16px] flex cursor-pointer items-center gap-[7px] text-[12px] text-txt-2 select-none">
          <input
            type="checkbox"
            className="size-[14px] shrink-0 cursor-pointer accent-[var(--accent)]"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('不再询问')}
        </label>
        <div className="row2 mt-[18px]">
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>
            {t('取消')}
          </button>
          <button className="btn btn-secondary text-[#e5484d]!" onClick={() => leave('quit', remember)}>
            {t('退出应用')}
          </button>
          <button className="btn btn-primary" onClick={() => leave('tray', remember)}>
            {t('最小化到托盘')}
          </button>
        </div>
      </div>
    </div>
  )
}
