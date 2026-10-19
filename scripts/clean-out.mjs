// 清掉 out/：electron-vite 不会删掉旧 hash 的 chunk，而 build.files=["out/**"] 会把它们
// 一起打进 asar——分享版里旧包残留的文案就是这么漏出去的。两种构建前都先跑这个。
// 注意：本机 Node 的 fs.rmSync(recursive) 会「正常返回但一个文件都不删」，必须走 cmd 的 rmdir。
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'

const rmdir = (p) => spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', p], { stdio: 'inherit' })

const r = rmdir('out')
if (r.status !== 0) console.log('[clean-out] rmdir 返回 ' + r.status + '，逐个子目录重试')
if (existsSync('out')) for (const name of readdirSync('out')) rmdir('out/' + name)
const left = existsSync('out') ? readdirSync('out') : []
if (left.length) {
  console.error('[clean-out] out/ 仍有残留，拒绝继续（否则残留 chunk 会进包）：' + left.join(', '))
  process.exit(1)
}
console.log('[clean-out] out/ 已清空')
