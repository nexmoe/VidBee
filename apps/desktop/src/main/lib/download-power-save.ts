import type { Task, TransitionEvent } from '@vidbee/task-queue'

interface DownloadActivitySource {
  list: (options: { cursor?: string | null; limit: number }) => {
    tasks: Pick<Task, 'id' | 'status'>[]
    nextCursor: string | null
  }
  on: (type: 'transition', listener: (event: TransitionEvent) => void) => () => void
}

interface PowerSaveBlockerAdapter {
  isStarted: (id: number) => boolean
  start: (type: 'prevent-app-suspension') => number
  stop: (id: number) => boolean
}

const ACTIVE_DOWNLOAD_STATUSES: ReadonlySet<Task['status']> = new Set(['running', 'processing'])

/** Read every active task so a guard also covers work already running at startup. */
const readActiveTaskIds = (queue: DownloadActivitySource): Set<string> => {
  const activeTaskIds = new Set<string>()
  let cursor: string | null = null
  do {
    const page = queue.list({ cursor, limit: 200 })
    for (const task of page.tasks) {
      if (ACTIVE_DOWNLOAD_STATUSES.has(task.status)) {
        activeTaskIds.add(task.id)
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return activeTaskIds
}

/**
 * Prevent application suspension while at least one download is active and
 * return a cleanup function that always releases the blocker.
 */
export const startDownloadPowerSaveGuard = (
  queue: DownloadActivitySource,
  blocker: PowerSaveBlockerAdapter
): (() => void) => {
  const activeTaskIds = readActiveTaskIds(queue)
  let blockerId: number | null = null

  /** Match the OS blocker state to the current set of active downloads. */
  const syncBlocker = (): void => {
    const blockerIsActive = blockerId !== null && blocker.isStarted(blockerId)
    if (activeTaskIds.size > 0 && !blockerIsActive) {
      blockerId = blocker.start('prevent-app-suspension')
      return
    }
    if (activeTaskIds.size === 0 && blockerId !== null) {
      if (blockerIsActive) {
        blocker.stop(blockerId)
      }
      blockerId = null
    }
  }

  const unsubscribe = queue.on('transition', (event) => {
    if (ACTIVE_DOWNLOAD_STATUSES.has(event.to)) {
      activeTaskIds.add(event.taskId)
    } else {
      activeTaskIds.delete(event.taskId)
    }
    syncBlocker()
  })

  syncBlocker()

  return () => {
    unsubscribe()
    activeTaskIds.clear()
    syncBlocker()
  }
}
