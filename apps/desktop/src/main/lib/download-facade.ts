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
 * `download:log` and `glitchTipEventId` are best-effort no-ops in this
 * iteration: the kernel only exposes spawn / progress / transition events
 * to subscribers, not raw stdout. Live yt-dlp log streaming and per-task
 * Sentry annotation can be added once the kernel exposes `onStd` to host
 * subscribers (TODO follow-up tracked in the NEX-131 wrap-up comment).
 */
import { EventEmitter } from 'node:events'
import path from 'node:path'

import { PRIORITY_USER, type Task, type TaskInput, type TaskQueueAPI } from '@vidbee/task-queue'

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
import { buildVideoInfoDownloadMetadata } from '../../shared/utils/video-info-metadata'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { toSharedSettings } from './command-utils'
import { projectProgressForRenderer, projectTaskForRenderer } from './projection'
import { getDesktopTaskQueue, startDesktopTaskQueue } from './task-queue-host'
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

/** True when a caller already provided enough video metadata for list rendering. */
const hasDisplayMetadata = (options: DownloadOptions): boolean =>
  Boolean(options.title?.trim() && options.thumbnail?.trim())

/** Fill missing title/thumbnail metadata from yt-dlp before a task is queued. */
const hydrateDownloadMetadata = async (options: DownloadOptions): Promise<DownloadOptions> => {
  if (hasDisplayMetadata(options)) {
    return options
  }

  try {
    const info = await fetchVideoInfo(options.url)
    const metadata = buildVideoInfoDownloadMetadata(info)
    return {
      ...options,
      title: options.title ?? metadata.title,
      thumbnail: options.thumbnail ?? metadata.thumbnail,
      description: options.description ?? metadata.description,
      channel: options.channel ?? metadata.channel,
      uploader: options.uploader ?? metadata.uploader,
      viewCount: options.viewCount ?? metadata.viewCount,
      duration: options.duration ?? metadata.duration
    }
  } catch (err) {
    logger.warn('download-facade: failed to hydrate video metadata', err)
    return options
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

class DownloadFacade extends EventEmitter {
  private subscribed = false

  private get queue(): TaskQueueAPI {
    return getDesktopTaskQueue()
  }

  private subscribeOnce(): void {
    if (this.subscribed) {
      return
    }
    this.subscribed = true
    const queue = this.queue
    queue.on('snapshot-changed', (event) => {
      const item = projectTaskForRenderer(event.task)
      this.emit('download-updated', item.id, item)
    })
    queue.on('transition', (event) => {
      const task = queue.get(event.taskId)
      if (!task) {
        return
      }
      const item = projectTaskForRenderer(task)
      switch (event.to) {
        case 'queued':
          if (event.from === null) {
            this.emit('download-queued', item)
          }
          break
        case 'running':
          this.emit('download-started', event.taskId)
          break
        case 'completed':
          this.emit('download-completed', event.taskId)
          break
        case 'failed': {
          const message = task.lastError?.rawMessage ?? 'Download failed'
          this.emit('download-error', event.taskId, new Error(message))
          break
        }
        case 'cancelled':
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

  startDownload(id: string, options: DownloadOptions): boolean {
    this.subscribeOnce()
    void (async () => {
      try {
        await startDesktopTaskQueue()
        ensureDirectoryExists(options.customDownloadPath)
        const hydratedOptions = await hydrateDownloadMetadata(options)
        // Pass the renderer-generated id through so optimistic-UI rows merge
        // with the real task instead of showing as two separate entries.
        await this.queue.add({
          id,
          input: buildTaskInput(id, hydratedOptions),
          priority: PRIORITY_USER
        })
      } catch (err) {
        logger.error('download-facade: startDownload failed', err)
        const message = err instanceof Error ? err : new Error(String(err))
        this.emit('download-error', id, message)
      }
    })()
    return true
  }

  cancelDownload(id: string): boolean {
    this.subscribeOnce()
    if (!this.queue.get(id)) {
      return false
    }
    void this.queue.cancel(id, 'user').catch((err) => {
      logger.error('download-facade: cancelDownload failed', err)
    })
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
        if (NON_TERMINAL.has(t.status)) {
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

  updateMaxConcurrent(max: number): void {
    if (typeof max !== 'number' || max <= 0) {
      return
    }
    void this.queue.setMaxConcurrency(max).catch((err) => {
      logger.warn('download-facade: setMaxConcurrency failed', err)
    })
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
