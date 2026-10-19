// 分享版打包：QQ_SHARE=1 → __QQ_SHARE__=true，GitHub 更新检查与内置更新记录整块不进包。
// 打包前后各扫一遍产物，身份串（仓库名/作者/api.github.com）和更新记录正文一旦命中就直接失败，
// 不 relying 于「看起来没显示」。先在临时目录打包（避开工作区里被杀软占句柄的产物目录），
// 成功后只把安装包拷回 release-share/，不会覆盖自用版的 release/。
import { spawnSync } from 'node:child_process'
import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OUT = 'out'
const SHARE_DIR = 'release-share'
const BUILD_ROOT = join(tmpdir(), 'qingqie-share-build')
const MAX = 5

// 必须 0 命中：泄露身份或更新记录内容（'GitHub' 大写形式只可能来自我们的文案，
// 依赖库自带的是小写 github.com 链接，归到 WATCH 里只报数）
const FORBIDDEN = [
  'dhk333',
  'QinQIe',
  'daihongkun',
  'api.github.com',
  'GitHub',
  '文本字号修正 + CSS 片段能直接抄了',
  '剪贴蒙版所见即所得：选中的就是看到的那块'
]
// 只报计数：第三方库的仓库主页链接
const WATCH = ['github.com']

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: process.env, ...opts })

const fail = (msg) => {
  console.error(`\n[dist-share] ${msg}`)
  process.exit(1)
}

/** 递归收集待检文件（含 app.asar 这类二进制容器，用 latin1 读做子串匹配） */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (st.isFile()) yield p
  }
}

const scan = (root, label) => {
  if (!existsSync(root)) fail(`找不到 ${root}，先跑 electron-vite build`)
  const hits = []
  const watches = {}
  for (const file of walk(root)) {
    if (file.includes('localization') || /\.(png|ico|jpg|webp)$/.test(file)) continue
    const text = readFileSync(file).toString('latin1')
    for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${needle} ← ${file}`)
    for (const needle of WATCH) {
      const n = text.split(needle).length - 1
      if (n) watches[needle] = (watches[needle] || 0) + n
    }
  }
  if (hits.length) {
    console.error(`\n[dist-share] ${label} 命中禁用串，包不能外发：`)
    for (const h of hits) console.error('  - ' + h)
    process.exit(1)
  }
  const w = Object.entries(watches)
    .map(([k, v]) => `${k}×${v}`)
    .join(' ')
  console.log(`[dist-share] ${label} 禁用串 0 命中${w ? `；通用词计数：${w}` : ''}`)
}

const wait = (ms) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    /* busy wait */
  }
}

process.env.QQ_SHARE = '1'
console.log('[dist-share] 1/3 构建（QQ_SHARE=1）')
if (run('node', ['scripts/clean-out.mjs']).status !== 0) fail('clean-out 失败')
if (run('npx', ['electron-vite', 'build']).status !== 0) fail('electron-vite build 失败')
scan(OUT, 'out/')

// 走临时配置文件：CLI 的 --config.publish=null 会被当成一个叫 "null" 的发布器去 require
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const cfgFile = 'electron-builder.share.json'

/**
 * 每一尝试都用一个全新输出目录：Windows  Defender / 杀软会给刚写出的 app.asar 挂上句柄，
 * electron-builder 重试时对旧目录做 EnsureEmptyDir 删不掉就直接整体失败（本机稳定复现）。
 * 换目录等于跳过这一步，剩下的只有 rcedit 改 exe 图标那一步需要等句柄释放。
 * 目录放临时区而不是工作区，避免工作区索引再往这些大二进制上插一手。
 */
console.log(`[dist-share] 2/3 打包（appId/author 去身份、publish 关掉，工作区外临时目录 ${BUILD_ROOT}）`)
let packed = null
for (let i = 1; i <= MAX && !packed; i++) {
  const outDir = join(BUILD_ROOT, `t${Date.now()}`)
  const cfg = {
    ...pkg.build,
    // 自用版是 com.daihongkun.qingqie，分享版换中性 id，注册表/卸载项里也不带个人名
    appId: 'com.qingqie.app',
    extraMetadata: { ...(pkg.build.extraMetadata || {}), author: 'qingqie' },
    // 不给发布源：electron-builder 会自己从 git remote 推出 owner/repo 写进 app-update.yml
    publish: null,
    directories: { ...(pkg.build.directories || {}), output: outDir }
  }
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`\n[dist-share] 第 ${i}/${MAX} 次尝试 → ${outDir}`)
  if (run('npx', ['electron-builder', '--win', '--config=' + cfgFile]).status === 0) packed = outDir
  else if (i < MAX) wait(20000 * i)
}
spawnSync('cmd', ['/c', 'del', '/q', '/f', cfgFile], { stdio: 'ignore' })
if (!packed) fail(`${MAX} 次打包都没成功，看上面的 electron-builder 报错`)

console.log('[dist-share] 3/3 校验安装包内容并拷回工作区')
const unpacked = join(packed, 'win-unpacked')
if (!existsSync(join(unpacked, 'resources', 'app.asar'))) fail(`缺 ${unpacked}/resources/app.asar`)
// publish 关掉后不应再生成带 github 源的 app-update.yml
const upd = join(unpacked, 'resources', 'app-update.yml')
if (existsSync(upd)) {
  console.error('[dist-share] 仍生成了 app-update.yml（自动更新源信息），内容如下：')
  console.error(readFileSync(upd, 'utf8'))
  process.exit(1)
}
// 只扫 resources/：Electron 自身的 dll/pak 有几百 MB，且不含我们的文案
scan(join(unpacked, 'resources'), 'win-unpacked/resources/')

mkdirSync(SHARE_DIR, { recursive: true })
const exes = readdirSync(packed).filter((f) => f.endsWith('.exe'))
if (!exes.length) fail(`${packed} 里没有 .exe 安装包`)
for (const f of exes) copyFileSync(join(packed, f), join(SHARE_DIR, f))
rmSync(packed, { recursive: true, force: true })
console.log(
  `\n[dist-share] 完成，可外发的安装包：\n  ${SHARE_DIR}/${exes.join(`\n  ${SHARE_DIR}/`)}`
)
