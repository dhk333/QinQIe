import { useCallback, useRef } from 'react'

interface SliderProps {
  min: number
  max: number
  step: number
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}

/** div 实现的滑杆：轨道/填充/圆形手柄全部走主题 token，替代原生 input[type=range] */
export default function Slider({ min, max, step, value, disabled, onChange }: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  const clampStep = (raw: number): number => {
    const snapped = Math.round(raw / step) * step
    return Math.min(max, Math.max(min, Number(snapped.toFixed(4))))
  }

  const setFromX = useCallback(
    (x: number) => {
      const el = trackRef.current
      if (!el || disabled) return
      const r = el.getBoundingClientRect()
      const t = r.width ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0
      onChange(clampStep(min + t * (max - min)))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step, disabled, onChange]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromX(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons & 1) setFromX(e.clientX)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const big = (max - min) / 10
    let next: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
    else if (e.key === 'PageDown') next = value - big
    else if (e.key === 'PageUp') next = value + big
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onChange(clampStep(next))
  }

  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div
      ref={trackRef}
      className={`ui-slider${disabled ? ' ui-slider-dis' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className="ui-slider-fill" style={{ width: `${pct}%` }} />
      <div className="ui-slider-knob" style={{ left: `${pct}%` }} />
    </div>
  )
}
