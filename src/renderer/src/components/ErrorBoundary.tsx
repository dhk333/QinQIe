import { Component, type ReactNode } from 'react'

/**
 * React 渲染/副作用抛错（如「Maximum update depth exceeded」无限更新循环）的兜底。
 * 没有它，React 会直接卸载整棵组件树，用户看到的只剩白屏；
 * 有它则给出与主进程 render-process-gone 恢复页同一套话术：说明原因 + 3 秒自动重载。
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  private timer = 0

  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err }
  }

  componentDidCatch(err: Error): void {
    console.error('[boundary]', err)
  }

  componentDidUpdate(): void {
    if (this.state.err && !this.timer) {
      this.timer = window.setTimeout(() => location.reload(), 3000)
    }
  }

  componentWillUnmount(): void {
    window.clearTimeout(this.timer)
  }

  render(): ReactNode {
    if (!this.state.err) return this.props.children
    return (
      <div
        style={{
          flex: 1,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--bg, #f3f5f9)',
          color: 'var(--txt, #3a4150)'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>界面出错了</div>
          <div style={{ fontSize: 13, color: 'var(--txt-3, #6b7383)' }}>
            {this.state.err.message}
            <br />
            3 秒后自动重新加载，你的项目与编辑记录都已保存
          </div>
        </div>
      </div>
    )
  }
}
