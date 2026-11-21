import { useMessageScroller } from '@renderer/components/ui/message-scroller'
import { searchTargetAtom } from '@renderer/store/search-target'
import { AgentChatScrollState as SharedAgentChatScrollState } from '@vidbee/ui/components/agent-chat-scroll-state'
import { useAtom } from 'jotai'
import { type ComponentProps, useEffect } from 'react'

/** Consume an explicit result jump after the shared branch reading position has been restored. */
function SearchMessageJump({ threadId }: { threadId: string }) {
  const [target, setTarget] = useAtom(searchTargetAtom)
  const { scrollToMessage } = useMessageScroller()
  useEffect(() => {
    if (target?.kind !== 'chat' || target.threadId !== threadId) {
      return
    }
    const frame = requestAnimationFrame(() => {
      if (scrollToMessage(target.messageId, { align: 'center', behavior: 'instant' })) {
        setTarget(null)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollToMessage, setTarget, target, threadId])
  return null
}

/** Preserve normal chat bookmarks and support jumps from the global search palette. */
function AgentChatScrollState(props: ComponentProps<typeof SharedAgentChatScrollState>) {
  return (
    <>
      <SharedAgentChatScrollState {...props} />
      <SearchMessageJump
        key={`${props.threadId}:${props.leafId ?? ''}`}
        threadId={props.threadId}
      />
    </>
  )
}

export { AgentChatScrollState }
