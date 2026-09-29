import { useEffect, useRef, useState } from 'react'
import type { DocSlice } from '@/types'
import { useT } from '@/i18n/core'

/** 切片选项编辑（PS 切片选项的精简版）：名称 + X/Y/W/H。
 *  确定写回；取消 / Esc / 点击遮罩放弃。数字输入直接回车提交 */
export default function SliceOptionsModal({
  slice,
  onClose,
  onSubmit
}: {
  slice: DocSlice
  onClose: () => void
  onSubmit: (patch: { name?: string; x: number; y: number; w: number; h: number }) => void
}) {
  const t = useT()
  const [name, setName] = useState(slice.name ?? '')
  const [x, setX] = useState(String(Math.round(slice.x)))
  const [y, setY] = useState(String(Math.round(slice.y)))
  const [w, setW] = useState(String(Math.round(slice.w)))
  const [h, setH] = useState(String(Math.round(slice.h)))
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const num = (v: string, min: number): number => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(min, Math.round(n)) : min
  }

  const inputCls =
    'min-w-0 flex-1 rounded-md border border-border bg-panel-2 px-2 py-1 font-mono text-[12px] text-txt outline-none transition-colors focus:border-accent'

  const submit = (): void => {
    onSubmit({
      name: name.trim() || undefined,
      x: num(x, 0),
      y: num(y, 0),
      w: Math.max(1, num(w, 1)),
      h: Math.max(1, num(h, 1))
    })
  }

  const fields: [string, string, (v: string) => void][] = [
    ['X', x, setX],
    ['Y', y, setY],
    ['W', w, setW],
    ['H', h, setH]
  ]

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal w-[320px]" role="dialog" aria-modal="true">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <h3>{t('切片选项')}</h3>
          <p>
            {t('切片{no}', { no: slice.no })}
            {slice.name?.trim() ? ` · ${slice.name.trim()}` : ''}
          </p>
          <label className="mt-3 flex items-center gap-2">
            <span className="w-9 shrink-0 text-[11.5px] text-txt-3">{t('名称')}</span>
            <input
              ref={nameRef}
              className={inputCls + ' font-sans'}
              value={name}
              maxLength={40}
              placeholder={t('切片{no}', { no: slice.no })}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
            {fields.map(([label, value, set]) => (
              <label key={label} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-right font-mono text-[11px] text-txt-3">{label}</span>
                <input
                  type="number"
                  className={inputCls}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="row2 mt-4">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {t('取消')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('确定')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
