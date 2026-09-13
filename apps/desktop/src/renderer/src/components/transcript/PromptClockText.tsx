import { PROMPT_CLOCK_PATTERN, parsePromptClock } from '@shared/ai-prompt-text'
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'

const SKIP_CLOCK_TAGS = new Set(['button', 'code', 'kbd', 'pre'])

/**
 * Turn clock tokens in a text node into seek buttons.
 *
 * @param text Raw markdown text.
 * @param onSeek Seek the player to this many seconds.
 */
const wrapPromptClockText = (text: string, onSeek: (seconds: number) => void): ReactNode => {
  const matches = Array.from(text.matchAll(new RegExp(PROMPT_CLOCK_PATTERN, 'g')))
  if (matches.length === 0) {
    return text
  }
  const nodes: ReactNode[] = []
  let lastIndex = 0
  for (const match of matches) {
    const clock = match[0]
    const index = match.index ?? 0
    const seconds = parsePromptClock(clock)
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index))
    }
    if (seconds === null) {
      nodes.push(clock)
    } else {
      nodes.push(
        <button
          className="prompt-clock cursor-pointer font-medium text-primary hover:underline"
          data-testid="prompt-clock"
          key={`${index}-${clock}`}
          onClick={() => onSeek(seconds)}
          type="button"
        >
          {clock}
        </button>
      )
    }
    lastIndex = index + clock.length
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

/**
 * Walk markdown children and make `m:ss` / `h:mm:ss` tokens seek the player.
 *
 * @param children Streamdown children.
 * @param onSeek Seek the player to this many seconds.
 */
export const wrapPromptClockNodes = (
  children: ReactNode,
  onSeek: (seconds: number) => void
): ReactNode =>
  Children.map(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      return wrapPromptClockText(String(child), onSeek)
    }
    if (!isValidElement(child)) {
      return child
    }
    const type = typeof child.type === 'string' ? child.type : null
    if (type && SKIP_CLOCK_TAGS.has(type)) {
      return child
    }
    const nested = (child.props as { children?: ReactNode }).children
    if (nested == null) {
      return child
    }
    return cloneElement(
      child as ReactElement<{ children?: ReactNode }>,
      undefined,
      wrapPromptClockNodes(nested, onSeek)
    )
  })
