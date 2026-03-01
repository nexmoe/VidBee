import path from 'node:path'
import type { DownloadTask } from '@vidbee/downloader-core'
import { DownloaderCore } from '@vidbee/downloader-core'
import { HistoryStore } from './history-store'

const defaultDownloadDir =
  process.env.VIDBEE_DOWNLOAD_DIR?.trim() || process.env.DOWNLOAD_DIR?.trim() || undefined

const maxConcurrentValue = process.env.VIDBEE_MAX_CONCURRENT?.trim()
const parsedMaxConcurrent = maxConcurrentValue ? Number(maxConcurrentValue) : Number.NaN
const maxConcurrent =
  Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent > 0 ? parsedMaxConcurrent : undefined

const configuredHistoryStorePath = process.env.VIDBEE_HISTORY_STORE_PATH?.trim()
const historyStorePath = configuredHistoryStorePath
  ? configuredHistoryStorePath
  : defaultDownloadDir
    ? path.join(defaultDownloadDir, '.vidbee', 'vidbee.db')
    : path.join(process.cwd(), '.vidbee', 'vidbee.db')

export const historyStore = new HistoryStore(historyStorePath)

export const downloaderCore = new DownloaderCore({
  downloadDir: defaultDownloadDir,
  maxConcurrent
})

const terminalStatuses = new Set<DownloadTask['status']>(['completed', 'error', 'cancelled'])

downloaderCore.on('task-updated', (task: DownloadTask) => {
  if (!terminalStatuses.has(task.status)) {
    return
  }
  historyStore.save(task)
})
