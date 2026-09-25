/**
 * Read-only history facade backed by the shared task-queue `tasks` table
 * (NEX-131 acceptance: "history-manager 不再持有独立 schema；旧 history 表只读
 * fallback").
 *
 * The legacy DB-backed `HistoryManager` class is gone. All history reads
 * walk `TaskQueueAPI.list()` and project terminal rows through
 * `projectTaskForRendererHistory` so renderer/IPC consumers see exactly the
 * same `DownloadHistoryItem` shape they always have.
 *
 * Mutations:
 *   - `addHistoryItem` is a no-op: creating tasks now goes through
 *     `downloadEngine.startDownload()` (which in turn calls
 *     `taskQueue.add()`); nothing else legitimately needs to write to
 *     history. We log an info breadcrumb so any straggling caller is loud.
 *   - `removeHistoryItem` / `removeHistoryItems` / `removeHistoryByPlaylistId` /
 *     `clearHistory` delegate to `taskQueue.removeFromHistory`, then drop the
 *     stored transcripts and prompt runs for those downloads.
 */
import { isMediaTaskKind, type Task } from '@vidbee/task-queue'

import type { DownloadHistoryItem } from '../../shared/types'
import { scopedLoggers } from '../utils/logger'

import { getDatabaseConnection } from './database'
import { projectTaskForRendererHistory } from './projection'
import { getDesktopTaskQueue } from './task-queue-host'
import { deleteTranscriptsForDownload } from './transcript-host'

const logger = scopedLoggers.engine

const TERMINAL: ReadonlySet<Task['status']> = new Set(['completed', 'failed', 'cancelled'])

/**
 * Remove a terminal download from the queue and drop its stored transcripts.
 *
 * @param id Download task id.
 * @returns True when the history row was removed.
 */
const removeTerminalDownload = async (id: string): Promise<boolean> => {
  const queue = getDesktopTaskQueue()
  const task = queue.get(id)
  if (!(task && TERMINAL.has(task.status))) {
    return false
  }
  await queue.removeFromHistory(id)
  try {
    deleteTranscriptsForDownload(id)
  } catch (error) {
    logger.warn('history-manager: failed to delete transcripts', { id, error })
  }
  return true
}

/**
 * Drop matching rows from the pre-NEX-131 `download_history` table so the
 * boot importer cannot resurrect a record the user just removed.
 */
const deleteLegacyHistoryRows = (ids: string[]): void => {
  if (ids.length === 0) {
    return
  }
  try {
    const { sqlite } = getDatabaseConnection()
    const table = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'")
      .get() as { name?: string } | undefined
    if (!table?.name) {
      return
    }
    const del = sqlite.prepare('DELETE FROM download_history WHERE id = ?')
    const tx = sqlite.transaction((taskIds: string[]) => {
      for (const id of taskIds) {
        del.run(id)
      }
    })
    tx(ids)
  } catch (err) {
    logger.warn('history-manager: failed to delete legacy download_history rows', { ids, err })
  }
}

