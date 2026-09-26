// 「轻切」品牌标：裁切刀 + 切片选框（concept-d），颜色走 CSS 变量随主题切换
// 亮色 :root / 暗色 body.dark / 扩展主题各自覆盖 --logo-* 一组变量
const BLADE =
  'M761.974154 444.258462c-17.092923 12.130462-27.569231 25.403077-31.468308 39.463384-3.741538 14.139077-1.654154 31.665231 6.498462 52.578462L349.696 778.633846l-11.736615 2.284308 303.931077-428.740923 120.123076 92.081231z m-174.946462 66.166153a26.663385 26.663385 0 0 0-5.632 19.692308 26.781538 26.781538 0 0 0 30.089846 23.000615 26.663385 26.663385 0 0 0 23.552-29.577846 26.781538 26.781538 0 0 0-30.011076-23.04 26.781538 26.781538 0 0 0-17.99877 9.924923z'
const RING =
  'M587.027692 323.426462l225.20123-274.353231a10.082462 10.082462 0 0 1 14.139077-1.732923l136.900923 107.204923c4.332308 3.465846 5.12 9.806769 1.693539 14.178461l-225.083077 274.392616a10.082462 10.082462 0 0 1-14.178462 1.732923L652.209231 337.644308a10.161231 10.161231 0 0 1-1.772308-14.217846z'
// 切片选框（圆角矩形描边路径），用于描边动画模式
const FRAME =
  'M148 118 h216 a30 30 0 0 1 30 30 v216 a30 30 0 0 1 -30 30 h-216 a30 30 0 0 1 -30 -30 v-216 a30 30 0 0 1 30 -30 z'

interface Props {
  size?: number
  /** 加载动画：三层轮廓依次描出 */
  animated?: boolean
  className?: string
}

export default function AppLogo({ size = 24, animated = false, className }: Props) {
  if (animated) {
    return (
      <svg
        className={`logo-draw ${className ?? ''}`}
        viewBox="100 94 320 320"
        width={size}
        height={size}
        fill="none"
      >
        <path pathLength={1} d={FRAME} />
        <g transform="translate(-30.9 85.9) scale(0.42)">
          {/* 组被缩小 0.42，描边需反向放大才能与外框等粗 */}
          <path pathLength={1} d={BLADE} style={{ animationDelay: '0.15s', strokeWidth: 7 / 0.42 }} />
          <path pathLength={1} d={RING} style={{ animationDelay: '0.3s', strokeWidth: 7 / 0.42 }} />
        </g>
      </svg>
    )
  }
  return (
    <svg className={className} viewBox="100 94 320 320" width={size} height={size}>
      <rect x="118" y="118" width="276" height="276" rx="30" fill="var(--logo-sheet)" />
      <rect
        x="118"
        y="118"
        width="276"
        height="276"
        rx="30"
        fill="none"
        stroke="var(--logo-frame)"
        strokeWidth="7"
        strokeDasharray="18 14"
      />
      <g transform="translate(-30.9 85.9) scale(0.42)">
        <path d={BLADE} fill="var(--logo-blade)" />
        <path d={RING} fill="var(--logo-ring)" />
      </g>
    </svg>
  )
}
