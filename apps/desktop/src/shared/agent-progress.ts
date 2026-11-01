import type { AgentChatRun } from './agent-chat'
import { agentUiNeedsResponse } from './agent-ui'

export type AgentProgressState =
  | 'running'
  | 'waiting'
  | 'approval'
  | 'input'
  | 'completed'
  | 'aborted'
  | 'interrupted'
  | 'error'

/** Derive execution state from the owning run, keeping stopped runs separate from their queue tasks. */
export function agentProgressState(run: AgentChatRun, current: boolean): AgentProgressState {
  if (run.status !== 'running') {
    if (
      run.status === 'completed' &&
      current &&
      run.tools.some(
        (tool) => tool.status === 'completed' && tool.ui && agentUiNeedsResponse(tool.ui)
      )
    ) {
      return 'input'
    }
    return run.status
  }
  if (run.tools.some((tool) => tool.status === 'pending-approval')) {
    return 'approval'
  }
  if (run.tools.some((tool) => tool.status === 'running' && tool.name === 'wait_for_task')) {
    return 'waiting'
  }
  return 'running'
}

/** Bound each live task read while keeping the currently awaited task visible in large batches. */
export function agentProgressTaskIds(run?: AgentChatRun): string[] {
  if (!run) {
    return []
  }
  const ids = new Set([
    ...(run.taskIds ?? []),
    ...run.tools.flatMap((tool) => (tool.taskId ? [tool.taskId] : []))
  ])
  const waiting = run.tools.findLast(
    (tool) => tool.name === 'wait_for_task' && tool.status === 'running'
  )
  if (waiting?.taskId) {
    ids.delete(waiting.taskId)
    return [waiting.taskId, ...[...ids].slice(-23)]
  }
  return [...ids].slice(-24)
}
