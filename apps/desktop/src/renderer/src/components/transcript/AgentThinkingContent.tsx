import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller
} from '@renderer/components/ui/message-scroller'
import { ThinkingStepsContent } from '@vidbee/ui/components/ui/thinking-steps'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

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
export function AgentThinkingContent({ open, children }: { open: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <ThinkingStepsContent>
      <MessageScrollerProvider
        autoScroll={open}
        defaultScrollPosition="end"
        scrollEdgeThreshold={32}
      >
        <MessageScroller className="h-auto">
          <MessageScrollerViewport aria-label={t('transcript.promptThinking')} className="max-h-80">
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
