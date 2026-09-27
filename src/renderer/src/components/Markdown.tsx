import type { ReactNode } from 'react'

/** 命中则按 markdown 排版，否则维持原来的单段纯文本 */
const MD_MARK =
  /(^|\n)\s*(#{1,6} |[-*+] |\d+\. |> |```|---+\s*$)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g

function openExternal(url: string): void {
  window.open(url)
}

/** 行内只认 `代码`、**粗体**、[文字](链接)，其余一律当纯文本，不注入 HTML */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const tok = m[0]
    const key = `${keyBase}-i${n++}`
    if (tok[0] === '`') {
      out.push(
        <code
          key={key}
          className="rounded-[3px] bg-panel-3 px-[4px] py-[1px] font-mono text-[11px] break-all text-txt-2"
        >
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('**')) {
      out.push(
        <b key={key} className="font-semibold text-txt-2">
          {tok.slice(2, -2)}
        </b>
      )
    } else {
      const lm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok)
      if (lm) {
        out.push(
          <a
            key={key}
            className="cursor-pointer text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            onClick={(e) => {
              e.preventDefault()
              openExternal(lm[2])
            }}
          >
            {lm[1]}
          </a>
        )
      } else {
        out.push(tok)
      }
    }
    last = at + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface Block {
  kind: 'h' | 'p' | 'ul' | 'ol' | 'quote' | 'hr' | 'code'
  level?: number
  lines: string[]
}

function toBlocks(src: string): Block[] {
  const blocks: Block[] = []
  let fence: string[] | null = null
  let para: string[] = []
  let list: Block | null = null

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', lines: para })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }

  src.replace(/\r\n?/g, '\n').split('\n').forEach((raw) => {
    const line = raw.trimEnd()
    if (fence) {
      if (/^```\s*$/.test(line.trim())) {
        blocks.push({ kind: 'code', lines: fence })
        fence = null
      } else {
        fence.push(line)
      }
      return
    }
    if (/^```\s*$/.test(line.trim())) {
      flushPara()
      flushList()
      fence = []
      return
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    const ul = /^[-*+]\s+(.*)$/.exec(line)
    const ol = /^\d+[.)]\s+(.*)$/.exec(line)
    const quote = /^>\s?(.*)$/.exec(line)
    const plain = !h && !ul && !ol && !quote && line.trim() !== '' && !/^---+$/.test(line.trim())

    if (!plain) flushPara()
    if (!ul && !ol) flushList()

    if (!line.trim()) return
    if (h) {
      blocks.push({ kind: 'h', level: h[1].length, lines: [h[2]] })
    } else if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: 'hr', lines: [] })
    } else if (ul || ol) {
      const kind = ul ? 'ul' : 'ol'
      if (!list || list.kind !== kind) {
        flushList()
        list = { kind, lines: [] }
      }
      list.lines.push((ul ?? ol)![1])
    } else if (quote) {
      blocks.push({ kind: 'quote', lines: [quote[1]] })
    } else {
      para.push(line)
    }
  })
  flushPara()
  flushList()
  if (fence) blocks.push({ kind: 'code', lines: fence })
  return blocks
}

/** 弹窗一类的短文本渲染：够用即可，不支持表格、图片与嵌套列表 */
export default function Markdown({ text }: { text: string }): ReactNode {
  if (!MD_MARK.test(text)) return <p>{text}</p>
  return (
    <div
      id="md-view"
      className="flex min-h-0 max-h-[46vh] flex-col gap-[6px] overflow-y-auto pr-[2px] text-left"
    >
      {toBlocks(text).map((b, i) => {
        const key = `b${i}`
        switch (b.kind) {
          case 'h':
            return (
              <p
                key={key}
                className={`m-0 font-semibold text-txt ${b.level && b.level <= 2 ? 'mt-[4px]' : 'mt-[2px]'}`}
              >
                {inline(b.lines[0], key)}
              </p>
            )
          case 'ul':
          case 'ol':
            return b.kind === 'ul' ? (
              <ul
                key={key}
                className="m-0 flex list-disc flex-col gap-[3px] pl-[16px] text-[12px] leading-[19px] text-txt-3 marker:text-txt-3"
              >
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l, `${key}-${j}`)}</li>
                ))}
              </ul>
            ) : (
              <ol
                key={key}
                className="m-0 flex list-decimal flex-col gap-[3px] pl-[18px] text-[12px] leading-[19px] text-txt-3 marker:text-txt-3"
              >
                {b.lines.map((l, j) => (
                  <li key={j}>{inline(l, `${key}-${j}`)}</li>
                ))}
              </ol>
            )
          case 'quote':
            return (
              <p
                key={key}
                className="m-0 border-l-2 border-line-2 pl-[8px] text-[12px] leading-[19px] text-txt-3"
              >
                {inline(b.lines[0], key)}
              </p>
            )
          case 'hr':
            return <i key={key} className="my-[2px] block h-px bg-line-2" />
          case 'code':
            return (
              <pre
                key={key}
                className="m-0 overflow-x-auto rounded-[6px] bg-panel-3 p-[8px] font-mono text-[11px] leading-[17px] text-txt-2"
              >
                {b.lines.join('\n')}
              </pre>
            )
          default:
            return (
              <p key={key}>{inline(b.lines.join(' '), key)}</p>
            )
        }
      })}
    </div>
  )
}
