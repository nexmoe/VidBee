import { sanitizeOutput, type Task, type TaskQueueAPI } from '@vidbee/task-queue'

/** Background work has its own deadline, independent of model and tool activity clocks. */
export const AGENT_TASK_WAIT_MS = 24 * 60 * 60 * 1000

const ACTIVE_STATUSES = new Set(['queued', 'running', 'processing', 'retry-scheduled'])

export interface AgentTaskOutcome {
  id: string
  status: Task['status'] | 'removed' | 'timeout'
  kind?: Task['kind']
  parentId?: string | null
  error?: string
}

type TaskQueueReader = Pick<TaskQueueAPI, 'get' | 'subscribe'>

/** Return only the task facts needed to decide whether dependent work can continue. */
function outcome(id: string, task: Readonly<Task> | undefined): AgentTaskOutcome {
  return task
    ? {
        id,
        status: task.status,
        kind: task.kind,
        parentId: task.parentId,
        ...(task.lastError
          ? { error: sanitizeOutput(task.lastError.rawMessage).slice(0, 1000) }
          : {})
      }
    : { id, status: 'removed' }
}

/** Wait on queue events without model polling, cancelling only this subscription on abort. */
export function waitForAgentTask(
  queue: TaskQueueReader,
  id: string,
  signal: AbortSignal,
  onProgress: (detail: string) => void,
  timeoutMs = AGENT_TASK_WAIT_MS
): Promise<AgentTaskOutcome> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let lastProgressAt = Number.NEGATIVE_INFINITY
    /** Remove every owned resource before resolving or rejecting the wait. */
    const cleanup = () => {
      settled = true
      unsubscribe?.()
      if (timer) {
        clearTimeout(timer)
      }
      signal.removeEventListener('abort', abort)
    }
    /** Stopping the Agent leaves admitted downloads under queue ownership. */
    const abort = () => {
      cleanup()
      reject(signal.reason ?? new Error('Task wait cancelled'))
    }
    /** Re-read the authoritative task after subscription and each relevant event. */
    const inspect = () => {
      if (settled) {
        return
      }
      try {
        const task = queue.get(id)
        if (!(task && ACTIVE_STATUSES.has(task.status))) {
          cleanup()
          resolve(outcome(id, task))
          return
        }
        if (Date.now() - lastProgressAt >= 1000) {
          lastProgressAt = Date.now()
          const percent = task.progress.percent
          onProgress(
            `Waiting for ${task.kind} task ${id}: ${task.status}${percent === null ? '' : ` (${Math.round(percent * 100)}%)`}`
          )
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    unsubscribe = queue.subscribe((event) => {
      if (event.taskId === id) {
        inspect()
      }
    })
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      const current = outcome(id, queue.get(id))
      cleanup()
      resolve({ ...current, status: 'timeout' })
    }, timeoutMs)
    if (signal.aborted) {
      abort()
    } else {
      inspect()
    }
  })
}

/** Track only work admitted by this run so unrelated library tasks cannot keep it alive. */
export class AgentTaskContinuation {
  private readonly pending = new Set<string>()

  /** Return real admitted task IDs and remember only active work that still needs a completion result. */
  track(result: Record<string, unknown>, waitForCompletion = true): string[] {
    const tasks = [result.task, ...(Array.isArray(result.tasks) ? result.tasks : [])]
    const ids = new Set<string>()
    for (const value of tasks) {
      if (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        'status' in value &&
        typeof value.id === 'string' &&
        typeof value.status === 'string'
      ) {
        ids.add(value.id)
        if (waitForCompletion && ACTIVE_STATUSES.has(value.status)) {
          this.pending.add(value.id)
        }
      }
    }
    return [...ids]
  }

  /** An explicit wait already delivers this result through the ordinary Pi tool loop. */
  observed(id: string): void {
    this.pending.delete(id)
  }

  /** Consume each admitted task once before a final response, avoiding duplicate wakeups. */
  takePending(): string[] {
    const ids = [...this.pending]
    this.pending.clear()
    return ids
  }
}
