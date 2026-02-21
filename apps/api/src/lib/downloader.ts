import { DownloaderCore } from '@vidbee/downloader-core'

const defaultDownloadDir =
  process.env.VIDBEE_DOWNLOAD_DIR?.trim() || process.env.DOWNLOAD_DIR?.trim() || undefined

const maxConcurrentValue = Number(process.env.VIDBEE_MAX_CONCURRENT ?? '')
const maxConcurrent = Number.isFinite(maxConcurrentValue) ? maxConcurrentValue : undefined

export const downloaderCore = new DownloaderCore({
  downloadDir: defaultDownloadDir,
  maxConcurrent
})
