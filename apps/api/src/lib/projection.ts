/**
 * Narrow @vidbee/task-queue's host-neutral LegacyTaskProjection into the
 * concrete `DownloadTask` shape that the public downloaderContract returns.
 * Any field absent from DownloadTask is dropped here, not in the shared
 * projection — Desktop carries some of the same fields but renders them
 * differently.
 */

import type { DownloadTask } from '@vidbee/downloader-core'
import type { Task } from '@vidbee/task-queue'
import { projectTaskToLegacy } from '@vidbee/task-queue'

export function projectTaskForApi(task: Readonly<Task>): DownloadTask {
  const proj = projectTaskToLegacy(task)
  const out: DownloadTask = {
    id: proj.id,
    url: proj.url,
    title: proj.title,
    thumbnail: proj.thumbnail,
    type: proj.type,
    status: proj.status,
    createdAt: proj.createdAt,
    startedAt: proj.startedAt,
    completedAt: proj.completedAt,
    duration: proj.duration,
    fileSize: proj.fileSize,
    speed: proj.speed,
    downloadPath: proj.downloadPath,
    savedFileName: proj.savedFileName,
    description: proj.description,
    channel: proj.channel,
    uploader: proj.uploader,
    viewCount: proj.viewCount,
    tags: proj.tags,
    playlistId: proj.playlistId,
    playlistTitle: proj.playlistTitle,
    playlistIndex: proj.playlistIndex,
    playlistSize: proj.playlistSize,
    error: proj.error,
    internalStatus: proj.internalStatus,
    subStatus: proj.subStatus,
    statusReason: proj.statusReason,
    errorCategory: proj.errorCategory,
    uiMessageKey: proj.uiMessageKey,
    nextRetryAt: proj.nextRetryAt,
    attempt: proj.attempt,
    maxAttempts: proj.maxAttempts
  }
  if (proj.progress) {
    out.progress = {
      percent: proj.progress.percent,
      currentSpeed: proj.progress.currentSpeed,
      eta: proj.progress.eta,
      downloaded: proj.progress.downloaded,
      total: proj.progress.total
    }
  }
  return out
}
