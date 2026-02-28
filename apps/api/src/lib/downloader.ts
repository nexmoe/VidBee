import path from 'node:path'
import { DownloaderCore } from '@vidbee/downloader-core'

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
    ? path.join(defaultDownloadDir, '.vidbee', 'history.json')
    : undefined

export const downloaderCore = new DownloaderCore({
  downloadDir: defaultDownloadDir,
  maxConcurrent,
  historyStorePath
})
