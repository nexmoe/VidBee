/**
 * Desktop download facade (NEX-131 A段 收尾).
 *
 * Replaces the legacy `download-engine.ts` EventEmitter with a thin shim
 * over the shared TaskQueueAPI. Public surface (`startDownload`,
 * `cancelDownload`, `getActiveDownloads`, etc. + the legacy event names)
 * stays compatible so renderer/IPC handlers are unchanged. Inputs are
 * stuffed into `task.input.options` (per `YtDlpTaskOptions`) and outputs
 * are mapped back through `projectTaskForRenderer`.
 *
 * Live yt-dlp log streaming is wired through the kernel's `log` event
 * (emitted from the executor's `onStd`): we keep a capped per-task buffer and
 * emit only the appended chunk on `download-log`. Saved logs for terminal items
 * are read on demand from the persisted attempt tail (`queue.getTaskLog`).
 * `glitchTipEventId` remains a best-effort no-op in this iteration.
 */
import { EventEmitter } from 'node:events'
import path from 'node:path'

import {
  downloadIdentity,
  isLibraryTaskKind,
  PRIORITY_USER,
  type Task,
  type TaskInput,
  type TaskQueueAPI
} from '@vidbee/task-queue'
import { appendCappedLog } from '../../shared/live-log'
import type {
  DownloadItem,
  DownloadOptions,
  DownloadProgress,
  PlaylistDownloadOptions,
  PlaylistDownloadResult,
  PlaylistInfo,
  VideoInfo,
  VideoInfoCommandResult
} from '../../shared/types'
import { buildPendingDownloadItem } from '../../shared/utils/pending-download'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { cancelledPartTargets, deleteCancelledDownloadParts } from './cancelled-download-parts'
import { toSharedSettings } from './command-utils'
import { hydrateDownloadMetadata } from './download-metadata'
import { shouldSurfaceQueuedDownload } from './download-queue-events'
import { applyAutoVideoDownloadPath } from './path-resolver'
import { projectProgressForRenderer, projectTaskForRenderer } from './projection'
import {
  applyDesktopQueueConcurrency,
  getDesktopTaskQueue,
  startDesktopTaskQueue
} from './task-queue-host'
import { fetchPlaylistInfo, fetchVideoInfo, fetchVideoInfoWithCommand } from './yt-dlp-info'

const logger = scopedLoggers.download

const NON_TERMINAL: ReadonlySet<Task['status']> = new Set([
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled'
])

const ensureDirectoryExists = (dir?: string): void => {
  if (!dir) {
    return
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.warn('download-facade: failed to ensure download directory', err)
  }
}

const buildTaskInput = (id: string, options: DownloadOptions): TaskInput => {
  const settings = settingsManager.getAll()
  const downloadPath = options.customDownloadPath?.trim() || settings.downloadPath || ''
  return {
    url: options.url,
    kind: options.type === 'audio' ? 'audio' : 'video',
    subscriptionId: options.subscriptionId,
    // Stash renderer-fetched metadata at the canonical TaskInput slots so
    // projectTaskToLegacy round-trips them. Without these, the renderer's
    // optimistic row gets its title/thumbnail/etc. wiped the first time
    // snapshot-changed fires `download:updated` with the bare projection.
    title: options.title,
    thumbnail: options.thumbnail,
    options: {
      type: options.type,
      format: options.format,
      audioFormat: options.audioFormat,
      audioFormatIds: options.audioFormatIds,
      startTime: options.startTime,
      endTime: options.endTime,
      customDownloadPath: options.customDownloadPath || downloadPath,
      customFilenameTemplate: options.customFilenameTemplate,
      containerFormat: options.containerFormat,
      // Snapshot the runtime download settings (cookies, proxy, embed flags) at
      // enqueue time. Without these the task-queue executor falls back to empty
      // defaults, so cookie-gated sites (e.g. Bilibili) fail with HTTP 412 and
      // embed/proxy preferences are silently ignored.
      settings: toSharedSettings(settings),
      // Renderer hint: stash original client id for diagnostics; not used
      // for correlation (the kernel id is canonical).
      clientId: id,
      origin: options.origin ?? 'manual',
      tags: options.tags,
      downloadPath,
      // Metadata mirrored back through projectTaskToLegacy → projection.ts
      // so the renderer sees the same fields it saw on optimistic insert.
      description: options.description,
      channel: options.channel,
      uploader: options.uploader,
      viewCount: options.viewCount,
      duration: options.duration,
      selectedFormat: options.selectedFormat
    }
  }
}

