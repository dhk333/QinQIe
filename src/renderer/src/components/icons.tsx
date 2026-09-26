interface IconProps {
  className?: string
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

export function EyeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  )
}

export function EyeOffIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.4 3.2M6.2 6.9A16.9 16.9 0 0 0 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  )
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-5 4 4 3-3 4 4" />
    </svg>
  )
}

export function TextIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M5 6V4.5h14V6" />
      <path d="M12 4.5V19.5M9 19.5h6" />
    </svg>
  )
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" />
      <path d="M4 19.5h16" />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function ZoomInIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M11 8.5v5M8.5 11h5" />
    </svg>
  )
}

export function ZoomOutIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5M8.5 11h5" />
    </svg>
  )
}

export function FitIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </svg>
  )
}

export function OpenIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M3 8V6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V8" />
      <path d="M3 8h18l-1.8 10a2 2 0 0 1-2 1.7H6.8a2 2 0 0 1-2-1.7L3 8Z" />
    </svg>
  )
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeWidth={1.8} strokeLinejoin="round">
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeWidth={1.8}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeWidth={1.8}>
      <path d="M12 19V8m0 0l-4.5 4.5M12 8l4.5 4.5" />
      <path d="M4 4.5h16" />
    </svg>
  )
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
    </svg>
  )
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </svg>
  )
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2L3.5 8.3" />
      <path d="M3.2 4.2v4.4h4.4" />
      <path d="M12 7.5V12l3.2 1.9" />
    </svg>
  )
}

export function CaretDownIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function MoveIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeLinejoin="round">
      <path d="M6 3l12 9-5.5 1L15 19l-2.5 1-2.4-5.8L6 17V3Z" />
    </svg>
  )
}

export function SliceIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeLinejoin="round">
      <path d="M6 3v7M18 3v7M6 10h12" />
      <path d="M12 10v5.5" />
      <rect x="4" y="15.5" width="16" height="5.5" rx="1.5" />
    </svg>
  )
}

export function PickerIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M13.5 6.5l4 4L8 20H4v-4l9.5-9.5Z" />
      <path d="M11.5 8.5l4 4M15 3.5a2.1 2.1 0 0 1 3 0l2.5 2.5a2.1 2.1 0 0 1 0 3L19 10.5" />
    </svg>
  )
}

export function HandIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeLinejoin="round">
      <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m-9-1v-1.5a1.5 1.5 0 0 0-3 0V16a5 5 0 0 0 5 5h3a5 5 0 0 0 5-5v-2" />
    </svg>
  )
}

export function PaletteIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-1.5a1.5 1.5 0 0 0-1.1 2.5c.4.5.6.9.6 1.4 0 .7-.6 1.1-1.5 1.1Z" />
      <path d="M7.5 10.5h.01M10.5 7h.01M14.5 7.5h.01M17 11h.01" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </svg>
  )
}

export function KeyboardIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.5h.01M9.5 12.5h.01M13 12.5h.01M16.5 12.5h.01M8 15.5h8" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

export function FontIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps} strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}
