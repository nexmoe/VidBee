import { useMessageScroller } from '@renderer/components/ui/message-scroller'
import { type RefObject, useEffect } from 'react'

interface ScrollBookmark {
  messageId: string | null
  offset: number
  top: number
  atEnd: boolean
}
const bookmarks = new Map<string, ScrollBookmark>()

/** Restore the reading position of each selected branch and pause following during text selection. */
export function AgentChatScrollState({
  threadId,
  leafId,
  viewport,
  onSelecting
}: {
  threadId: string
  leafId: string | null
  viewport: RefObject<HTMLDivElement | null>
  onSelecting: (selecting: boolean) => void
}) {
  const { scrollToEnd, scrollToMessage } = useMessageScroller()
  const key = `${threadId}:${leafId ?? ''}`
  useEffect(() => {
    const bookmark = bookmarks.get(key)
    const frame = requestAnimationFrame(() => {
      const element = viewport.current
      if (!(bookmark && element)) {
        return
      }
      if (bookmark.atEnd) {
        scrollToEnd({ behavior: 'auto' })
        return
      }
      const content = element.querySelector<HTMLElement>('[data-slot="message-scroller-content"]')
      const padding = content ? Number.parseFloat(getComputedStyle(content).paddingTop) || 0 : 0
      if (
        bookmark.messageId &&
        scrollToMessage(bookmark.messageId, {
          align: 'start',
          behavior: 'instant',
          scrollMargin: bookmark.offset - padding
        })
      ) {
        return
      }
      element.scrollTop = bookmark.top
    })
    /** Record a visible row and its offset so loaded media does not replace the reader's anchor. */
    const remember = (event: Event): void => {
      const element = viewport.current
      if (
        !element ||
        event.target !== element ||
        !element.isConnected ||
        element.clientHeight === 0
      ) {
        return
      }
      const top = element.getBoundingClientRect().top
      const row = [
        ...element.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]')
      ].find((item) => item.getBoundingClientRect().bottom > top)
      bookmarks.set(key, {
        messageId: row?.dataset.messageId ?? null,
        offset: row ? row.getBoundingClientRect().top - top : 0,
        top: element.scrollTop,
        atEnd: element.scrollHeight - element.scrollTop - element.clientHeight <= 32
      })
      if (bookmarks.size > 200) {
        const oldest = bookmarks.keys().next().value
        if (oldest) {
          bookmarks.delete(oldest)
        }
      }
    }
    document.addEventListener('scroll', remember, { capture: true, passive: true })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('scroll', remember, true)
    }
  }, [key, scrollToEnd, scrollToMessage, viewport])

  useEffect(() => {
    /** Selection belongs to this chat only; selecting captions elsewhere does not pause it. */
    const changed = (): void => {
      const selection = window.getSelection()
      onSelecting(
        Boolean(
          selection && !selection.isCollapsed && viewport.current?.contains(selection.anchorNode)
        )
      )
    }
    document.addEventListener('selectionchange', changed)
    return () => {
      document.removeEventListener('selectionchange', changed)
      onSelecting(false)
    }
  }, [onSelecting, viewport])
  return null
}
