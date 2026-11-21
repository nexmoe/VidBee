import { type ReactNode, useEffect } from 'react'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller
} from './ui/message-scroller'
import { ThinkingStepsContent } from './ui/thinking-steps'

/** Reopening reasoning resumes following its latest content. */
function FollowThinkingOnOpen({ open }: { open: boolean }) {
  const { scrollToEnd } = useMessageScroller()
  useEffect(() => {
    if (open) {
      scrollToEnd({ behavior: 'instant' })
    }
  }, [open, scrollToEnd])
  return null
}

/** Reuse chat following behavior inside a bounded, fully readable thinking panel. */
export function AgentThinkingContent({
  open,
  children,
  label
}: {
  open: boolean
  children: ReactNode
  label: string
}) {
  return (
    <ThinkingStepsContent>
      <MessageScrollerProvider
        autoScroll={open}
        defaultScrollPosition="end"
        scrollEdgeThreshold={32}
      >
        <MessageScroller className="h-auto">
          <MessageScrollerViewport aria-label={label} className="max-h-80">
            <MessageScrollerContent
              aria-live="off"
              className="min-h-0 gap-0 [&>*]:shrink-0"
              role="presentation"
            >
              {children}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
        <FollowThinkingOnOpen open={open} />
      </MessageScrollerProvider>
    </ThinkingStepsContent>
  )
}
