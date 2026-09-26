import { useEffect, useReducer, useState } from 'react'
import {
  KEY_COMMANDS,
  type KeyCommand,
  chordFromEvent,
  effectiveDisplay,
  findChordConflict,
  getOverride
} from '@shared/keymap'
import { clearOverride, getOverrides, resetAllOverrides, setOverride, subscribeKeymap } from '@/lib/keymapSettings'

const GROUPS: KeyCommand['group'][] = ['工具', '视图', '选择', '编辑', '图层', '导出', '界面']

/** 快捷键列表 + 点击键帽自定义，设置页与 ? 弹窗共用 */
export default function ShortcutsPanel() {
  const [captureId, setCaptureId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => subscribeKeymap(bump), [])

  // 捕获模式：capture 阶段吞掉按键，阻止页面命令分发器与弹窗关闭逻辑
  useEffect(() => {
    if (!captureId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        setCaptureId(null)
        return
      }
      const chord = chordFromEvent(e)
      if (!chord) return
      const conflict = findChordConflict(captureId, chord)
      setOverride(captureId, [chord])
      setCaptureId(null)
      setFlash(conflict ? `已绑定，但与「${conflict.label}」键位相同，可去设置该命令解决` : '')
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [captureId])

  const customCount = Object.keys(getOverrides()).length

  return (
    <div className="sc-panel">
      <div className="sc-body">
        {GROUPS.map((g) => {
          const cmds = KEY_COMMANDS.filter((c) => c.group === g && c.chords.length)
          if (!cmds.length) return null
          return (
            <section key={g} className="sc-group">
              <h4>{g}</h4>
              {cmds.map((c) => {
                const custom = !!getOverride(c.id)
                const capturing = captureId === c.id
                return (
                  <div key={c.id} className="sc-row">
                    <span>{c.label}</span>
                    <span className="sc-acts">
                      {custom && !capturing && (
                        <button
                          className="sc-reset"
                          title="恢复默认键位"
                          onClick={() => clearOverride(c.id)}
                        >
                          ↺
                        </button>
                      )}
                      <button
                        className={`kbd sc-bind${capturing ? ' capturing' : ''}${custom ? ' custom' : ''}`}
                        onClick={() => {
                          setFlash('')
                          setCaptureId(capturing ? null : c.id)
                        }}
                      >
                        {capturing ? '按下新按键…' : effectiveDisplay(c)}
                      </button>
                    </span>
                  </div>
                )
              })}
            </section>
          )
        })}
        {KEY_COMMANDS.filter((c) => !c.chords.length && c.group === '编辑').map((c) => (
          <div key={c.id} className="sc-row">
            <span>{c.label}</span>
            <kbd className="kbd">{c.display}</kbd>
          </div>
        ))}
      </div>
      <div className="sc-foot">
        {flash ? <span className="sc-warn">{flash}</span> : <span />}
        <button className="btn btn-secondary" disabled={!customCount} onClick={resetAllOverrides}>
          全部恢复默认
        </button>
      </div>
    </div>
  )
}