/** Share metadata, directory and settings preparation with callers that await queue admission. */
export const prepareDownloadTaskInput = async (
  id: string,
  options: DownloadOptions
): Promise<TaskInput> => {
  const hydrated = await hydrateDownloadMetadata(options)
  const resolved = applyAutoVideoDownloadPath(hydrated, settingsManager.getAll())
  ensureDirectoryExists(resolved.customDownloadPath)
  return buildTaskInput(id, resolved)
}

class DownloadFacade extends EventEmitter {
  private subscribed = false
  /** Capped live yt-dlp output per active task. Callers that need the full tail read `queue.getTaskLog`. */
  private readonly logBuffers = new Map<string, string>()
  /** Starts that have been shown in the list but are still hydrating metadata. */
  private readonly pendingStarts = new Map<
    string,
    { cancelled: boolean; identity: string | null }
  >()

  private get queue(): TaskQueueAPI {
    return getDesktopTaskQueue()
  }

  private subscribeOnce(): void {
    if (this.subscribed) {
      return
    }
    this.subscribed = true
    const queue = this.queue
    queue.on('task-removed', (event) => {
      this.logBuffers.delete(event.taskId)
      this.emit('download-removed', event.taskId)
    })
    queue.on('snapshot-changed', (event) => {
      if (!isLibraryTaskKind(event.task.kind)) {
        return
      }
      const item = projectTaskForRenderer(event.task)
      this.emit('download-updated', item.id, item)
    })
    queue.on('transition', (event) => {
      const task = queue.get(event.taskId)
      if (!(task && isLibraryTaskKind(task.kind))) {
        return
      }
      const item = projectTaskForRenderer(task)
      switch (event.to) {
        case 'queued':
          if (shouldSurfaceQueuedDownload(event.from)) {
            this.logBuffers.delete(event.taskId)
            this.emit('download-queued', item)
          }
          break
        case 'running':
          this.emit('download-started', event.taskId)
          break
        case 'completed':
          this.logBuffers.delete(event.taskId)
          this.emit('download-completed', event.taskId)
          break
        case 'failed': {
          this.logBuffers.delete(event.taskId)
          const message = task.lastError?.rawMessage ?? 'Download failed'
          this.emit('download-error', event.taskId, new Error(message))
          break
        }
        case 'cancelled':
          this.logBuffers.delete(event.taskId)
          void this.removeCancelledPartialFiles(task)
          this.emit('download-cancelled', event.taskId)
          break
        default:
          // paused / retry-scheduled / processing surface via download-updated.
          break
      }
    })
    queue.on('progress', (event) => {
      const task = queue.get(event.taskId)
      if (!task) {
        return
      }
      const progress = projectProgressForRenderer(task)
      if (progress) {
        this.emit('download-progress', event.taskId, progress as DownloadProgress)
      }
    })
    // Stream live yt-dlp output. The buffer stays capped for in-process readers.
    // Renderer IPC receives only the appended line; the main process coalesces it.
    queue.on('log', (event) => {
      const chunk = `${event.line}\n`
      const buffer = appendCappedLog(this.logBuffers.get(event.taskId) ?? '', chunk)
      this.logBuffers.set(event.taskId, buffer)
      this.emit('download-log', event.taskId, chunk)
    })
  }

  // ───────────── Stateless metadata ─────────────

  getVideoInfo(url: string): Promise<VideoInfo> {
    return fetchVideoInfo(url)
  }

  getVideoInfoWithCommand(url: string): Promise<VideoInfoCommandResult> {
    return fetchVideoInfoWithCommand(url)
  }

  getPlaylistInfo(url: string): Promise<PlaylistInfo> {
    return fetchPlaylistInfo(url)
  }

  // ───────────── Queue control ─────────────

