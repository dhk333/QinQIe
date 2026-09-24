import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// ========== Toast ==========
type ToastType = 'success' | 'warning' | 'error'
interface ToastItem {
  id: number
  msg: string
  type: ToastType
}

const ToastCtx = createContext<(msg: string, type?: ToastType) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

const TOAST_ICONS: Record<ToastType, ReactNode> = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16v.5" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  )
}

// ========== Dialog ==========
export interface DialogOptions {
  type?: 'prompt' | 'confirm'
  title: string
  desc?: string
  value?: string
  placeholder?: string
  okText?: string
  danger?: boolean
}

type DialogFn = (opts: DialogOptions) => Promise<string | null | boolean>
const DialogCtx = createContext<DialogFn>(async () => null)
export const useDialog = () => useContext(DialogCtx)

interface DialogState {
  opts: DialogOptions
  resolve: (v: string | null | boolean) => void
}

function DialogModal({ state, onClose }: { state: DialogState; onClose: (v: string | null | boolean) => void }) {
  const { opts } = state
  const isPrompt = opts.type !== 'confirm'
  const [value, setValue] = useState(opts.value ?? '')
  const [closing, setClosing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isPrompt) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      okRef.current?.focus()
    }
  }, [isPrompt])

  const close = useCallback(
    (val: string | null | boolean) => {
      setClosing(true)
      setTimeout(() => onClose(val), 130)
    },
    [onClose]
  )

  const submit = useCallback(() => {
    if (isPrompt) {
      const v = value.trim()
      if (!v) {
        inputRef.current?.focus()
        return
      }
      close(v)
    } else {
      close(true)
    }
  }, [isPrompt, value, close])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(isPrompt ? null : false)
      if (e.key === 'Enter' && document.activeElement === inputRef.current) submit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close, submit, isPrompt])

  const okDisabled = isPrompt && !value.trim()

  return (
    <div
      className={`modal-mask${closing ? ' closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(isPrompt ? null : false)
      }}
    >
      <div className="modal">
        <h3>{opts.title}</h3>
        {opts.desc && <p>{opts.desc}</p>}
        {isPrompt && (
          <input
            ref={inputRef}
            value={value}
            placeholder={opts.placeholder}
            maxLength={30}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="row2">
          <button className="btn btn-ghost" onClick={() => close(isPrompt ? null : false)}>
            取消
          </button>
          <button
            ref={okRef}
            className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={okDisabled}
            onClick={submit}
          >
            {opts.okText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialogState, setDialogState] = useState<DialogState | null>(null)

  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((ts) => [...ts, { id, msg, type }])
    setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id))
    }, 2500)
  }, [])

  const ask = useCallback<DialogFn>(
    (opts) => new Promise((resolve) => setDialogState({ opts, resolve })),
    []
  )

  return (
    <ToastCtx.Provider value={toast}>
      <DialogCtx.Provider value={ask}>
        {children}
        <div id="toast-wrap">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              {TOAST_ICONS[t.type]}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
        {dialogState && (
          <DialogModal
            state={dialogState}
            onClose={(v) => {
              dialogState.resolve(v)
              setDialogState(null)
            }}
          />
        )}
      </DialogCtx.Provider>
    </ToastCtx.Provider>
  )
}
