// electron-builder 打包重试器：Windows Defender 会短暂锁定刚复制出的 win-unpacked exe，
// 导致 addWinAsarIntegrity 报 UNKNOWN: unknown error，等待足够久后重试即可通过。
import { spawnSync } from 'node:child_process'

const MAX = 6
for (let i = 1; i <= MAX; i++) {
  const r = spawnSync('npx', ['electron-builder', '--win'], { stdio: 'inherit', shell: true })
  if (r.status === 0) process.exit(0)
  if (i < MAX) {
    const wait = 15000 * i
    console.log(`\n[dist-retry] 第 ${i} 次打包失败，${Math.round(wait / 1000)} 秒后重试（剩 ${MAX - i} 次）...\n`)
    const t = Date.now()
    while (Date.now() - t < wait) { /* busy wait */ }
  }
}
process.exit(1)
