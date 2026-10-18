import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import type {
  AgentChatInput,
  AgentRunEvent,
  AgentThinkingOptions,
  AgentThread
} from '@shared/agent-chat'
import {
  type AgentGapRecovery,
  acceptAgentThread,
  agentEventMatches,
  applyAgentRunEvent,
  createAgentGapRecovery,
  observeAgentSeq,
  requestAgentRecovery,
  resetAgentRecovery,
  settleAgentRecovery
} from '@shared/agent-thread-patch'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Keep an older seq from replacing the thread already accepted for this identity.
 *
 * @param current Authoritative thread, or null before the first accept.
 * @param incoming Snapshot or applied patch.
 */
export function newerAgentThread(current: AgentThread | null, incoming: AgentThread): AgentThread {
  return acceptAgentThread(current, incoming)
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
  const snapshotRef = useRef<AgentThread | null>(null)
  const acceptRef = useRef<(incoming: AgentThread) => void>(() => {})

  useEffect(() => {
    let disposed = false
    snapshotRef.current = null
    let recovery: AgentGapRecovery = createAgentGapRecovery()
    let knownThreadId = threadId || undefined
    setThread(null)
    setError(null)
    setHydrated(false)
    setSending(false)
    setAttaching(false)
    const route = { downloadId, promptId, threadId }
    /**
     * True when a thread belongs to this effect's video and prompt or pinned thread.
     *
     * @param incoming Thread from IPC.
     */
    const belongs = (incoming: AgentThread): boolean => {
      if (incoming.downloadId !== downloadId) {
        return false
      }
      if (threadId) {
        return incoming.id === threadId
      }
      return incoming.promptId === promptId
    }
    /**
     * Accept one thread for this identity. The ref is updated before React state.
     *
     * @param incoming Snapshot or patch result.
     */
    const accept = (incoming: AgentThread): void => {
      if (disposed || !belongs(incoming)) {
        return
      }
      recovery = observeAgentSeq(recovery, incoming.seq)
      const next = acceptAgentThread(snapshotRef.current, incoming)
      if (next === snapshotRef.current) {
        return
      }
      snapshotRef.current = next
      knownThreadId = next.id
      setThread(next)
      setHydrated(true)
    }
    acceptRef.current = accept
    /**
     * Load the thread or the commits after the authoritative seq.
     * A short reply may start the one allowed follow-up. Disposed effects drop the result.
     */
    const runRecovery = (): void => {
      const local = snapshotRef.current
      const same = Boolean(local && belongs(local))
      const pending =
        same && local
          ? ipcServices.ai
              .getAgentEvents({ threadId: local.id, after: local.seq })
              .then((result) => result.snapshot)
          : ipcServices.ai.getAgentThread({
              downloadId,
              promptId,
              ...(threadId ? { threadId } : knownThreadId ? { threadId: knownThreadId } : {})
            })
      void pending
        .then((incoming) => {
          if (disposed) {
            return
          }
          if (incoming) {
            accept(incoming)
          } else {
            setHydrated(true)
          }
          const applied =
            snapshotRef.current && belongs(snapshotRef.current) ? snapshotRef.current.seq : 0
          const settled = settleAgentRecovery(recovery, applied)
          recovery = settled.recovery
          if (settled.action === 'follow-up') {
            runRecovery()
          }
        })
        .catch((failure: unknown) => {
          if (disposed) {
            return
          }
          recovery = {
            ...recovery,
            inflight: false,
            followUpUsed: false,
            coveredSeq: recovery.observedSeq
          }
          setError(failure instanceof Error ? failure.message : String(failure))
          setHydrated(true)
        })
    }
    /**
     * Start one recovery when none is in flight.
     * A gap waits for a seq newer than the episode that already fell behind.
     *
     * @param reason Gap events coalesce; focus and first load always read.
     */
    const ensureRecovery = (reason: 'gap' | 'refresh'): void => {
      const requested = requestAgentRecovery(recovery, reason)
      recovery = requested.recovery
      if (requested.action === 'start') {
        runRecovery()
      }
    }
    const listener = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const agentEvent = args[0] as AgentRunEvent
      if (disposed || !agentEvent || !agentEventMatches(agentEvent, route)) {
        return
      }
      recovery = observeAgentSeq(recovery, agentEvent.seq)
      const result = applyAgentRunEvent(snapshotRef.current, agentEvent, route)
      if (result.kind === 'applied') {
        accept(result.thread)
        return
      }
      if (result.kind === 'gap') {
        if (agentEvent.patch?.threadId) {
          knownThreadId = agentEvent.patch.threadId
        }
        ensureRecovery('gap')
      }
    })
    /**
     * Refresh thinking options and repair a seq gap after focus or reconnect.
     */
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
      recovery = resetAgentRecovery(recovery)
      ensureRecovery('refresh')
    }
    restore()
    window.addEventListener('focus', restore)
    window.addEventListener('online', restore)
    return () => {
      disposed = true
      acceptRef.current = () => {}
      ipcEvents.removeListener('ai:agent-event', listener)
      window.removeEventListener('focus', restore)
      window.removeEventListener('online', restore)
    }
  }, [downloadId, promptId, threadId])

  /** Resolve a pending management-tool approval from the activity rail. */
  const decideTool = useCallback(
    async (input: { toolCallId: string; approved: boolean; remember: boolean }): Promise<void> => {
      const current = snapshotRef.current
      if (!current) {
        return
      }
      await ipcServices.ai.decideAgentTool({
        threadId: current.id,
        toolCallId: input.toolCallId,
        approved: input.approved,
        remember: input.remember
      })
    },
    []
  )

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
          acceptRef.current(incoming)
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
          acceptRef.current(incoming)
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
    const current = snapshotRef.current
    if (!current) {
      return
    }
    try {
      const incoming = await ipcServices.ai.stopAgentRun(current.id)
      if (incoming && currentIdentity.current === identity) {
        acceptRef.current(incoming)
      }
    } catch (failure) {
      if (currentIdentity.current === identity) {
        setError(String(failure))
      }
    }
  }, [identity])

  /** Reload model thinking capabilities after the Composer provider changes. */
  const reloadThinkingOptions = useCallback(async (): Promise<void> => {
    try {
      setThinkingOptions(await ipcServices.ai.getAgentThinkingOptions())
    } catch {
      setThinkingOptions(null)
    }
  }, [])

  /** Switch reply versions and restore their descendant history. */
  const selectBranch = useCallback(
    async (messageId: string): Promise<void> => {
      const current = snapshotRef.current
      if (!current) {
        return
      }
      try {
        const incoming = await ipcServices.ai.selectAgentBranch({ threadId: current.id, messageId })
        if (currentIdentity.current === identity) {
          acceptRef.current(incoming)
        }
      } catch (failure) {
        if (currentIdentity.current === identity) {
          setError(String(failure))
        }
      }
    },
    [identity]
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
    decideTool,
    selectImages: () => updateImages(),
    removeImage: updateImages,
    stop,
    selectBranch
  }
}
