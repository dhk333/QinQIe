import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// 分享版构建开关：QQ_SHARE=1 时 GitHub 更新检查与内置更新记录整块不进包
// （见 scripts/dist-share.mjs；npm run dist 不带这个变量）
const SHARE = !!process.env.QQ_SHARE
const define = { __QQ_SHARE__: JSON.stringify(SHARE) }

export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    define,
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define,
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
