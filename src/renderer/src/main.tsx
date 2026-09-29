import React from 'react'
import ReactDOM from 'react-dom/client'
import { UiProvider } from './lib/ui'
import './lib/keymapSettings' // 载入用户自定义键位（覆盖共享 keymap），须早于使用方
import { applyTheme, loadTheme } from './lib/themes'
import { applyFontSize, loadFontSize } from './lib/uiFont'
import App from './App'
import './styles.css'

document.body.classList.add('light')
applyTheme(loadTheme()) // 首帧前应用已保存主题，避免闪色
applyFontSize(loadFontSize()) // 同理，避免界面缩放跳变

// dev 诊断：React 的无限更新循环警告不带组件栈就只是一句空话，
// 这里把 console.error 的附加参数（组件栈）截下来回传主进程落日志
if (import.meta.env.DEV) {
  const origConsoleError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      const first = String(args[0] ?? '')
      if (first.includes('Maximum update depth')) {
        const stack = args
          .slice(1)
          .filter((a): a is string => typeof a === 'string' && a.includes('at '))
          .join('\n')
        window.api.rendererLog(`${first}\n${stack}`)
      }
    } catch {
      // 诊断通道失败不影响原行为
    }
    origConsoleError(...args)
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>
)
