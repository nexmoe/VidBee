import { MinusIcon, PlusIcon } from 'lucide-react'
import { type ComponentProps, memo, useMemo } from 'react'
import { type Components, type ExtraProps, Streamdown, type StreamdownProps } from 'streamdown'
import { promptStreamdownPlugins } from '../lib/agent-response-plugins'
import { cn } from '../lib/cn'
import { normalizePromptMarkdown } from '../lib/prompt-markdown'
import { wrapPromptClockNodes } from './agent-clock-text'

const ORDERED_LIST_CLASS =
  'list-outside list-decimal whitespace-normal ps-[1.5em] [li_&]:ps-[1.5em]'
const UNORDERED_LIST_CLASS =
  'list-outside list-disc whitespace-normal ps-[1.15em] [li_&]:ps-[1.15em]'
const LIST_ITEM_CLASS = '[&>:first-child]:mt-0 [&>p]:my-0 [&>p+p]:mt-1.5'
const DIAGRAM_ICONS = { ZoomInIcon: PlusIcon, ZoomOutIcon: MinusIcon }

export type ResponseProps = StreamdownProps & {
  /** Seek the player when a prompt clock token is clicked. */
  onSeek?: (seconds: number) => void
  theme?: string
}

/**
 * Ordered list with outside markers so wrapped lines line up with the
 * first line of item text, and the number stays on that first line.
 *
 * @param props Streamdown list props. `node` is stripped so it is not forwarded to the DOM.
 */
function MarkdownOl({
  children,
  className,
  node: _node,
  start,
  style,
  ...props
}: ComponentProps<'ol'> & ExtraProps) {
  const startAt = Number(start)
  const counterStart = Number.isFinite(startAt) && startAt >= 1 ? startAt - 1 : 0
  return (
    <ol
      className={cn(ORDERED_LIST_CLASS, className)}
      data-streamdown="ordered-list"
      start={start}
      style={{ ...style, counterReset: `transcript-list ${counterStart}` }}
      {...props}
    >
      {children}
    </ol>
  )
}

/**
 * Unordered list matching the ordered-list marker alignment.
 *
 * @param props Streamdown list props. `node` is stripped so it is not forwarded to the DOM.
 */
function MarkdownUl({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<'ul'> & ExtraProps) {
  return (
    <ul className={cn(UNORDERED_LIST_CLASS, className)} data-streamdown="unordered-list" {...props}>
      {children}
    </ul>
  )
}

/**
 * List item that keeps heading/paragraph margins from pushing the marker
 * onto its own line.
 *
 * @param props Streamdown list-item props. `node` is stripped so it is not forwarded to the DOM.
 */
function MarkdownLi({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<'li'> & ExtraProps) {
  return (
    <li className={cn(LIST_ITEM_CLASS, className)} data-streamdown="list-item" {...props}>
      {children}
    </li>
  )
}

const LIST_COMPONENTS: Components = {
  ol: MarkdownOl,
  ul: MarkdownUl,
  li: MarkdownLi
}

/**
 * Build Streamdown components that turn clock tokens into seek buttons.
 *
 * @param onSeek Seek the player to this many seconds.
 */
function promptClockComponents(onSeek: (seconds: number) => void): Components {
  /**
   * Render a list item with clock tokens replaced.
   *
   * @param props Streamdown list-item props.
   */
  const ClockLi = ({ children, ...props }: ComponentProps<'li'> & ExtraProps) => (
    <MarkdownLi {...props}>{wrapPromptClockNodes(children, onSeek)}</MarkdownLi>
  )
  /**
   * Render a paragraph with clock tokens replaced.
   *
   * @param props Streamdown paragraph props.
   */
  const ClockP = ({ children, node: _node, ...props }: ComponentProps<'p'> & ExtraProps) => (
    <p {...props}>{wrapPromptClockNodes(children, onSeek)}</p>
  )
  return { li: ClockLi, p: ClockP }
}

/**
 * Map the app color scheme to a Mermaid diagram theme.
 *
 * @param theme Resolved next-themes value.
 */
function mermaidThemeForApp(theme: string | undefined): 'dark' | 'default' {
  return theme === 'dark' ? 'dark' : 'default'
}

/**
 * Streaming markdown renderer (ElevenLabs UI Response). Memoized wrapper
 * around Streamdown that trims first/last child margins and keeps FAQ
 * numbered items on one line.
 *
 * @see https://ui.elevenlabs.io/docs/components/response
 */
export const AgentResponse = memo(function AgentResponse({
  children,
  className,
  components,
  dir = 'auto',
  icons,
  mermaid,
  onSeek,
  plugins,
  theme,
  shikiTheme = ['github-light', 'github-dark'],
  ...props
}: ResponseProps) {
  const content = typeof children === 'string' ? normalizePromptMarkdown(children) : children
  const clockComponents = useMemo(() => (onSeek ? promptClockComponents(onSeek) : null), [onSeek])

  return (
    <Streamdown
      className={cn('w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
      components={{ ...LIST_COMPONENTS, ...clockComponents, ...components }}
      dir={dir}
      icons={{ ...DIAGRAM_ICONS, ...icons }}
      mermaid={mermaid ?? { config: { theme: mermaidThemeForApp(theme) } }}
      plugins={{ ...promptStreamdownPlugins, ...plugins }}
      shikiTheme={shikiTheme}
      {...props}
    >
      {content}
    </Streamdown>
  )
})
