import { z } from 'zod'
import { AGENT_WORKSPACE_ID, type AgentThread } from '../../shared/agent-chat'
import type { AgentUiTaskFacts } from '../../shared/agent-ui'
import type { ExtensionChatVideos } from '../../shared/extension-chat'
import { getAgentChatStore } from './agent-chat-store'
import { readAgentUiTasks } from './agent-ui-tasks'
import { projectTaskForRenderer } from './projection'
import { peekDesktopTaskQueueRef } from './queue-ref'

/** Derive task ownership from persisted run and card references for reads and event notifications. */
export function extensionChatTaskIds(thread: AgentThread): Set<string> {
  return new Set(
    thread.runs
      .flatMap((run) => [
        ...(run.taskIds ?? []),
        ...run.tools.flatMap((tool) => [
          ...(tool.taskId ? [tool.taskId] : []),
          ...Object.values(tool.ui?.elements ?? {}).flatMap((element) =>
            element.type === 'TaskCard'
              ? [element.props.taskId]
              : element.type === 'TaskPicker' && Array.isArray(element.props.taskIds)
                ? element.props.taskIds
                : []
          )
        ])
      ])
      .filter((id): id is string => typeof id === 'string')
  )
}

/** Read only tasks referenced by the saved conversation; never return native paths or commands. */
export function readExtensionChatTasks(raw: unknown): AgentUiTaskFacts[] {
  const input = z
    .strictObject({
      threadId: z.uuid(),
      ids: z.array(z.string().min(1).max(200)).max(24)
    })
    .parse(raw)
  const thread = getAgentChatStore().get(input.threadId, { sessionEntries: false })
  if (!thread || thread.downloadId === AGENT_WORKSPACE_ID) {
    throw new Error('Conversation is unavailable')
  }
  const allowed = extensionChatTaskIds(thread)
  if (input.ids.some((id) => !allowed.has(id))) {
    throw new Error('Task is not referenced by this conversation')
  }
  return readAgentUiTasks(input.ids).map(
    ({ id, kind, title, status, progress, error, selectable }) => ({
      id,
      kind,
      title,
      status,
      progress,
      error,
      selectable
    })
  )
}

/** Page through the same video projections as Desktop's library without exposing local files. */
export function readExtensionChatVideos(raw: unknown): ExtensionChatVideos {
  const { cursor } = z
    .strictObject({ cursor: z.string().max(2048).nullable().optional() })
    .parse(raw)
  const page = peekDesktopTaskQueueRef()?.list({ limit: 500, cursor })
  return {
    videos: (page?.tasks ?? []).flatMap((task) => {
      const item = projectTaskForRenderer(task)
      return item.type === 'video' ? [{ id: item.id, title: item.title || item.url }] : []
    }),
    nextCursor: page?.nextCursor ?? null
  }
}
