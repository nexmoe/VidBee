import { createContext, type ReactNode, useContext } from 'react'
import type { AgentUiTaskFacts } from '../lib/agent-ui'

/** Native clients may decorate task facts with platform-specific download controls. */
export interface AgentUiTaskView extends AgentUiTaskFacts {
  content?: ReactNode
}

/** Bind shared cards to the host's authenticated task transport and translations. */
export interface AgentUiRuntime {
  t: (key: string, values?: Record<string, unknown>) => string
  readTasks: (ids: string[]) => Promise<AgentUiTaskView[]>
  subscribeTasks?: (changed: (id?: string) => void) => () => void
}

export const AgentUiRuntimeContext = createContext<AgentUiRuntime | null>(null)

/** Read the host adapter without coupling shared components to Electron or extension APIs. */
export function useAgentUiRuntime(): AgentUiRuntime {
  const runtime = useContext(AgentUiRuntimeContext)
  if (!runtime) {
    throw new Error('Agent UI runtime is unavailable')
  }
  return runtime
}
