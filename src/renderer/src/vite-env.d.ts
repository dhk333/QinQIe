// electron-vite/Vite 的 ?worker 导入的模块声明（tsconfig.web 未引 vite/client）
declare module '*?worker' {
  const workerConstructor: { new (): Worker }
  export default workerConstructor
}
