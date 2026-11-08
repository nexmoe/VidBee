import { type RefObject, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useMessageSendTransition } from './ui/message-send-transition'

interface SendMessage {
  id: string
  parentId: string | null
  role: string
  text: string
  imageIds?: string[]
}

interface OutgoingMessage<T> {
  identity: string
  message: T
  previousIds: Set<string>
  admitted: boolean
  finished: boolean
}

/** Share immediate previews, durable admission and animation continuity across native and browser chat. */
export function useAgentMessageSend<T extends SendMessage>({
  identity,
  messages,
  inputRef,
  viewportRef
}: {
  identity: string
  messages: T[]
  inputRef: RefObject<HTMLDivElement | null>
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const [outgoing, setOutgoing] = useState<OutgoingMessage<T> | null>(null)
  const sending = useRef(false)
  const prepare = useMessageSendTransition({ identity, inputRef, viewportRef })
  const preview = outgoing?.identity === identity ? outgoing : null
  const admittedMessage = preview
    ? messages.find(
        (message) =>
          message.role === 'user' &&
          !preview.previousIds.has(message.id) &&
          message.parentId === preview.message.parentId &&
          message.text === preview.message.text &&
          (message.imageIds ?? []).join('\n') === (preview.message.imageIds ?? []).join('\n')
      )
    : undefined

  /** Keep the visual message until both the transition and durable send have settled; restore failed drafts. */
  async function submit(
    message: T,
    send: () => Promise<boolean>,
    clearDraft: () => void,
    restoreDraft: () => void
  ): Promise<boolean> {
    if (sending.current) {
      return false
    }
    sending.current = true
    const animateMessage = prepare(() => {
      setOutgoing((current) =>
        current?.message.id === message.id
          ? current.admitted
            ? null
            : { ...current, finished: true }
          : current
      )
    })
    flushSync(() => {
      setOutgoing({
        identity,
        message,
        previousIds: new Set(messages.map((item) => item.id)),
        admitted: false,
        finished: false
      })
      clearDraft()
      animateMessage()
    })
    let admitted = false
    try {
      admitted = await send()
      return admitted
    } finally {
      sending.current = false
      setOutgoing((current) =>
        current?.message.id === message.id
          ? admitted && !current.finished
            ? { ...current, admitted: true }
            : null
          : current
      )
      if (!admitted) {
        restoreDraft()
      }
    }
  }

  return { preview, admittedMessage, submit }
}