  /** Reject duplicate requests before displaying or hydrating another pending download. */
  startDownload(id: string, options: DownloadOptions): boolean {
    this.subscribeOnce()
    const input = buildTaskInput(id, options)
    const identity = downloadIdentity(input)
    if (
      this.queue.get(id) ||
      this.queue.findDuplicateDownload(input) ||
      this.pendingStarts.has(id) ||
      (identity &&
        [...this.pendingStarts.values()].some((pending) => pending.identity === identity))
    ) {
      return false
    }
    // Show the row immediately. Bilibili (and similar) metadata probes can
    // take tens of seconds; the list must not wait on that hydration.
    this.emit('download-queued', buildPendingDownloadItem(id, options))
    const pending = { cancelled: false, identity }
    this.pendingStarts.set(id, pending)
    void (async () => {
      try {
        await startDesktopTaskQueue()
        if (pending.cancelled) {
          return
        }
        const input = await prepareDownloadTaskInput(id, options)
        if (pending.cancelled) {
          return
        }
        // Pass the renderer-generated id through so optimistic-UI rows merge
        // with the real task instead of showing as two separate entries.
        const result = await this.queue.add({
          id,
          input,
          priority: PRIORITY_USER
        })
        if (result.id !== id) {
          this.emit('download-removed', id)
          return
        }
        if (pending.cancelled) {
          await this.queue.cancel(id, 'user')
        }
      } catch (err) {
        if (pending.cancelled) {
          return
        }
        logger.error('download-facade: startDownload failed', err)
        const message = err instanceof Error ? err : new Error(String(err))
        this.emit('download-error', id, message)
      } finally {
        if (this.pendingStarts.get(id) === pending) {
          this.pendingStarts.delete(id)
        }
      }
    })()
    return true
  }

  /**
   * Remove yt-dlp partials for a cancelled task. Paused tasks never reach this path.
   *
   * @param task Cancelled download task.
   */
  private async removeCancelledPartialFiles(task: Task): Promise<void> {
    if (task.kind === 'subtitles') {
      return
    }
    try {
      const options = task.input.options ?? {}
      let configured = ''
      if (typeof options.customDownloadPath === 'string') {
        configured = options.customDownloadPath
      } else if (typeof options.downloadPath === 'string') {
        configured = options.downloadPath
      }
      const downloadDir = configured.trim()
      const log = await this.queue.getTaskLog(task.id)
      const targets = cancelledPartTargets({
        downloadDir,
        filePath: task.output?.filePath,
        log,
        outputTemplate:
          typeof options.customFilenameTemplate === 'string' ? options.customFilenameTemplate : null
      })
      for (const target of targets) {
        await deleteCancelledDownloadParts(target.directory, target.basenames)
      }
    } catch (err) {
      logger.warn('download-facade: failed to remove cancelled partial files', err)
    }
  }

  /**
   * Cancel a download and acknowledge it only after the terminal state is durable.
   *
   * @param id Download / task id.
   * @returns Whether the task existed and its cancellation was persisted.
   */
  async cancelDownload(id: string): Promise<boolean> {
    this.subscribeOnce()
    const pending = this.pendingStarts.get(id)
    if (pending) {
      pending.cancelled = true
      this.pendingStarts.delete(id)
      this.emit('download-cancelled', id)
      return true
    }
    if (!this.queue.get(id)) {
      return false
    }
    try {
      await this.queue.cancel(id, 'user')
      return true
    } catch (err) {
      logger.error('download-facade: cancelDownload failed', err)
      return false
    }
  }

  /**
   * Pause a queued or in-flight download without removing the row.
   *
   * @param id Download / task id.
   * @returns false when the id is not in the queue.
   */
  pauseDownload(id: string): boolean {
    this.subscribeOnce()
    if (!this.queue.get(id)) {
      return false
    }
    void this.queue.pause(id, 'user').catch((err) => {
      logger.error('download-facade: pauseDownload failed', err)
    })
    return true
  }

  /**
   * Resume a paused download by re-queuing it for a new executor run.
   *
   * @param id Download / task id.
   * @returns false when the id is not in the queue.
   */
  resumeDownload(id: string): boolean {
    this.subscribeOnce()
    if (!this.queue.get(id)) {
      return false
    }
    void this.queue.resume(id).catch((err) => {
      logger.error('download-facade: resumeDownload failed', err)
    })
    return true
  }

