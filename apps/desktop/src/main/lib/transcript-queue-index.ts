import type { Task, TaskQueueAPI } from '@vidbee/task-queue'

/** Statuses `findActiveTranscription` treats as an in-flight transcription child. */
const ACTIVE_TRANSCRIPTION = new Set([
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled'
])

/** One queue read is enough for the whole library. Larger histories stay one pass. */
const QUEUE_PAGE_LIMIT = 1_000_000

/** Transcription children for one download, newest first, plus the active child. */
export interface TranscriptQueueChildren {
  active: Task | undefined
  children: Task[]
}

/**
 * Prefer a running or processing child, then the newest other active child.
 * Matches `findActiveTranscription` when `children` is newest first.
 *
 * @param children Transcription tasks for one download, newest first.
 */
export const pickActiveTranscription = (children: readonly Task[]): Task | undefined =>
  children.find((task) => task.status === 'running' || task.status === 'processing') ??
  children.find((task) => ACTIVE_TRANSCRIPTION.has(task.status))

/**
 * Read the queue once and group transcription children by parent download.
 * Callers must not call `queue.list({ parentId })` again while building the library.
 *
 * @param queue Desktop task queue.
 */
export const readTranscriptQueueIndex = (
  queue: Pick<TaskQueueAPI, 'list'>
): { childrenByParent: Map<string, TranscriptQueueChildren>; tasks: Task[] } => {
  const tasks: Task[] = []
  let cursor: string | null = null
  do {
    const page = queue.list({ cursor, limit: QUEUE_PAGE_LIMIT })
    for (const task of page.tasks) {
      tasks.push(task)
    }
    cursor = page.nextCursor
  } while (cursor)
  const grouped = new Map<string, Task[]>()
  for (const task of tasks) {
    if (task.kind !== 'transcription' || !task.parentId) {
      continue
    }
    const rows = grouped.get(task.parentId)
    if (rows) {
      rows.push(task)
    } else {
      grouped.set(task.parentId, [task])
    }
  }
  const childrenByParent = new Map<string, TranscriptQueueChildren>()
  for (const [parentId, rows] of grouped) {
    rows.sort((left, right) => right.createdAt - left.createdAt)
    childrenByParent.set(parentId, { active: pickActiveTranscription(rows), children: rows })
  }
  return { childrenByParent, tasks }
}
