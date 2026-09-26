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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>
)
