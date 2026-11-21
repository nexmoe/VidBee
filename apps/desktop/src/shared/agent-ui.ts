import type { TaskKind, TaskStatus } from '@vidbee/task-queue'
import type { AgentUiTaskFacts } from '@vidbee/ui/lib/agent-ui'
import type { DownloadItem } from './types'

// biome-ignore lint/performance/noBarrelFile: Keep existing Desktop contracts while sharing the authoritative implementation with the browser.
export * from '@vidbee/ui/lib/agent-ui'

/** Native task projection used by Desktop's existing download cards. */
export interface AgentUiTask extends AgentUiTaskFacts {
  kind: TaskKind
  status: TaskStatus
  download?: Omit<DownloadItem, 'ytDlpCommand' | 'ytDlpLog' | 'error' | 'downloadPath'>
}
