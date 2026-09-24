// 让 Node 能直接 import 应用里的 .ts 模块（补上省略的扩展名），供保真回归脚本复用同一份源码
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[A-Za-z]+$/.test(spec) && ctx.parentURL?.startsWith('file:')) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(fileURLToPath(url))) return next(url.href, ctx)
    }
    return next(spec, ctx)
  }
})
