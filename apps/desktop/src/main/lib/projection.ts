/**
 * Desktop renderer projection helpers.
 *
 * Narrow @vidbee/task-queue's host-neutral `LegacyTaskProjection` into the
 * concrete `DownloadItem` / `DownloadHistoryItem` shapes the renderer reads
 * via IPC. Renderer code stays unchanged after NEX-131; only the field
 * provenance moves from the legacy `download-engine` / `history-manager` to
 * the shared `tasks` table.
 *
 * Optional new fields (`subStatus`, `nextRetryAt`, `attempt`, `maxAttempts`,
 * `errorCategory`, `internalStatus`, `statusReason`) are surfaced verbatim
 * so renderer components that opt in can show retry/paused state without a
 * new component contract.
 */

import type { Task } from '@vidbee/task-queue'
import { projectTaskToLegacy } from '@vidbee/task-queue'

import type {
  DownloadHistoryItem,
  DownloadItem,
  DownloadProgress,
  VideoFormat
} from '../../shared/types'

interface RendererTaskOptions {
  origin?: 'manual' | 'subscription'
  selectedFormat?: VideoFormat
  ytDlpCommand?: string
  glitchTipEventId?: string
}

const readRendererOptions = (task: Readonly<Task>): RendererTaskOptions => {
  const opts = (task.input.options ?? {}) as Record<string, unknown>
  return {
    origin:
      typeof opts.origin === 'string' ? (opts.origin as 'manual' | 'subscription') : undefined,
    selectedFormat: opts.selectedFormat as VideoFormat | undefined,
    ytDlpCommand: typeof opts.ytDlpCommand === 'string' ? opts.ytDlpCommand : undefined,
    glitchTipEventId: typeof opts.glitchTipEventId === 'string' ? opts.glitchTipEventId : undefined
  }
}

const buildProgress = (
  proj: ReturnType<typeof projectTaskToLegacy>
): DownloadProgress | undefined => {
  if (!proj.progress) {
    return undefined
  }
  return {
    percent: proj.progress.percent,
    currentSpeed: proj.progress.currentSpeed,
    eta: proj.progress.eta,
    downloaded: proj.progress.downloaded,
    total: proj.progress.total
  }
}

/**
 * Project a Task into the renderer's `DownloadItem` shape (active queue
 * snapshot). Use this for `download:queued` / `download:updated` IPC
 * payloads and for `getActiveDownloads()` returns.
 */
export const projectTaskForRenderer = (task: Readonly<Task>): DownloadItem => {
  const proj = projectTaskToLegacy(task)
  const renderer = readRendererOptions(task)
  const item: DownloadItem = {
    id: proj.id,
    url: proj.url,
    title: proj.title ?? proj.url,
    type: proj.type,
    status: proj.status,
    createdAt: proj.createdAt
  }
  if (proj.thumbnail !== undefined) {
    item.thumbnail = proj.thumbnail
  }
  if (proj.startedAt !== undefined) {
    item.startedAt = proj.startedAt
  }
  if (proj.completedAt !== undefined) {
    item.completedAt = proj.completedAt
  }
  if (proj.duration !== undefined) {
    item.duration = proj.duration
  }
  if (proj.fileSize !== undefined) {
    item.fileSize = proj.fileSize
  }
  if (proj.savedFileName !== undefined) {
    item.savedFileName = proj.savedFileName
  }
  if (proj.resolvedFormatId !== undefined) {
    item.resolvedFormatId = proj.resolvedFormatId
  }
  if (proj.subtitleStatus !== undefined) {
    item.subtitleStatus = proj.subtitleStatus
  }
  if (proj.subtitleLanguages !== undefined) {
    item.subtitleLanguages = proj.subtitleLanguages
  }
  if (proj.speed !== undefined) {
    item.speed = proj.speed
  }
  if (proj.description !== undefined) {
    item.description = proj.description
  }
  if (proj.channel !== undefined) {
    item.channel = proj.channel
  }
  if (proj.uploader !== undefined) {
    item.uploader = proj.uploader
  }
  if (proj.viewCount !== undefined) {
    item.viewCount = proj.viewCount
  }
  if (proj.tags !== undefined) {
    item.tags = proj.tags
  }
  if (proj.playlistId !== undefined) {
    item.playlistId = proj.playlistId
  }
  if (proj.playlistTitle !== undefined) {
    item.playlistTitle = proj.playlistTitle
  }
  if (proj.playlistIndex !== undefined) {
    item.playlistIndex = proj.playlistIndex
  }
  if (proj.playlistSize !== undefined) {
    item.playlistSize = proj.playlistSize
  }
  if (proj.error !== undefined) {
    item.error = proj.error
  }
  if (renderer.origin !== undefined) {
    item.origin = renderer.origin
  }
  if (task.input.subscriptionId !== undefined) {
    item.subscriptionId = task.input.subscriptionId
  }
  if (renderer.selectedFormat !== undefined) {
    item.selectedFormat = renderer.selectedFormat
  }
  if (renderer.ytDlpCommand !== undefined) {
    item.ytDlpCommand = renderer.ytDlpCommand
  }
  if (renderer.glitchTipEventId !== undefined) {
    item.glitchTipEventId = renderer.glitchTipEventId
  }
  const progress = buildProgress(proj)
  if (progress) {
    item.progress = progress
  }
  // NEX-131 §10.A.5 passthrough: surface the kernel-side state markers so
  // the renderer can show paused / retry-scheduled rows distinctly even
  // though the legacy `status` enum collapses both into 'pending'.
  item.internalStatus = task.status
  if (task.statusReason !== null && task.statusReason !== undefined) {
    item.statusReason = task.statusReason
  }
  if (task.status === 'paused' || task.status === 'retry-scheduled') {
    item.subStatus = task.status
  }
  if (task.nextRetryAt !== null && task.nextRetryAt !== undefined) {
    item.nextRetryAt = task.nextRetryAt
  }
  item.attempt = task.attempt
  item.maxAttempts = task.maxAttempts
  if (task.lastError?.category) {
    item.errorCategory = task.lastError.category
  }
  return item
}

