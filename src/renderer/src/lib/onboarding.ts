import { useSyncExternalStore } from 'react'

export type TourPage = 'home' | 'project' | 'detail'

export interface TourStep {
  id: string
  /** 该步所在页面；目标不在此页时由引导自行导航 */
  page: TourPage
  /** spotlight 目标选择器，null = 不指向具体元素 */
  anchor: string | null
  title: string
  desc: string
}

/** 顺序即播放顺序；文案为中文原文，渲染时过 t() */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'create-project',
    page: 'home',
    anchor: '#btn-new-project',
    title: '先建一个项目',
    desc: '项目用来归类同一批设计稿。点右上角「新建项目」即可，PSD 只记录路径、不会被移动。'
  },
  {
    id: 'upload-psd',
    page: 'project',
    anchor: '#btn-upload-psd',
    title: '上传 PSD',
    desc: '进入项目后点「上传 PSD」，支持一次多选。解析全在本地完成，源文件不会被改动。'
  },
  {
    id: 'layer-tree',
    page: 'detail',
    anchor: '#layer-tree',
    title: '图层树',
    desc: '在这里看层级、点选与隐藏图层。右键多选图层可以批量导出，或直接「从图层创建切片」。'
  },
  {
    id: 'canvas',
    page: 'detail',
    anchor: '#canvas-view',
    title: '画布与测距',
    desc: '滚轮平移、Ctrl+滚轮缩放、按住空格拖拽。悬停图层时会量出它与选中图层的边到边间距。'
  },
  {
    id: 'zoom-bar',
    page: 'detail',
    anchor: '#zoom-bar',
    title: '工具条：选框 / 切片',
    desc: '切到切片工具后在画布上拖拽，即可得到精确的 X / Y / W / H。'
  },
  {
    id: 'batch-bar',
    page: 'detail',
    anchor: '#batch-bar',
    title: '批量导出',
    desc: '选好切片或图层，一次设定格式、导出倍数与质量，整批出图。'
  },
  {
    id: 'export-section',
    page: 'detail',
    anchor: '#properties-panel',
    title: '单个导出与快捷键',
    desc: '属性面板底部的「导出」分组是当前选中对象的出图参数。任何时候按 ? 都能查看全部快捷键。'
  }
]

let running = false
const subs = new Set<() => void>()

function setRunning(next: boolean): void {
  if (running === next) return
  running = next
  subs.forEach((f) => f())
}

/** 从头播放新手引导 */
export function startOnboarding(): void {
  setRunning(true)
}

export function stopOnboarding(): void {
  setRunning(false)
}

export function useOnboardingRunning(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => running
  )
}