  /**
   * Requeue a failed or cancelled task in place. Returns false when the id
   * is missing or not in a retryable terminal state.
   */
  async retryDownload(id: string): Promise<boolean> {
    this.subscribeOnce()
    await startDesktopTaskQueue()
    const task = this.queue.get(id)
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) {
      return false
    }
    await this.queue.retryManual(id)
    return true
  }

  async startPlaylistDownload(options: PlaylistDownloadOptions): Promise<PlaylistDownloadResult> {
    this.subscribeOnce()
    await startDesktopTaskQueue()
    const playlist = await this.getPlaylistInfo(options.url)
    const groupId = `playlist_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    if (playlist.entryCount === 0) {
      logger.warn('Playlist has no entries:', options.url)
      return {
        groupId,
        playlistId: playlist.id,
        playlistTitle: playlist.title,
        type: options.type,
        totalCount: 0,
        startIndex: 0,
        endIndex: 0,
        entries: []
      }
    }

    let selected: PlaylistInfo['entries']
    if (options.entryIds && options.entryIds.length > 0) {
      const ids = new Set(options.entryIds)
      selected = playlist.entries.filter((e) => ids.has(e.id))
    } else {
      const requestedStart = Math.max((options.startIndex ?? 1) - 1, 0)
      const requestedEnd = options.endIndex
        ? Math.min(options.endIndex - 1, playlist.entryCount - 1)
        : playlist.entryCount - 1
      const rangeStart = Math.min(requestedStart, requestedEnd)
      const rangeEnd = Math.max(requestedStart, requestedEnd)
      selected = playlist.entries.slice(rangeStart, rangeEnd + 1)
    }

    const settings = settingsManager.getAll()
    const resolvedDownloadPath =
      options.customDownloadPath?.trim() ||
      path.join(settings.downloadPath, 'Playlists', sanitizePathSegment(playlist.title))
    ensureDirectoryExists(resolvedDownloadPath)

    const entries: PlaylistDownloadResult['entries'] = []
    for (const entry of selected) {
      try {
        const result = await this.queue.add({
          input: {
            url: entry.url,
            kind: options.type === 'audio' ? 'audio' : 'video',
            title: entry.title,
            playlistId: groupId,
            playlistIndex: entry.index,
            options: {
              type: options.type,
              format: options.format,
              audioFormat: options.type === 'audio' ? options.format : undefined,
              customDownloadPath: resolvedDownloadPath,
              containerFormat: options.containerFormat,
              // Same runtime settings (cookies, proxy, embed flags) as single
              // downloads, otherwise playlist entries ignore them too.
              settings: toSharedSettings(settings),
              title: entry.title,
              playlistTitle: playlist.title,
              playlistSize: selected.length,
              origin: 'manual'
            }
          },
          priority: PRIORITY_USER,
          groupKey: `playlist:${groupId}`
        })
        entries.push({
          downloadId: result.id,
          entryId: entry.id,
          title: entry.title,
          url: entry.url,
          index: entry.index
        })
      } catch (err) {
        logger.error('download-facade: failed to enqueue playlist entry', { entry, err })
      }
    }

    return {
      groupId,
      playlistId: playlist.id,
      playlistTitle: playlist.title,
      type: options.type,
      totalCount: selected.length,
      startIndex: selected[0]?.index ?? 0,
      endIndex: selected.at(-1)?.index ?? 0,
      entries
    }
  }

  // ───────────── Read-only ─────────────

  getQueueStatus(): { active: number; pending: number } {
    const stats = this.queue.stats()
    return { active: stats.running, pending: stats.queued }
  }

  getActiveDownloads(): DownloadItem[] {
    const active: DownloadItem[] = []
    let cursor: string | null = null
    do {
      const page = this.queue.list({ limit: 200, cursor })
      for (const t of page.tasks) {
        if (NON_TERMINAL.has(t.status) && isLibraryTaskKind(t.kind)) {
          active.push(projectTaskForRenderer(t))
        }
      }
      cursor = page.nextCursor
    } while (cursor)
    return active.sort((a, b) => b.createdAt - a.createdAt)
  }

  // ───────────── Lifecycle (no-ops; the kernel handles persistence + recovery) ─────────────

  restoreActiveDownloads(): void {
    // TaskQueueAPI.start() already replays in-flight tasks into paused('crash-recovery');
    // explicit restore is unnecessary now.
    this.subscribeOnce()
  }

  flushDownloadSession(): void {
    // SqlitePersistAdapter writes synchronously on transition; nothing to flush.
  }

  /**
   * Refresh scheduler caps after a download-concurrency setting change.
   *
   * @param max Requested download cap; ignored when not a positive number.
   */
  updateMaxConcurrent(max: number): void {
    if (typeof max !== 'number' || max <= 0) {
      return
    }
    applyDesktopQueueConcurrency()
  }

  /**
   * Best-effort: legacy `updateDownloadInfo` was used to stamp
   * `glitchTipEventId` on a task. The kernel doesn't expose a way to patch
   * `task.input.options` after add, so we drop the call with a debug log.
   * Sentry breadcrumbs still record the event; only the per-task
   * decoration is missing.
   */
  updateDownloadInfo(id: string, updates: Partial<DownloadItem>): void {
    if (Object.keys(updates).length === 0) {
      return
    }
    logger.debug('download-facade: updateDownloadInfo dropped', { id, updates })
  }
}

const sanitizePathSegment = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Playlist'

export const downloadEngine = new DownloadFacade()
