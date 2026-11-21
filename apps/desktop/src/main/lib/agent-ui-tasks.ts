import { isMediaTaskKind } from '@vidbee/task-queue'
import { z } from 'zod'
import type { AgentUiTask } from '../../shared/agent-ui'
import { projectTaskForRenderer } from './projection'
import { peekDesktopTaskQueueRef } from './queue-ref'
import { resolveTaskSourceFile } from './source-file'

/** Read a bounded group of public task facts for mounted chat cards without exposing paths or logs. */
export function readAgentUiTasks(raw: unknown): AgentUiTask[] {
  const ids = z.array(z.string().min(1).max(200)).max(24).parse(raw)
  const queue = peekDesktopTaskQueueRef()
  return [...new Set(ids)].flatMap((id) => {
    const task = queue?.get(id)
    if (!task) {
      return []
    }
    let selectable = false
    if (task.status === 'completed' && isMediaTaskKind(task.kind)) {
      try {
        selectable = Boolean(resolveTaskSourceFile(task))
      } catch {
        // A file may disappear between the existence and size checks.
      }
    }
    const { ytDlpCommand: _command, error: _error, ...download } = projectTaskForRenderer(task)
    return [
      {
        id: task.id,
        kind: task.kind,
        title: download.title || task.id,
        status: task.status,
        progress:
          task.status === 'completed'
            ? 100
            : task.progress.percent === null
              ? null
              : (download.progress?.percent ?? null),
        error: task.lastError?.uiMessageKey,
        selectable,
        download: isMediaTaskKind(task.kind) ? download : undefined
      }
    ]
  })
}
