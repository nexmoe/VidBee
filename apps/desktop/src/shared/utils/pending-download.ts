import type { DownloadItem, DownloadOptions } from '../types'

/**
 * True when a caller already provided enough video metadata for list rendering.
 */
export const hasDisplayMetadata = (
  options: Pick<DownloadOptions, 'title' | 'thumbnail'>
): boolean => Boolean(options.title?.trim() && options.thumbnail?.trim())

/**
 * Build the pending row shown as soon as a download is accepted, before
 * yt-dlp metadata hydration finishes.
 */
export const buildPendingDownloadItem = (id: string, options: DownloadOptions): DownloadItem => {
  const title = options.title?.trim()
  const item: DownloadItem = {
    id,
    url: options.url,
    title: title || options.url,
    type: options.type,
    status: 'pending',
    progress: { percent: 0 },
    createdAt: Date.now()
  }
  if (options.thumbnail) {
    item.thumbnail = options.thumbnail
  }
  if (options.description) {
    item.description = options.description
  }
  if (options.channel) {
    item.channel = options.channel
  }
  if (options.uploader) {
    item.uploader = options.uploader
  }
  if (options.viewCount !== undefined) {
    item.viewCount = options.viewCount
  }
  if (options.duration !== undefined) {
    item.duration = options.duration
  }
  if (options.selectedFormat) {
    item.selectedFormat = options.selectedFormat
  }
  if (options.origin) {
    item.origin = options.origin
  }
  if (options.subscriptionId) {
    item.subscriptionId = options.subscriptionId
  }
  if (options.tags) {
    item.tags = options.tags
  }
  return item
}