/**
 * Project a terminal Task into the renderer's `DownloadHistoryItem` shape.
 * Returns null for non-terminal tasks (those should not surface in history).
 */
export const projectTaskForRendererHistory = (task: Readonly<Task>): DownloadHistoryItem | null => {
  const proj = projectTaskToLegacy(task)
  if (proj.status !== 'completed' && proj.status !== 'error' && proj.status !== 'cancelled') {
    return null
  }
  const renderer = readRendererOptions(task)
  const item: DownloadHistoryItem = {
    id: proj.id,
    url: proj.url,
    title: proj.title ?? proj.url,
    type: proj.type,
    status: proj.status,
    createdAt: proj.createdAt,
    startedAt: proj.startedAt,
    downloadedAt: proj.startedAt ?? proj.createdAt
  }
  if (proj.thumbnail !== undefined) {
    item.thumbnail = proj.thumbnail
  }
  if (proj.completedAt !== undefined) {
    item.completedAt = proj.completedAt
  }
  if (proj.duration !== undefined) {
    item.duration = proj.duration
  }
  if (proj.fileSize !== undefined) {
    item.fileSize = proj.fileSize
  }
  if (proj.downloadPath !== undefined) {
    item.downloadPath = proj.downloadPath
  }
  if (proj.savedFileName !== undefined) {
    item.savedFileName = proj.savedFileName
  }
  if (proj.resolvedFormatId !== undefined) {
    item.resolvedFormatId = proj.resolvedFormatId
  }
  if (proj.subtitleStatus !== undefined) {
    item.subtitleStatus = proj.subtitleStatus
  }
  if (proj.subtitleLanguages !== undefined) {
    item.subtitleLanguages = proj.subtitleLanguages
  }
  if (proj.error !== undefined) {
    item.error = proj.error
  }
  if (proj.description !== undefined) {
    item.description = proj.description
  }
  if (proj.channel !== undefined) {
    item.channel = proj.channel
  }
  if (proj.uploader !== undefined) {
    item.uploader = proj.uploader
  }
  if (proj.viewCount !== undefined) {
    item.viewCount = proj.viewCount
  }
  if (proj.tags !== undefined) {
    item.tags = proj.tags
  }
  if (proj.playlistId !== undefined) {
    item.playlistId = proj.playlistId
  }
  if (proj.playlistTitle !== undefined) {
    item.playlistTitle = proj.playlistTitle
  }
  if (proj.playlistIndex !== undefined) {
    item.playlistIndex = proj.playlistIndex
  }
  if (proj.playlistSize !== undefined) {
    item.playlistSize = proj.playlistSize
  }
  if (renderer.origin !== undefined) {
    item.origin = renderer.origin
  }
  if (task.input.subscriptionId !== undefined) {
    item.subscriptionId = task.input.subscriptionId
  }
  if (renderer.selectedFormat !== undefined) {
    item.selectedFormat = renderer.selectedFormat
  }
  if (renderer.ytDlpCommand !== undefined) {
    item.ytDlpCommand = renderer.ytDlpCommand
  }
  if (renderer.glitchTipEventId !== undefined) {
    item.glitchTipEventId = renderer.glitchTipEventId
  }
  return item
}

/** Projected progress payload used by `download:progress` IPC events. */
export const projectProgressForRenderer = (task: Readonly<Task>): DownloadProgress | undefined =>
  buildProgress(projectTaskToLegacy(task))
