import { DownloaderCore } from '@vidbee/downloader-core'

const defaultDownloadDir =
  process.env.VIDBEE_DOWNLOAD_DIR?.trim() || process.env.DOWNLOAD_DIR?.trim() || undefined

const maxConcurrentValue = process.env.VIDBEE_MAX_CONCURRENT?.trim()
const parsedMaxConcurrent = maxConcurrentValue ? Number(maxConcurrentValue) : Number.NaN
const maxConcurrent =
  Number.isFinite(parsedMaxConcurrent) && parsedMaxConcurrent > 0
    ? parsedMaxConcurrent
    : undefined

export const downloaderCore = new DownloaderCore({
  downloadDir: defaultDownloadDir,
  maxConcurrent
})
