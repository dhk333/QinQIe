/**
 * 构建期常量，由 electron.vite.config.ts 的 define 注入（QQ_SHARE=1 → true）。
 * true 时 GitHub 更新检查、内置更新记录相关代码会被 Rollup 判为死分支整块剔出包，
 * scripts/dist-share.mjs 会 grep 产物确认这些字符串真的没进来。
 */
declare const __QQ_SHARE__: boolean
