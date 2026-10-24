import type { AgentRunEvent } from '@shared/agent-chat'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { ipcEvents, ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import {
  agentTaskAiSnapshotAtom,
  agentTaskMapAtom,
  applyAgentCatalogActivity,
  mergeAgentHistoryActivity
} from '../store/agent-tasks'

/**
 * Keep the app-wide map of Agent results current for the download list.
 * Live catalog events drive it; the directory list repairs missed events.
 */
export function useAgentTaskEvents(): void {
  const setTasks = useSetAtom(agentTaskMapAtom)
  const setAiSnapshot = useSetAtom(agentTaskAiSnapshotAtom)

  useEffect(() => {
    let cancelled = false
    // Thread ids changed by events while a directory read is in flight.
    let touched: Set<string> | null = null

    /** Load every conversation's latest result; events that arrive mid-read win. */
    const hydrate = async (): Promise<void> => {
      const pending = new Set<string>()
      touched = pending
      try {
        const rows = await ipcServices.ai.listAgentHistory()
        if (!cancelled) {
          setTasks((current) => mergeAgentHistoryActivity(current, rows, pending))
        }
      } catch (error) {
        logger.error('Failed to load Agent results', error)
      } finally {
        if (touched === pending) {
          touched = null
        }
      }
    }

    /** Load prompt titles and providers for labels and model icons. */
    const loadAiSnapshot = async (): Promise<void> => {
      try {
        const snapshot = await ipcServices.ai.getSnapshot()
        if (!cancelled) {
          setAiSnapshot(snapshot)
        }
      } catch (error) {
        logger.error('Failed to load Agent result labels', error)
      }
    }

    const offAgent = ipcEvents.on('ai:agent-event', (...args: unknown[]) => {
      const notice = (args[0] as AgentRunEvent | undefined)?.catalog
      if (!notice) {
        return
      }
      touched?.add(notice.kind === 'remove' ? notice.id : notice.summary.id)
      setTasks((current) => applyAgentCatalogActivity(current, notice))
    })
    const offSettings = ipcEvents.on('ai:settings-changed', () => {
      void loadAiSnapshot()
    })
    const repair = (): void => {
      void hydrate()
    }

    void hydrate()
    void loadAiSnapshot()
    window.addEventListener('focus', repair)
    window.addEventListener('online', repair)
    return () => {
      cancelled = true
      ipcEvents.removeListener('ai:agent-event', offAgent)
      ipcEvents.removeListener('ai:settings-changed', offSettings)
      window.removeEventListener('focus', repair)
      window.removeEventListener('online', repair)
    }
  }, [setAiSnapshot, setTasks])
}
