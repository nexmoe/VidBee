import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import {
  type AgentCatalogNotice,
  type AgentRunEvent,
  type AgentThread,
  selectedAgentMessages
} from '@shared/agent-chat'
import { idlePromptRunSnapshot } from '@shared/ai-run'
import type { AiPromptRunSnapshot, AiPromptRunStatus } from '@shared/ai-types'
import { useEffect, useRef, useState } from 'react'

/** Latest run status plus timestamp so a new result can show the tab mark again. */
export interface PromptRunStatusView {
  status: AiPromptRunStatus
  updatedAt: number
}

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

/**
 * Load installed skills' latest Agent status and keep transcript tab badges current.
 * @param downloadId Download id.
 * @param promptIds Skill ids shown as transcript tabs.
 */
export const usePromptRunStatuses = (
  downloadId: string,
  promptIds: readonly string[]
): Record<string, PromptRunStatusView> => {
  const promptKey = promptIds.join('\0')
  const [statuses, setStatuses] = useState<Record<string, PromptRunStatusView>>({})
  const revisions = useRef(new Map<string, number>())
  useEffect(() => {
    const ids = promptKey ? promptKey.split('\0') : []
    let cancelled = false
    revisions.current = new Map()
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
    /**
     * Apply one catalog status. Revision wins even when the selected run is older.
     *
     * @param notice Directory notice from main.
     */
    const acceptCatalog = (notice: AgentCatalogNotice): void => {
      if (cancelled || notice.kind !== 'upsert') {
        return
      }
      if (notice.summary.downloadId !== downloadId || !ids.includes(notice.summary.promptId)) {
        return
      }
      const previous = revisions.current.get(notice.summary.promptId) ?? 0
      if (notice.revision <= previous) {
        return
      }
      revisions.current.set(notice.summary.promptId, notice.revision)
      const status = notice.runStatus === 'interrupted' ? 'aborted' : notice.runStatus
      setStatuses((current) => ({
        ...current,
        [notice.summary.promptId]: { status, updatedAt: notice.statusUpdatedAt }
      }))
    }
    /**
     * Drop a thread read that started before a newer catalog notice.
     *
     * @param thread Thread returned by the in-flight read.
     * @param seen Revision already applied for this prompt when the read started.
     */
    const acceptThread = (thread: AgentThread, seen: number): void => {
      if ((revisions.current.get(thread.promptId) ?? 0) > seen) {
        return
      }
      accept(agentTabStatus(thread))
    }
    const off = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const event = args[0] as AgentRunEvent
      if (event?.catalog) {
        acceptCatalog(event.catalog)
        return
      }
      if (event?.snapshot) {
        accept(agentTabStatus(event.snapshot))
      }
    })
    /** Load or repair tab badges. A catalog notice that arrives mid-read wins. */
    const load = (): void => {
      for (const promptId of ids) {
        const seen = revisions.current.get(promptId) ?? 0
        void ipcServices.ai
          .getAgentThread({ downloadId, promptId })
          .then((thread) => acceptThread(thread, seen))
          .catch((error) => logger.error('Failed to load agent tab status', error))
      }
    }
    load()
    window.addEventListener('focus', load)
    window.addEventListener('online', load)
    return () => {
      cancelled = true
      ipcEvents.removeListener('ai:agent-event', off)
      window.removeEventListener('focus', load)
      window.removeEventListener('online', load)
    }
  }, [downloadId, promptKey])
  return statuses
}
