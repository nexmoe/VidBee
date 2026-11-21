import { DownloadItem } from '@renderer/components/download/DownloadItem'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import {
  type AgentUiActions,
  AgentUiProvider as SharedAgentUiProvider
} from '@vidbee/ui/components/agent-ui-cards'
import type { AgentUiRuntime, AgentUiTaskView } from '@vidbee/ui/components/agent-ui-runtime'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Subscribe to the same queue facts used by Desktop's library and task cards. */
function subscribeTasks(changed: (id?: string) => void): () => void {
  /** Read only the event's task identity, never renderer-authored task facts. */
  function update(raw: unknown): void {
    const id = typeof raw === 'string' ? raw : (raw as { id?: string } | null)?.id
    if (id) {
      changed(id)
    }
  }
  const subscriptions = [
    'download:queued',
    'download:updated',
    'download:started',
    'download:progress',
    'download:completed',
    'download:error',
    'download:cancelled',
    'download:removed'
  ].map((channel) => [channel, ipcEvents.on(channel, update)] as const)
  return () => {
    for (const [channel, listener] of subscriptions) {
      ipcEvents.removeListener(channel, listener)
    }
  }
}

/** Connect shared cards to native task reads, download controls and translated labels. */
export function AgentUiProvider(props: AgentUiActions & { children: ReactNode }) {
  const { t } = useTranslation()
  const runtime = useMemo<AgentUiRuntime>(
    () => ({
      t: (key, values) => t(key, values),
      subscribeTasks,
      /** Preserve native download actions while sharing all card state and layout. */
      async readTasks(ids): Promise<AgentUiTaskView[]> {
        const tasks = await ipcServices.ai.getAgentUiTasks(ids)
        return tasks.map((task) => ({
          ...task,
          content:
            task.download && task.progress !== null ? (
              <DownloadItem
                compact
                download={{
                  ...task.download,
                  entryType: ['completed', 'failed', 'cancelled'].includes(task.status)
                    ? 'history'
                    : 'active',
                  error: task.error
                    ? t(task.error, { defaultValue: t('agentChat.ui.taskFailed') })
                    : undefined
                }}
              />
            ) : undefined
        }))
      }
    }),
    [t]
  )
  return <SharedAgentUiProvider {...props} runtime={runtime} />
}
