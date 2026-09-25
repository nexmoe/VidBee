import { randomUUID } from 'node:crypto'
import { type Task, type TaskCreationMetadata, TERMINAL_STATUSES } from '@vidbee/task-queue'
import { type AsrTierId, isAsrTierId } from '@vidbee/transcription/asr'
import { getDesktopTaskQueueRef } from './queue-ref'

/** List every model task for a tier so queued work cannot escape deduplication or cancellation. */
export function listAsrModelTasks(tier?: AsrTierId): Readonly<Task>[] {
  const queue = getDesktopTaskQueueRef()
  const tasks: Readonly<Task>[] = []
  let cursor: string | null = null
  do {
    const page = queue.list({ kind: 'model-download', limit: 500, cursor })
    tasks.push(...page.tasks.filter((task) => !tier || task.input.options?.asrTier === tier))
    cursor = page.nextCursor
  } while (cursor)
  return tasks
}

interface Admission {
  created: boolean
  task: Readonly<Task>
}
const admissions = new Map<AsrTierId, Promise<Admission>>()

/** Serialize same-tier admission while persistence is pending. */
export async function enqueueAsrModelDownload(
  tier: string,
  creation: TaskCreationMetadata = { origin: 'manual' }
): Promise<Admission> {
  if (!isAsrTierId(tier)) {
    throw new Error('Unknown ASR tier')
  }
  const pending = admissions.get(tier)
  if (pending) {
    return { ...(await pending), created: false }
  }
  const next = admitAsrModelDownload(tier, creation)
  admissions.set(tier, next)
  try {
    return await next
  } finally {
    admissions.delete(tier)
  }
}

/** Admit one persistent ASR package download without changing the selected model. */
async function admitAsrModelDownload(
  tier: AsrTierId,
  creation: TaskCreationMetadata
): Promise<Admission> {
  const existing = listAsrModelTasks(tier).find((task) => !TERMINAL_STATUSES.has(task.status))
  if (existing) {
    return { created: false, task: existing }
  }
  const queue = getDesktopTaskQueueRef()
  const id = randomUUID()
  await queue.add({
    id,
    groupKey: 'model-download',
    input: {
      kind: 'model-download',
      url: `asr:${tier}`,
      title: `ASR: ${tier}`,
      options: { asrTier: tier, ...creation }
    }
  })
  const task = queue.get(id)
  if (!task) {
    throw new Error('ASR download task was not persisted')
  }
  return { created: true, task }
}

/** Preserve the Settings API's awaitable result while the durable queue owns execution. */
export async function waitForAsrModelTask(id: string): Promise<void> {
  const queue = getDesktopTaskQueueRef()
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = (): void => {}
    /** Settle on completion, removal, cancellation or pause; surface actual download failures. */
    const check = (): void => {
      const task = queue.get(id)
      if (task && !TERMINAL_STATUSES.has(task.status) && task.status !== 'paused') {
        return
      }
      unsubscribe()
      if (task?.status === 'failed') {
        reject(new Error(task.lastError?.rawMessage ?? 'ASR model download failed'))
      } else if (task?.status === 'completed') {
        resolve()
      } else {
        reject(
          Object.assign(new Error('ASR model download cancelled or paused'), { name: 'AbortError' })
        )
      }
    }
    unsubscribe = queue.subscribe(check)
    check()
  })
}