const allTerminalTasks = (): Task[] => {
  const queue = getDesktopTaskQueue()
  const all: Task[] = []
  let cursor: string | null = null
  do {
    const page = queue.list({ limit: 200, cursor })
    for (const t of page.tasks) {
      if (TERMINAL.has(t.status) && isMediaTaskKind(t.kind)) {
        all.push(t)
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return all
}

const projectAll = (): DownloadHistoryItem[] => {
  const items: DownloadHistoryItem[] = []
  for (const task of allTerminalTasks()) {
    const projected = projectTaskForRendererHistory(task)
    if (projected) {
      items.push(projected)
    }
  }
  return items.sort((a, b) => {
    const aTime = a.completedAt ?? a.downloadedAt
    const bTime = b.completedAt ?? b.downloadedAt
    return bTime - aTime
  })
}

class HistoryFacade {
  getHistory(): DownloadHistoryItem[] {
    return projectAll()
  }

  async getHistoryById(id: string): Promise<DownloadHistoryItem | undefined> {
    const queue = getDesktopTaskQueue()
    const task = queue.get(id)
    if (!(task && TERMINAL.has(task.status))) {
      return undefined
    }
    const item = projectTaskForRendererHistory(task) ?? undefined
    if (item) {
      // Surface the persisted yt-dlp output so the renderer's Logs tab works
      // for terminal items, whose live stream is already gone.
      const log = await queue.getTaskLog(id)
      if (log) {
        item.ytDlpLog = log
      }
    }
    return item
  }

  /**
   * Legacy `addHistoryItem` is no longer the way to record history; tasks
   * appear in this view automatically once they reach a terminal state.
   * We keep the method so the IPC contract stays compatible and log a
   * breadcrumb if anything still calls it.
   */
  addHistoryItem(item: DownloadHistoryItem): void {
    logger.warn('history-manager.addHistoryItem is a no-op after NEX-131', {
      id: item.id,
      url: item.url,
      status: item.status
    })
  }

  /**
   * Persistently remove one terminal download. Awaits disk delete so a
   * restart cannot resurrect the row.
   */
  async removeHistoryItem(id: string): Promise<boolean> {
    deleteLegacyHistoryRows([id])
    return removeTerminalDownload(id)
  }

  /**
   * Persistently remove many terminal downloads.
   */
  async removeHistoryItems(ids: string[]): Promise<number> {
    const unique = Array.from(new Set(ids.map((s) => s.trim()).filter((s) => s.length > 0)))
    deleteLegacyHistoryRows(unique)
    let removed = 0
    for (const id of unique) {
      if (await removeTerminalDownload(id)) {
        removed += 1
      }
    }
    return removed
  }

  /**
   * Persistently remove every terminal download in a playlist group.
   */
  async removeHistoryByPlaylistId(playlistId: string): Promise<number> {
    const normalized = playlistId.trim()
    if (!normalized) {
      return 0
    }
    const matching = allTerminalTasks().filter((task) => task.input.playlistId === normalized)
    deleteLegacyHistoryRows(matching.map((task) => task.id))
    let removed = 0
    for (const task of matching) {
      if (await removeTerminalDownload(task.id)) {
        removed += 1
      }
    }
    return removed
  }

  /**
   * Persistently remove every terminal download from history.
   */
  async clearHistory(): Promise<void> {
    const tasks = allTerminalTasks()
    deleteLegacyHistoryRows(tasks.map((task) => task.id))
    for (const task of tasks) {
      await removeTerminalDownload(task.id)
    }
  }

  getHistoryCount(): {
    active: number
    completed: number
    error: number
    cancelled: number
    total: number
  } {
    const counts = { active: 0, completed: 0, error: 0, cancelled: 0, total: 0 }
    for (const task of allTerminalTasks()) {
      counts.total += 1
      if (task.status === 'completed') {
        counts.completed += 1
      } else if (task.status === 'failed') {
        counts.error += 1
      } else if (task.status === 'cancelled') {
        counts.cancelled += 1
      } else {
        counts.active += 1
      }
    }
    return counts
  }

  /**
   * Used by `subscriptions-host` to dedupe RSS items against existing
   * history. Walks completed tasks (only completed counts as "already
   * downloaded"; failed/cancelled are not considered duplicates so the
   * scheduler can retry them).
   */
  hasHistoryForUrl(url: string): boolean {
    const target = url.trim()
    if (!target) {
      return false
    }
    const queue = getDesktopTaskQueue()
    let cursor: string | null = null
    do {
      const page = queue.list({ status: 'completed', limit: 200, cursor })
      for (const t of page.tasks) {
        if (t.input.url === target) {
          return true
        }
      }
      cursor = page.nextCursor
    } while (cursor)
    return false
  }
}

export const historyManager = new HistoryFacade()
