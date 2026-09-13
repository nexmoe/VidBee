import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { type AgentRunEvent, type AgentThread, selectedAgentMessages } from '@shared/agent-chat'
import { idlePromptRunSnapshot } from '@shared/ai-run'
import type { AiPromptRunSnapshot, AiPromptRunStatus } from '@shared/ai-types'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Ignore delayed IPC replies when a newer snapshot for the same prompt has already arrived. */
const latestPromptSnapshot = (
  current: AiPromptRunSnapshot,
  incoming: AiPromptRunSnapshot
): AiPromptRunSnapshot =>
  current.status !== 'idle' &&
  current.downloadId === incoming.downloadId &&
  current.promptId === incoming.promptId &&
  current.updatedAt > incoming.updatedAt
    ? current
    : incoming

export interface PromptRunCacheContext {
  sourceUrl?: string | null
  transcriptLanguage?: string | null
  transcriptOrigin?: 'ai' | 'human'
}

/**
 * Keep only public HTTP(S) media URLs for the shared Cloud cache.
 *
 * @param value Download URL from the transcript page.
 */
function publicSourceUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  if (trimmed?.startsWith('https://') || trimmed?.startsWith('http://')) {
    return trimmed
  }
  return undefined
}

/**
 * Subscribe to a main-process prompt run so navigating away does not abort it.
 *
 * @param downloadId Download or settings-test id.
 * @param promptId Prompt id, or null when no prompt is selected.
 * @param cache Optional video URL and subtitle language for Cloud cache hits.
 */
export const usePromptRun = (
  downloadId: string,
  promptId: string | null,
  cache?: PromptRunCacheContext
): {
  hydrated: boolean
  run: AiPromptRunSnapshot
  start: (transcriptText: string, forceRegenerate?: boolean) => Promise<void>
  stop: () => Promise<void>
} => {
  const { i18n } = useTranslation()
  const [run, setRun] = useState<AiPromptRunSnapshot>(() =>
    idlePromptRunSnapshot(downloadId, promptId ?? '')
  )
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!promptId) {
      setRun(idlePromptRunSnapshot(downloadId, ''))
      setHydrated(true)
      return
    }
    let cancelled = false
    setHydrated(false)
    void ipcServices.ai
      .getPromptRun({ downloadId, promptId })
      .then((snapshot) => {
        if (!cancelled) {
          setRun((current) => latestPromptSnapshot(current, snapshot))
          setHydrated(true)
        }
      })
      .catch((error) => {
        logger.error('Failed to load prompt run', error)
        if (!cancelled) {
          setHydrated(true)
        }
      })
    const off = ipcEvents.on('ai:prompt-run', (...args: unknown[]) => {
      const snapshot = args[0] as AiPromptRunSnapshot
      if (snapshot?.downloadId === downloadId && snapshot.promptId === promptId) {
        setRun((current) => latestPromptSnapshot(current, snapshot))
      }
    })
    return () => {
      cancelled = true
      ipcEvents.removeListener('ai:prompt-run', off as (...args: unknown[]) => void)
    }
  }, [downloadId, promptId])

  /**
   * Start or restart the prompt against the enabled provider.
   *
   * @param transcriptText Transcript or sample text.
   */
  const start = useCallback(
    async (transcriptText: string, forceRegenerate = false): Promise<void> => {
      if (!promptId) {
        return
      }
      try {
        const snapshot = await ipcServices.ai.startPrompt({
          downloadId,
          promptId,
          forceRegenerate,
          sourceUrl: publicSourceUrl(cache?.sourceUrl),
          transcriptLanguage: cache?.transcriptLanguage?.trim() || undefined,
          transcriptOrigin: cache?.transcriptOrigin,
          transcriptText,
          uiLanguage: i18n.language
        })
        setRun((current) => latestPromptSnapshot(current, snapshot))
      } catch (error) {
        logger.error('Failed to start prompt run', error)
        setRun((current) => ({
          ...(current.downloadId === downloadId && current.promptId === promptId
            ? current
            : idlePromptRunSnapshot(downloadId, promptId)),
          downloadId,
          promptId,
          status: 'error',
          error: error instanceof Error ? error.message : 'Prompt failed',
          errorCode: 'unknown',
          updatedAt: Date.now()
        }))
      }
    },
    [
      cache?.sourceUrl,
      cache?.transcriptLanguage,
      cache?.transcriptOrigin,
      downloadId,
      i18n.language,
      promptId
    ]
  )

  /**
   * Abort the in-flight stream without leaving the page.
   */
  const stop = useCallback(async (): Promise<void> => {
    if (!promptId) {
      return
    }
    try {
      setRun(await ipcServices.ai.stopPrompt({ downloadId, promptId }))
    } catch (error) {
      logger.error('Failed to stop prompt run', error)
    }
  }, [downloadId, promptId])

  return { hydrated, run, start, stop }
}

/** Latest run status plus timestamp so a new result can show the tab mark again. */
export interface PromptRunStatusView {
  status: AiPromptRunStatus
  updatedAt: number
}

/**
 * Load every enabled prompt's latest status and keep it current while runs stream.
 *
 * @param downloadId Download or settings-test id.
 * @param promptIds Enabled prompt ids shown as tabs.
 */
/** Project the selected reply lifecycle onto the existing tab badge contract. */
function agentTabStatus(thread: AgentThread): AiPromptRunSnapshot {
  const latest = selectedAgentMessages(thread).at(-1)
  const run = thread.runs.find((item) => item.messageId === latest?.id)
  return {
    ...idlePromptRunSnapshot(thread.downloadId, thread.promptId),
    status: run?.status === 'interrupted' ? 'aborted' : (run?.status ?? 'idle'),
    updatedAt: run?.updatedAt ?? 0
  }
}

export const usePromptRunStatuses = (
  downloadId: string,
  promptIds: readonly string[]
): Record<string, PromptRunStatusView> => {
  const promptKey = promptIds.join('\0')
  const [statuses, setStatuses] = useState<Record<string, PromptRunStatusView>>({})
  useEffect(() => {
    const ids = promptKey ? promptKey.split('\0') : []
    let cancelled = false
    setStatuses({})
    /** Ignore stale hydration snapshots arriving after a newer live event. */
    const accept = (snapshot: AiPromptRunSnapshot): void => {
      if (cancelled || snapshot.downloadId !== downloadId || !ids.includes(snapshot.promptId)) {
        return
      }
      setStatuses((current) => {
        const previous = current[snapshot.promptId]
        if (previous && previous.updatedAt > snapshot.updatedAt) {
          return current
        }
        return {
          ...current,
          [snapshot.promptId]: { status: snapshot.status, updatedAt: snapshot.updatedAt }
        }
      })
    }
    const off = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const event = args[0] as AgentRunEvent
      if (event?.snapshot) {
        accept(agentTabStatus(event.snapshot))
      }
    })
    for (const promptId of ids) {
      void ipcServices.ai
        .getAgentThread({ downloadId, promptId })
        .then((thread) => accept(agentTabStatus(thread)))
        .catch((error) => logger.error('Failed to load agent tab status', error))
    }
    return () => {
      cancelled = true
      ipcEvents.removeListener('ai:agent-event', off)
    }
  }, [downloadId, promptKey])
  return statuses
}
