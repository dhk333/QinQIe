// 让 Node 能直接 import 应用里的 .ts 模块（补上省略的扩展名），供保真回归脚本复用同一份源码
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 应用内模块互相 import 时都不写扩展名，Node 需要补上 .ts。
// 判据用「同目录是否真有这个 .ts 文件」而不是「spec 看着像不像带扩展名」：
// './psd'、'./clipping' 这类模块名本身就含点，按正则判断会误认为已带扩展名。
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:') && !spec.endsWith('.ts')) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(fileURLToPath(url))) return next(url.href, ctx)
    }
    return next(spec, ctx)
  }
})
