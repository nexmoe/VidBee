import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import type {
  AgentChatInput,
  AgentRunEvent,
  AgentThinkingOptions,
  AgentThread
} from '@shared/agent-chat'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Keep product snapshots ordered across initial reads, live updates and reconnects. */
export function newerAgentThread(current: AgentThread | null, incoming: AgentThread): AgentThread {
  return current?.id === incoming.id && current.seq > incoming.seq ? current : incoming
}

/** Connect one persistent agent thread to IPC while rejecting responses for a previous tab. */
export function useAgentChat(downloadId: string, promptId: string, threadId?: string | null) {
  const { t } = useTranslation()
  const [thread, setThread] = useState<AgentThread | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [sending, setSending] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [thinkingOptions, setThinkingOptions] = useState<AgentThinkingOptions | null>(null)
  const identity = threadId || `${downloadId}:${promptId}`
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const snapshotRef = useRef(thread)
  snapshotRef.current = thread

  useEffect(() => {
    let disposed = false
    setThread(null)
    setError(null)
    setHydrated(false)
    setSending(false)
    setAttaching(false)
    /** Apply only snapshots belonging to the current product identity. */
    const accept = (incoming: AgentThread): void => {
      if (disposed || incoming.downloadId !== downloadId) {
        return
      }
      if (threadId ? incoming.id !== threadId : incoming.promptId !== promptId) {
        return
      }
      setThread((current) => newerAgentThread(current, incoming))
      setHydrated(true)
    }
    const listener = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const event = args[0] as AgentRunEvent
      if (event?.snapshot) {
        accept(event.snapshot)
      }
    })
    /** Refresh using a durable event cursor when the window reconnects or gains focus. */
    const restore = (): void => {
      void ipcServices.ai
        .getAgentThinkingOptions()
        .then((options) => {
          if (!disposed) {
            setThinkingOptions(options)
          }
        })
        .catch(() => {
          if (!disposed) {
            setThinkingOptions(null)
          }
        })
      const current = snapshotRef.current
      const sameThread = Boolean(
        current &&
          (threadId
            ? current.id === threadId
            : current.downloadId === downloadId && current.promptId === promptId)
      )
      const load =
        current && sameThread
          ? ipcServices.ai
              .getAgentEvents({ threadId: current.id, after: current.seq })
              .then((result) => result.snapshot)
          : ipcServices.ai.getAgentThread({
              downloadId,
              promptId,
              ...(threadId ? { threadId } : {})
            })
      void load
        .then((incoming) => {
          if (incoming) {
            accept(incoming)
          }
        })
        .catch((failure) => {
          if (!disposed) {
            setError(failure instanceof Error ? failure.message : String(failure))
            setHydrated(true)
          }
        })
    }
    restore()
    window.addEventListener('focus', restore)
    window.addEventListener('online', restore)
    return () => {
      disposed = true
      ipcEvents.removeListener('ai:agent-event', listener)
      window.removeEventListener('focus', restore)
      window.removeEventListener('online', restore)
    }
  }, [downloadId, promptId, threadId])

  /** Send returns success so the composer only clears text after durable admission. */
  const send = useCallback(
    async (input: Omit<AgentChatInput, 'downloadId' | 'promptId'>): Promise<boolean> => {
      if (sending) {
        return false
      }
      setSending(true)
      setError(null)
      try {
        const incoming = await ipcServices.ai.sendAgentMessage({
          ...input,
          downloadId,
          promptId,
          ...(snapshotRef.current?.id ? { threadId: snapshotRef.current.id } : {})
        })
        if (currentIdentity.current === identity) {
          setThread((current) => newerAgentThread(current, incoming))
        }
        return true
      } catch (failure) {
        if (currentIdentity.current === identity) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
        return false
      } finally {
        if (currentIdentity.current === identity) {
          setSending(false)
        }
      }
    },
    [downloadId, promptId, identity, sending]
  )

  /** Persist image drafts through main-process selection or removal before updating the composer. */
  const updateImages = useCallback(
    async (imageId?: string): Promise<void> => {
      const current = snapshotRef.current
      if (!current || attaching || sending) {
        return
      }
      setAttaching(true)
      setError(null)
      try {
        const incoming = imageId
          ? await ipcServices.ai.removeAgentImage({ threadId: current.id, imageId })
          : await ipcServices.ai.selectAgentImages(current.id)
        if (currentIdentity.current === identity) {
          setThread((previous) => newerAgentThread(previous, incoming))
        }
      } catch {
        if (currentIdentity.current === identity) {
          setError(t(imageId ? 'agentChat.imageRemoveFailed' : 'agentChat.imageSelectionFailed'))
        }
      } finally {
        if (currentIdentity.current === identity) {
          setAttaching(false)
        }
      }
    },
    [attaching, identity, sending, t]
  )

  /** Cancel this thread without touching any other conversation. */
  const stop = useCallback(async (): Promise<void> => {
    if (!thread) {
      return
    }
    try {
      const incoming = await ipcServices.ai.stopAgentRun(thread.id)
      if (incoming && currentIdentity.current === identity) {
        setThread((current) => newerAgentThread(current, incoming))
      }
    } catch (failure) {
      if (currentIdentity.current === identity) {
        setError(String(failure))
      }
    }
  }, [identity, thread])

  /** Switch reply versions and restore their descendant history. */
  /** Reload model thinking capabilities after the Composer provider changes. */
  const reloadThinkingOptions = useCallback(async (): Promise<void> => {
    try {
      setThinkingOptions(await ipcServices.ai.getAgentThinkingOptions())
    } catch {
      setThinkingOptions(null)
    }
  }, [])

  const selectBranch = useCallback(
    async (messageId: string): Promise<void> => {
      if (!thread) {
        return
      }
      try {
        const incoming = await ipcServices.ai.selectAgentBranch({ threadId: thread.id, messageId })
        if (currentIdentity.current === identity) {
          setThread((current) => newerAgentThread(current, incoming))
        }
      } catch (failure) {
        if (currentIdentity.current === identity) {
          setError(String(failure))
        }
      }
    },
    [identity, thread]
  )
  return {
    thread:
      thread?.downloadId === downloadId &&
      (threadId ? thread.id === threadId : thread.promptId === promptId)
        ? thread
        : null,
    hydrated,
    error,
    sending,
    attaching,
    thinkingOptions,
    reloadThinkingOptions,
    send,
    selectImages: () => updateImages(),
    removeImage: updateImages,
    stop,
    selectBranch
  }
}
