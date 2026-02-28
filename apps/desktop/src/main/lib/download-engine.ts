import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { YTDlpEventEmitter } from 'yt-dlp-wrap-plus'
import type {
  DownloadHistoryItem,
  DownloadItem,
  DownloadOptions,
  DownloadProgress,
  PlaylistDownloadOptions,
  PlaylistDownloadResult,
  PlaylistInfo,
  VideoFormat,
  VideoInfo,
  VideoInfoCommandResult
} from '../../shared/types'
import { buildFilenameKey } from '../../shared/utils/download-file'
import { buildDownloadArgs, resolveVideoFormatSelector } from '../download-engine/args-builder'
import {
  findFormatByIdCandidates,
  parseSizeToBytes,
  resolveSelectedFormat
} from '../download-engine/format-utils'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { resolvePathWithHome } from '../utils/path-helpers'
import {
  appendJsRuntimeArgs,
  appendYouTubeSafeExtractorArgs,
  buildVideoInfoArgs,
  formatYtDlpCommand,
  resolveFfmpegLocation
} from './command-utils'
import { DownloadQueue } from './download-queue'
import {
  type DownloadSessionItem,
  loadDownloadSession,
  saveDownloadSession
} from './download-session-store'
import { ffmpegManager } from './ffmpeg-manager'
import { historyManager } from './history-manager'
import {
  ensureDirectoryExists,
  resolveAutoPlaylistDownloadPath,
  resolveAutoVideoDownloadPath,
  resolveHistoryDownloadPath,
  sanitizeTemplateValue
} from './path-resolver'
import { clampPercent, estimateProgressParts, isMuxedFormat } from './progress-utils'
import { applyShareWatermark } from './watermark-utils'
import { ytdlpManager } from './ytdlp-manager'

interface DownloadProcess {
  controller: AbortController
  process: YTDlpEventEmitter
}

class DownloadEngine extends EventEmitter {
  private readonly activeDownloads: Map<string, DownloadProcess> = new Map()
  private readonly queue: DownloadQueue
  private sessionPersistTimer: NodeJS.Timeout | null = null
  private sessionRestored = false
  private readonly prefetchTasks: Map<string, Promise<VideoInfo | null>> = new Map()
  private readonly prefetchedInfo: Map<string, VideoInfo> = new Map()
  private readonly cancelledDownloads: Set<string> = new Set()

  constructor() {
    super()
    const maxConcurrent = settingsManager.get('maxConcurrentDownloads')
    this.queue = new DownloadQueue(maxConcurrent)

    this.queue.on('start-download', async (item) => {
      await this.executeDownload(item.id, item.options)
    })

    this.queue.on('queue-updated', () => {
      this.scheduleSessionPersist()
    })
  }

  async getVideoInfo(url: string): Promise<VideoInfo> {
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()

    const args = buildVideoInfoArgs(url, settings)

    return new Promise((resolve, reject) => {
      const process = ytdlp.exec(args)
      let stdout = ''
      let stderr = ''

      process.ytDlpProcess?.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      process.ytDlpProcess?.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const info = JSON.parse(stdout)

            // Calculate estimated file size for formats missing filesize information
            // Using tbr (total bitrate in kbps) and duration (in seconds)
            // Formula: (tbr * 1000) / 8 * duration = size in bytes
            if (info.formats && Array.isArray(info.formats) && info.duration) {
              const duration = info.duration
              for (const format of info.formats) {
                if (
                  !(format.filesize || format.filesize_approx) &&
                  format.tbr &&
                  typeof format.tbr === 'number' &&
                  duration > 0
                ) {
                  // Calculate estimated size: tbr (kbps) * 1000 / 8 bits per byte * duration (seconds)
                  const estimatedSize = Math.round(((format.tbr * 1000) / 8) * duration)
                  format.filesize_approx = estimatedSize
                }
              }
            }

            scopedLoggers.download.info('Successfully retrieved video info for:', url)
            resolve(info)
          } catch (error) {
            scopedLoggers.download.error('Failed to parse video info for:', url, error)
            reject(new Error(`Failed to parse video info: ${error}`))
          }
        } else {
          scopedLoggers.download.error(
            'Failed to fetch video info for:',
            url,
            'Exit code:',
            code,
            'Error:',
            stderr
          )
          reject(new Error(stderr || 'Failed to fetch video info'))
        }
      })

      process.on('error', (error) => {
        scopedLoggers.download.error('yt-dlp process error for:', url, error)
        reject(error)
      })
    })
  }

  async getVideoInfoWithCommand(url: string): Promise<VideoInfoCommandResult> {
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()
    const args = buildVideoInfoArgs(url, settings)
    const ytDlpCommand = formatYtDlpCommand(args)

    return new Promise((resolve) => {
      let settled = false
      const resolveOnce = (payload: VideoInfoCommandResult) => {
        if (settled) {
          return
        }
        settled = true
        resolve(payload)
      }

      const process = ytdlp.exec(args)
      let stdout = ''
      let stderr = ''

      process.ytDlpProcess?.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      process.ytDlpProcess?.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const info = JSON.parse(stdout)

            // Calculate estimated file size for formats missing filesize information
            // Using tbr (total bitrate in kbps) and duration (in seconds)
            // Formula: (tbr * 1000) / 8 * duration = size in bytes
            if (info.formats && Array.isArray(info.formats) && info.duration) {
              const duration = info.duration
              for (const format of info.formats) {
                if (
                  !(format.filesize || format.filesize_approx) &&
                  format.tbr &&
                  typeof format.tbr === 'number' &&
                  duration > 0
                ) {
                  const estimatedSize = Math.round(((format.tbr * 1000) / 8) * duration)
                  format.filesize_approx = estimatedSize
                }
              }
            }

            scopedLoggers.download.info('Successfully retrieved video info for:', url)
            resolveOnce({ info, ytDlpCommand })
          } catch (error) {
            scopedLoggers.download.error('Failed to parse video info for:', url, error)
            resolveOnce({
              ytDlpCommand,
              error: `Failed to parse video info: ${error instanceof Error ? error.message : error}`
            })
          }
        } else {
          scopedLoggers.download.error(
            'Failed to fetch video info for:',
            url,
            'Exit code:',
            code,
            'Error:',
            stderr
          )
          resolveOnce({ ytDlpCommand, error: stderr || 'Failed to fetch video info' })
        }
      })

      process.on('error', (error) => {
        scopedLoggers.download.error('yt-dlp process error for:', url, error)
        resolveOnce({
          ytDlpCommand,
          error: error instanceof Error ? error.message : 'Failed to fetch video info'
        })
      })
    })
  }

  async getPlaylistInfo(url: string): Promise<PlaylistInfo> {
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()

    const args = ['-J', '--flat-playlist', '--no-warnings']

    // Add encoding support for proper handling of non-ASCII characters
    args.push('--encoding', 'utf-8')

    // Add proxy if configured
    if (settings.proxy) {
      args.push('--proxy', settings.proxy)
    }

    // Add browser cookies if configured (skip if 'none')
    if (settings.browserForCookies && settings.browserForCookies !== 'none') {
      args.push('--cookies-from-browser', settings.browserForCookies)
    }

    const cookiesPath = settings.cookiesPath?.trim()
    if (cookiesPath) {
      args.push('--cookies', cookiesPath)
    }

    // Add config file if configured
    const configPath = resolvePathWithHome(settings.configPath)
    if (configPath) {
      args.push('--config-location', configPath)
    } else {
      appendYouTubeSafeExtractorArgs(args, url)
    }

    appendJsRuntimeArgs(args)
    args.push(url)

    interface RawPlaylistEntry {
      id?: string
      title?: string
      url?: string
      webpage_url?: string
      original_url?: string
      ie_key?: string
    }

    const resolveEntryUrl = (entry: RawPlaylistEntry): string => {
      if (entry.url && typeof entry.url === 'string' && entry.url.startsWith('http')) {
        return entry.url
      }
      if (entry.webpage_url && typeof entry.webpage_url === 'string') {
        return entry.webpage_url
      }
      if (entry.original_url && typeof entry.original_url === 'string') {
        return entry.original_url
      }
      if (entry.url && typeof entry.url === 'string') {
        if (entry.ie_key && typeof entry.ie_key === 'string') {
          const extractor = entry.ie_key.toLowerCase()
          if (extractor.includes('youtube')) {
            return `https://www.youtube.com/watch?v=${entry.url}`
          }
          if (extractor.includes('youtubemusic')) {
            return `https://music.youtube.com/watch?v=${entry.url}`
          }
        }
        if (entry.url.startsWith('https://') || entry.url.startsWith('http://')) {
          return entry.url
        }
      }
      if (entry.id && typeof entry.id === 'string') {
        return entry.id
      }
      return ''
    }

    return new Promise((resolve, reject) => {
      const process = ytdlp.exec(args)
      let stdout = ''
      let stderr = ''

      process.ytDlpProcess?.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      process.ytDlpProcess?.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            const parsed = JSON.parse(stdout) as {
              id?: string
              title?: string
              entries?: RawPlaylistEntry[]
            }
            const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : []
            const entries = rawEntries
              .map((entry, index) => {
                const resolvedUrl = resolveEntryUrl(entry)
                return {
                  id: entry.id || `${index}`,
                  title: entry.title || `Entry ${index + 1}`,
                  url: resolvedUrl,
                  index: index + 1
                }
              })
              .filter((entry) => entry.url)

            scopedLoggers.download.info(
              'Successfully retrieved playlist info for:',
              url,
              'entries:',
              entries.length
            )
            resolve({
              id: parsed.id || url,
              title: parsed.title || 'Playlist',
              entries,
              entryCount: entries.length
            })
          } catch (error) {
            scopedLoggers.download.error('Failed to parse playlist info for:', url, error)
            reject(new Error(`Failed to parse playlist info: ${error}`))
          }
        } else {
          scopedLoggers.download.error(
            'Failed to fetch playlist info for:',
            url,
            'Exit code:',
            code,
            'Error:',
            stderr
          )
          reject(new Error(stderr || 'Failed to fetch playlist info'))
        }
      })

      process.on('error', (error) => {
        scopedLoggers.download.error('yt-dlp process error while fetching playlist info:', error)
        reject(error)
      })
    })
  }

  async startPlaylistDownload(options: PlaylistDownloadOptions): Promise<PlaylistDownloadResult> {
    const playlistInfo = await this.getPlaylistInfo(options.url)
    const downloadEntries: PlaylistDownloadResult['entries'] = []
    const groupId = `playlist_group_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

    // Calculate the range of entries to download
    const totalEntries = playlistInfo.entries.length
    if (totalEntries === 0) {
      scopedLoggers.download.warn('Playlist has no entries:', options.url)
      return {
        groupId,
        playlistId: playlistInfo.id,
        playlistTitle: playlistInfo.title,
        type: options.type,
        totalCount: 0,
        startIndex: 0,
        endIndex: 0,
        entries: []
      }
    }

    const requestedStart = Math.max((options.startIndex ?? 1) - 1, 0)
    const requestedEnd = options.endIndex
      ? Math.min(options.endIndex - 1, totalEntries - 1)
      : totalEntries - 1
    const rangeStart = Math.min(requestedStart, requestedEnd)
    const rangeEnd = Math.max(requestedStart, requestedEnd)
    const rawEntries = playlistInfo.entries.slice(rangeStart, rangeEnd + 1)
    const settings = settingsManager.getAll()
    const resolvedDownloadPath =
      options.customDownloadPath?.trim() ||
      resolveAutoPlaylistDownloadPath(settings.downloadPath, playlistInfo, options.url)
    ensureDirectoryExists(resolvedDownloadPath)

    const selectedEntries = rawEntries.filter((entry) => {
      if (!entry.url) {
        scopedLoggers.download.warn('Skipping playlist entry with missing URL:', entry)
        return false
      }
      return true
    })

    const selectionSize = selectedEntries.length

    scopedLoggers.download.info(
      `Starting playlist download: ${selectionSize} items from "${playlistInfo.title}"`
    )

    const normalizedTitles = new Set<string>()
    let hasDuplicateTitles = false
    for (const entry of selectedEntries) {
      const key = sanitizeTemplateValue(entry.title || '').toLowerCase()
      if (normalizedTitles.has(key)) {
        hasDuplicateTitles = true
        break
      }
      normalizedTitles.add(key)
    }
    const indexWidth = hasDuplicateTitles
      ? String(Math.max(...selectedEntries.map((entry) => entry.index))).length
      : 0

    // Create download items for each video in the playlist
    for (const entry of selectedEntries) {
      const downloadId = `${groupId}_${Math.random().toString(36).substring(2, 10)}`
      const customFilenameTemplate = hasDuplicateTitles
        ? `${String(entry.index).padStart(indexWidth, '0')} - %(title)s via VidBee.%(ext)s`
        : undefined

      const downloadOptions: DownloadOptions = {
        url: entry.url,
        type: options.type,
        format: options.format,
        audioFormat: options.type === 'audio' ? options.format : undefined,
        customDownloadPath: resolvedDownloadPath,
        customFilenameTemplate
      }

      const createdAt = Date.now()
      downloadEntries.push({
        downloadId,
        entryId: entry.id,
        title: entry.title,
        url: entry.url,
        index: entry.index
      })

      // Add to queue
      const queueItem: DownloadItem = {
        id: downloadId,
        url: entry.url,
        title: entry.title,
        type: options.type,
        status: 'pending',
        progress: { percent: 0 },
        createdAt,
        playlistId: groupId,
        playlistTitle: playlistInfo.title,
        playlistIndex: entry.index,
        playlistSize: selectionSize
      }
      this.queue.add(downloadId, downloadOptions, queueItem)
      this.emit('download-queued', { ...queueItem })

      this.upsertHistoryEntry(downloadId, downloadOptions, {
        title: entry.title,
        status: 'pending',
        downloadedAt: createdAt,
        downloadPath: resolvedDownloadPath,
        playlistId: groupId,
        playlistTitle: playlistInfo.title,
        playlistIndex: entry.index,
        playlistSize: selectionSize
      })
    }

    return {
      groupId,
      playlistId: playlistInfo.id,
      playlistTitle: playlistInfo.title,
      type: options.type,
      totalCount: selectionSize,
      startIndex: selectedEntries[0]?.index ?? rangeStart + 1,
      endIndex: selectedEntries.at(-1)?.index ?? rangeEnd + 1,
      entries: downloadEntries
    }
  }

  private normalizeDownloadValue(value?: string): string {
    return value?.trim() ?? ''
  }

  private buildDownloadSignature(options: DownloadOptions): string {
    const normalizeList = (values?: string[]): string =>
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .sort()
        .join(',')

    return [
      this.normalizeDownloadValue(options.url),
      options.type,
      this.normalizeDownloadValue(options.format),
      this.normalizeDownloadValue(options.audioFormat),
      normalizeList(options.audioFormatIds),
      this.normalizeDownloadValue(options.startTime),
      this.normalizeDownloadValue(options.endTime),
      this.normalizeDownloadValue(options.customDownloadPath),
      this.normalizeDownloadValue(options.customFilenameTemplate),
      this.normalizeDownloadValue(options.origin ?? 'manual'),
      this.normalizeDownloadValue(options.subscriptionId)
    ].join('|')
  }

  private hasDuplicateDownload(options: DownloadOptions): boolean {
    const signature = this.buildDownloadSignature(options)
    const entries = [...this.queue.getActiveEntries(), ...this.queue.getQueuedEntries()]
    return entries.some((entry) => this.buildDownloadSignature(entry.options) === signature)
  }

  startDownload(id: string, options: DownloadOptions): boolean {
    if (this.activeDownloads.has(id) || this.queue.getItemDetails(id)) {
      scopedLoggers.engine.warn(`Download ${id} is already queued`)
      return false
    }

    if (this.hasDuplicateDownload(options)) {
      scopedLoggers.engine.warn('Duplicate download ignored:', {
        id,
        url: options.url,
        type: options.type
      })
      return false
    }

    const createdAt = Date.now()
    const settings = settingsManager.getAll()
    const targetDownloadPath = options.customDownloadPath?.trim() || settings.downloadPath
    const origin = options.origin ?? 'manual'
    const historyDownloadPath = resolveHistoryDownloadPath(
      targetDownloadPath,
      options.customFilenameTemplate
    )
    ensureDirectoryExists(targetDownloadPath)
    ensureDirectoryExists(historyDownloadPath)

    const item: DownloadItem = {
      id,
      url: options.url,
      title: 'Downloading...',
      type: options.type,
      status: 'pending' as const,
      progress: { percent: 0 },
      createdAt,
      tags: options.tags,
      origin,
      subscriptionId: options.subscriptionId
    }

    this.queue.add(id, options, item)

    this.upsertHistoryEntry(id, options, {
      title: item.title,
      status: 'pending',
      downloadedAt: createdAt,
      downloadPath: historyDownloadPath,
      tags: options.tags,
      origin,
      subscriptionId: options.subscriptionId
    })

    this.emit('download-queued', { ...item })
    void this.prefetchVideoInfo(id, options)
    return true
  }

  private async prefetchVideoInfo(id: string, options: DownloadOptions): Promise<void> {
    const url = options.url?.trim()
    if (!url) {
      return
    }
    if (this.prefetchTasks.has(id) || this.prefetchedInfo.has(id)) {
      return
    }

    const task = (async () => {
      try {
        const info = await this.getVideoInfo(url)
        this.prefetchedInfo.set(id, info)
        this.updateDownloadInfo(id, {
          title: info.title,
          thumbnail: info.thumbnail,
          duration: info.duration,
          description: info.description,
          uploader: info.uploader,
          viewCount: info.view_count
        })
        return info
      } catch (error) {
        scopedLoggers.download.warn('Failed to prefetch video info for ID:', id, error)
        return null
      }
    })()

    this.prefetchTasks.set(id, task)
    try {
      await task
    } finally {
      this.prefetchTasks.delete(id)
    }
  }

  private async executeDownload(id: string, options: DownloadOptions): Promise<void> {
    scopedLoggers.download.info('Starting download execution for ID:', id, 'URL:', options.url)
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()
    const defaultDownloadPath = settings.downloadPath
    let resolvedDownloadPath = options.customDownloadPath?.trim() || defaultDownloadPath

    // Set environment variables for proper encoding on Windows
    if (process.platform === 'win32') {
      process.env.PYTHONIOENCODING = 'utf-8'
      process.env.LC_ALL = 'C.UTF-8'
    }

    let availableFormats: VideoFormat[] = []
    let selectedFormat: VideoFormat | undefined
    let actualFormat: string | null = null
    let videoInfo: VideoInfo | undefined
    let lastKnownOutputPath: string | undefined
    const outputPathCandidates: string[] = []
    let totalParts = estimateProgressParts(options)
    let completedParts = 0
    let lastPercent = 0
    let ytDlpLog = ''
    let logFlushTimer: NodeJS.Timeout | null = null
    let lastFlushedLog = ''

    const normalizeLogChunk = (chunk: string): string =>
      chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    const flushLogUpdate = (): void => {
      if (logFlushTimer) {
        clearTimeout(logFlushTimer)
        logFlushTimer = null
      }
      if (ytDlpLog === lastFlushedLog) {
        return
      }
      lastFlushedLog = ytDlpLog
      this.updateDownloadInfo(id, { ytDlpLog })
      this.emit('download-log', id, ytDlpLog)
    }

    const scheduleLogUpdate = (): void => {
      if (logFlushTimer) {
        return
      }
      logFlushTimer = setTimeout(() => {
        flushLogUpdate()
      }, 500)
    }

    const appendLogChunk = (chunk: string | Buffer): void => {
      if (!chunk) {
        return
      }
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      if (!text) {
        return
      }
      ytDlpLog += normalizeLogChunk(text)
      scheduleLogUpdate()
    }

    const applyVideoInfo = (info: VideoInfo) => {
      availableFormats = Array.isArray(info.formats) ? info.formats : []
      selectedFormat = resolveSelectedFormat(availableFormats, options, settings)

      if (selectedFormat) {
        actualFormat = selectedFormat.ext || actualFormat
      }

      if (
        options.type === 'video' &&
        (!options.audioFormatIds || options.audioFormatIds.length === 0) &&
        isMuxedFormat(selectedFormat)
      ) {
        totalParts = 1
      }

      this.updateDownloadInfo(id, {
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        description: info.description,
        uploader: info.uploader,
        viewCount: info.view_count,
        // Store only essential download info
        selectedFormat
      })

      this.upsertHistoryEntry(id, options, {
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        description: info.description,
        uploader: info.uploader,
        viewCount: info.view_count,
        // Store only essential download info
        selectedFormat
      })
    }

    videoInfo = this.prefetchedInfo.get(id)
    if (!videoInfo) {
      const prefetchTask = this.prefetchTasks.get(id)
      if (prefetchTask) {
        try {
          await prefetchTask
        } catch {
          // Ignore prefetch failures, download will attempt again below.
        }
        videoInfo = this.prefetchedInfo.get(id)
      }
    }

    if (videoInfo) {
      this.prefetchedInfo.delete(id)
      applyVideoInfo(videoInfo)
    } else {
      // First, get detailed video info to capture basic metadata and formats
      try {
        const info = await this.getVideoInfo(options.url)
        videoInfo = info
        applyVideoInfo(info)
      } catch (error) {
        scopedLoggers.download.warn('Failed to get detailed video info for ID:', id, error)
      }
    }

    if (!options.customDownloadPath?.trim()) {
      resolvedDownloadPath = resolveAutoVideoDownloadPath(defaultDownloadPath, videoInfo)
      options.customDownloadPath = resolvedDownloadPath
    }

    const historyDownloadPath = resolveHistoryDownloadPath(
      resolvedDownloadPath,
      options.customFilenameTemplate,
      videoInfo
    )
    ensureDirectoryExists(historyDownloadPath)
    this.upsertHistoryEntry(id, options, { downloadPath: historyDownloadPath })

    const applySelectedFormat = (formatId: string | undefined): boolean => {
      if (!formatId) {
        return false
      }

      const candidate = findFormatByIdCandidates(availableFormats, formatId)
      if (!candidate) {
        return false
      }

      if (selectedFormat?.format_id === candidate.format_id) {
        return true
      }

      selectedFormat = candidate
      actualFormat = candidate.ext || actualFormat

      this.updateDownloadInfo(id, {
        selectedFormat: candidate
      })

      return true
    }

    const args = buildDownloadArgs(
      options,
      resolvedDownloadPath,
      settings,
      ytdlpManager.getJsRuntimeArgs()
    )

    const captureOutputPath = (rawPath: string | undefined): void => {
      if (!rawPath) {
        return
      }
      const trimmed = rawPath.trim().replace(/^"|"$/g, '')
      if (!trimmed) {
        return
      }
      const resolvedPath = path.isAbsolute(trimmed)
        ? trimmed
        : path.join(resolvedDownloadPath, trimmed)
      lastKnownOutputPath = resolvedPath
      if (!outputPathCandidates.includes(resolvedPath)) {
        outputPathCandidates.push(resolvedPath)
      }
    }

    const extractOutputPathFromLog = (message: string): void => {
      const destinationMatch = message.match(/Destination:\s*(.+)$/)
      if (destinationMatch) {
        captureOutputPath(destinationMatch[1])
        return
      }

      const mergingMatch = message.match(/Merging formats into\s+"(.+?)"/)
      if (mergingMatch) {
        captureOutputPath(mergingMatch[1])
        return
      }

      const movingMatch = message.match(/Moving file to\s+"(.+?)"/)
      if (movingMatch) {
        captureOutputPath(movingMatch[1])
      }
    }

    // Check if format selector contains '+' which means video and audio will be merged
    const formatSelector =
      options.type === 'video' ? resolveVideoFormatSelector(options) : undefined
    const willMerge = formatSelector?.includes('+') ?? false

    const urlArg = args.pop()
    if (!urlArg) {
      const missingUrlError = new Error('Download arguments missing URL.')
      scopedLoggers.download.error('Missing URL argument for download ID:', id)
      this.updateDownloadInfo(id, {
        status: 'error',
        completedAt: Date.now(),
        error: missingUrlError.message
      })
      this.queue.downloadCompleted(id)
      this.emit('download-error', id, missingUrlError)
      this.addToHistory(id, options, 'error', missingUrlError.message)
      return
    }

    let ffmpegPath: string
    try {
      ffmpegPath = ffmpegManager.getPath()
    } catch (error) {
      const ffmpegError = error instanceof Error ? error : new Error(String(error))
      scopedLoggers.download.error('Failed to resolve ffmpeg for download ID:', id, ffmpegError)
      this.updateDownloadInfo(id, {
        status: 'error',
        completedAt: Date.now(),
        error: ffmpegError.message
      })
      this.queue.downloadCompleted(id)
      this.emit('download-error', id, ffmpegError)
      this.addToHistory(id, options, 'error', ffmpegError.message)
      return
    }

    const ffmpegLocation = resolveFfmpegLocation(ffmpegPath)
    args.push('--ffmpeg-location', ffmpegLocation)
    args.push(urlArg)

    const ytDlpCommand = formatYtDlpCommand(args)
    this.updateDownloadInfo(id, { ytDlpCommand })
    scopedLoggers.download.info('yt-dlp command:', ytDlpCommand)

    const controller = new AbortController()
    const ytdlpProcess = ytdlp.exec(args, {
      signal: controller.signal
    })

    this.activeDownloads.set(id, { controller, process: ytdlpProcess })

    ytdlpProcess.ytDlpProcess?.stdout?.on('data', (data: Buffer) => {
      appendLogChunk(data)
    })

    ytdlpProcess.ytDlpProcess?.stderr?.on('data', (data: Buffer) => {
      appendLogChunk(data)
    })

    this.queue.updateItemInfo(id, { status: 'downloading', startedAt: Date.now() })
    this.scheduleSessionPersist()
    this.emit('download-started', id)

    this.upsertHistoryEntry(id, options, {
      status: 'downloading'
    })

    let latestKnownSizeBytes: number | undefined

    // Handle progress
    ytdlpProcess.on(
      'progress',
      (progress: {
        percent?: number
        currentSpeed?: string
        eta?: string
        downloaded?: string
        total?: string
      }) => {
        const totalBytes = parseSizeToBytes(progress.total)
        if (totalBytes !== undefined) {
          latestKnownSizeBytes = totalBytes
        }

        const downloadedBytes = parseSizeToBytes(progress.downloaded)
        if (downloadedBytes !== undefined) {
          latestKnownSizeBytes =
            latestKnownSizeBytes !== undefined
              ? Math.max(latestKnownSizeBytes, downloadedBytes)
              : downloadedBytes
        }

        const normalizedPercent = clampPercent(progress.percent)
        if (
          totalParts > 1 &&
          lastPercent >= 90 &&
          normalizedPercent <= 10 &&
          completedParts < totalParts - 1
        ) {
          completedParts += 1
        }
        lastPercent = normalizedPercent
        const mergedPercent =
          totalParts > 1
            ? ((completedParts + normalizedPercent / 100) / totalParts) * 100
            : normalizedPercent

        const downloadProgress: DownloadProgress = {
          percent: Math.min(100, mergedPercent),
          currentSpeed: progress.currentSpeed || '',
          eta: progress.eta || '',
          downloaded: progress.downloaded || '',
          total: progress.total || ''
        }
        this.queue.updateItemInfo(id, {
          progress: downloadProgress,
          speed: downloadProgress.currentSpeed || ''
        })
        this.scheduleSessionPersist()
        this.emit('download-progress', id, downloadProgress)
      }
    )

    // Handle yt-dlp events to capture format info
    ytdlpProcess.on('ytDlpEvent', (eventType: string, eventData: string) => {
      if (
        eventType === 'postprocess' ||
        eventData.toLowerCase().includes('merging formats') ||
        eventData.toLowerCase().includes('post-process')
      ) {
        const snapshot = this.queue.getItemDetails(id)
        if (snapshot?.item.status !== 'processing') {
          this.updateDownloadInfo(id, { status: 'processing' })
        }
      }

      // Look for format selection messages
      if (eventType === 'info' && eventData.includes('format')) {
        // Extract format info from yt-dlp output
        const formatMatch = eventData.match(/\[info\]\s*([^\s:]+):\s*(.+)/)
        if (formatMatch) {
          const formatId = formatMatch[1]
          const formatInfo = formatMatch[2]

          applySelectedFormat(formatId)

          // Extract format details with better regex patterns
          const extMatch = formatInfo.match(/(\w+)(?:\s|$)/)
          if (extMatch && !actualFormat) {
            actualFormat = extMatch[1]
          }
        }
      }

      // Also look for download progress messages that might contain format info
      if (eventType === 'download' && eventData.includes('format')) {
        const formatMatch = eventData.match(/format\s*([0-9A-Za-z+-]+)/)
        if (formatMatch) {
          applySelectedFormat(formatMatch[1])
        }
      }

      if (eventType === 'download' || eventType === 'info') {
        extractOutputPathFromLog(eventData)
      }
    })

    // Handle completion
    ytdlpProcess.on('close', async (code: number | null) => {
      flushLogUpdate()
      const wasCancelled = controller.signal.aborted || this.cancelledDownloads.has(id)
      this.activeDownloads.delete(id)
      this.queue.downloadCompleted(id)

      if (wasCancelled) {
        this.cancelledDownloads.delete(id)
        return
      }

      if (code === 0) {
        // Generate file path using downloadPath + title + ext
        const title = videoInfo?.title || 'Unknown'
        const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)

        // Determine file extension based on download type and format
        // yt-dlp automatically chooses the best merge format (mkv/webm/mp4)
        // based on codec compatibility, so we should use actualFormat when available
        let extension: string
        if (options.type === 'audio') {
          // Use format extension from yt-dlp output (actualFormat contains the extension)
          extension = actualFormat || 'm4a'
        } else if (willMerge) {
          // For merged files, yt-dlp auto-selects format (mkv/webm/mp4)
          // Use actualFormat if available, otherwise default to mkv (most compatible)
          extension = actualFormat || 'mkv'
        } else {
          extension = actualFormat || 'mp4'
        }

        const fallbackFileName = `${sanitizedTitle}.${extension}`
        const fallbackOutputPath = path.join(resolvedDownloadPath, fallbackFileName)

        scopedLoggers.download.info(
          'Resolved output paths for ID:',
          id,
          'Primary:',
          lastKnownOutputPath ?? fallbackOutputPath,
          'Fallback:',
          fallbackOutputPath,
          'Will merge:',
          willMerge
        )

        let fileSize: number | undefined
        let actualFilePath = lastKnownOutputPath ?? fallbackOutputPath
        const candidatePaths: string[] = [...outputPathCandidates].reverse()
        const pushCandidatePath = (candidate: string | undefined) => {
          if (!candidate) {
            return
          }
          if (!candidatePaths.includes(candidate)) {
            candidatePaths.push(candidate)
          }
        }
        pushCandidatePath(lastKnownOutputPath)
        pushCandidatePath(fallbackOutputPath)

        try {
          const fs = await import('node:fs/promises')
          let located = false
          for (const candidate of candidatePaths) {
            if (!candidate) {
              continue
            }
            try {
              const stats = await fs.stat(candidate)
              fileSize = stats.size
              actualFilePath = candidate
              located = true
              break
            } catch {}
          }

          if (!located) {
            const files = await fs.readdir(resolvedDownloadPath)
            const rawTitle = videoInfo?.title ?? this.queue.getItemDetails(id)?.item.title ?? ''
            const titleKey = buildFilenameKey(rawTitle)
            const normalizedExt = extension.toLowerCase()

            const matchesTitle = (fileName: string): boolean => {
              if (!titleKey) {
                return false
              }
              const fileKey = buildFilenameKey(fileName)
              if (!fileKey) {
                return false
              }
              return fileKey.includes(titleKey) || titleKey.includes(fileKey)
            }

            const candidates = files
              .map((file) => {
                const ext = file.split('.').pop()?.toLowerCase()
                return { file, ext }
              })
              .filter((entry) => entry.ext)

            const withExtension = candidates.filter((entry) => entry.ext === normalizedExt)
            const titleMatches = withExtension.filter((entry) => matchesTitle(entry.file))
            const vidbeeMatches = withExtension.filter((entry) =>
              entry.file.toLowerCase().includes('vidbee')
            )
            const fallbackMatches = withExtension.length > 0 ? withExtension : candidates
            const pickFrom =
              titleMatches.length > 0
                ? titleMatches
                : vidbeeMatches.length > 0
                  ? vidbeeMatches
                  : fallbackMatches

            if (pickFrom.length > 0) {
              const fileStats = await Promise.all(
                pickFrom.map(async (entry) => {
                  const filePath = path.join(resolvedDownloadPath, entry.file)
                  const stats = await fs.stat(filePath)
                  if (!stats.isFile()) {
                    return null
                  }
                  return { path: filePath, mtime: stats.mtime, size: stats.size }
                })
              )
              const existingStats = fileStats.filter(
                (entry): entry is { path: string; mtime: Date; size: number } => Boolean(entry)
              )
              if (existingStats.length > 0) {
                const mostRecent = existingStats.sort(
                  (a, b) => b.mtime.getTime() - a.mtime.getTime()
                )[0]
                actualFilePath = mostRecent.path
                fileSize = mostRecent.size
                located = true
                scopedLoggers.download.info('Found actual file:', actualFilePath, 'Size:', fileSize)
              }
            }
          }

          if (!fileSize && latestKnownSizeBytes !== undefined) {
            fileSize = latestKnownSizeBytes
            if (!located) {
              scopedLoggers.download.warn('File not found, using estimated size:', fileSize)
            }
          } else if (!fileSize) {
            scopedLoggers.download.warn('Failed to find file for ID:', id)
          }
        } catch (error) {
          scopedLoggers.download.warn('Failed to resolve file details for ID:', id, error)
          if (latestKnownSizeBytes !== undefined) {
            fileSize = latestKnownSizeBytes
          }
        }

        if (fileSize === undefined && latestKnownSizeBytes !== undefined) {
          fileSize = latestKnownSizeBytes
        }

        let finalFilePath = actualFilePath
        let finalFileSize = fileSize

        if (settings.shareWatermark && options.type === 'video') {
          if (fs.existsSync(actualFilePath)) {
            this.updateDownloadInfo(id, { status: 'processing' })
            const snapshot = this.queue.getItemDetails(id)
            const watermarkTitle = videoInfo?.title ?? snapshot?.item.title
            const watermarkAuthor = videoInfo?.uploader ?? snapshot?.item.uploader
            try {
              const watermarkResult = await applyShareWatermark({
                inputPath: actualFilePath,
                ffmpegPath,
                title: watermarkTitle,
                author: watermarkAuthor
              })
              if (watermarkResult) {
                finalFilePath = watermarkResult.outputPath
                finalFileSize = watermarkResult.fileSize
              }
            } catch (error) {
              scopedLoggers.download.warn('Failed to apply share watermark for ID:', id, error)
            }
          } else {
            scopedLoggers.download.warn(
              'Watermark skipped because file was not found:',
              actualFilePath
            )
          }
        }

        const savedFileName = path.basename(finalFilePath)

        this.updateDownloadInfo(id, {
          status: 'completed',
          completedAt: Date.now(),
          fileSize: finalFileSize,
          savedFileName
        })
        scopedLoggers.download.info('Download completed successfully for ID:', id)
        this.emit('download-completed', id)
        this.addToHistory(id, options, 'completed', undefined)
      } else {
        scopedLoggers.download.error(
          'Download failed with exit code for ID:',
          id,
          'Exit code:',
          code
        )
        this.emit('download-error', id, new Error(`Download exited with code ${code}`))
        this.addToHistory(id, options, 'error', `Download exited with code ${code}`)
      }
    })

    // Handle errors
    ytdlpProcess.on('error', (error: Error) => {
      flushLogUpdate()
      const wasCancelled = controller.signal.aborted || this.cancelledDownloads.has(id)
      scopedLoggers.download.error('Download process error for ID:', id, error)
      this.activeDownloads.delete(id)
      this.queue.downloadCompleted(id)
      if (wasCancelled) {
        this.cancelledDownloads.delete(id)
        return
      }
      this.emit('download-error', id, error)
      this.addToHistory(id, options, 'error', error.message)
    })
  }

  cancelDownload(id: string): boolean {
    scopedLoggers.download.info('Cancelling download for ID:', id)

    const download = this.activeDownloads.get(id)
    if (download) {
      this.cancelledDownloads.add(id)
      download.controller.abort()
      const removedFromQueue = this.queue.remove(id)
      this.activeDownloads.delete(id)
      scopedLoggers.download.info('Download cancelled successfully for ID:', id)
      this.emit('download-cancelled', id)
      historyManager.removeHistoryItem(id)
      this.prefetchTasks.delete(id)
      this.prefetchedInfo.delete(id)
      return removedFromQueue
    }
    const removed = this.queue.remove(id)
    if (removed) {
      this.emit('download-cancelled', id)
      historyManager.removeHistoryItem(id)
      this.prefetchTasks.delete(id)
      this.prefetchedInfo.delete(id)
    }
    return removed
  }

  updateMaxConcurrent(max: number): void {
    this.queue.setMaxConcurrent(max)
  }

  getQueueStatus() {
    return this.queue.getQueueStatus()
  }

  getActiveDownloads(): DownloadItem[] {
    const items = new Map<string, DownloadItem>()
    for (const item of this.queue.getActiveItems()) {
      items.set(item.id, item)
    }
    for (const item of this.queue.getQueuedItems()) {
      items.set(item.id, item)
    }
    return Array.from(items.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  restoreActiveDownloads(): void {
    if (this.sessionRestored) {
      return
    }
    this.sessionRestored = true

    const sessionItems = loadDownloadSession()
    if (sessionItems.length === 0) {
      return
    }

    for (const entry of sessionItems) {
      if (!(entry?.id && entry.options?.url && entry.options.type)) {
        continue
      }
      if (this.queue.getItemDetails(entry.id)) {
        continue
      }

      const historyItem = historyManager.getHistoryById(entry.id)
      if (historyItem && ['completed', 'error', 'cancelled'].includes(historyItem.status)) {
        continue
      }

      const createdAt = entry.item?.createdAt ?? Date.now()
      const restoredItem: DownloadItem = {
        ...entry.item,
        id: entry.id,
        url: entry.options.url,
        type: entry.options.type,
        status: 'pending',
        createdAt,
        completedAt: undefined
      }

      this.queue.add(entry.id, entry.options, restoredItem)

      this.upsertHistoryEntry(entry.id, entry.options, {
        title: restoredItem.title || historyItem?.title || `Download ${entry.id}`,
        status: 'pending',
        downloadedAt: historyItem?.downloadedAt ?? createdAt
      })
    }

    this.scheduleSessionPersist()
  }

  flushDownloadSession(): void {
    if (this.sessionPersistTimer) {
      clearTimeout(this.sessionPersistTimer)
      this.sessionPersistTimer = null
    }
    this.persistSession()
  }

  updateDownloadInfo(id: string, updates: Partial<DownloadItem>): void {
    this.queue.updateItemInfo(id, updates)

    const snapshot = this.queue.getItemDetails(id)
    if (!snapshot) {
      return
    }

    const historyUpdates: Partial<DownloadHistoryItem> = {}

    if (updates.title !== undefined) {
      historyUpdates.title = updates.title
    }
    if (updates.thumbnail !== undefined) {
      historyUpdates.thumbnail = updates.thumbnail
    }
    if (updates.duration !== undefined) {
      historyUpdates.duration = updates.duration
    }
    if (updates.fileSize !== undefined) {
      historyUpdates.fileSize = updates.fileSize
    }
    if (updates.description !== undefined) {
      historyUpdates.description = updates.description
    }
    if (updates.channel !== undefined) {
      historyUpdates.channel = updates.channel
    }
    if (updates.uploader !== undefined) {
      historyUpdates.uploader = updates.uploader
    }
    if (updates.viewCount !== undefined) {
      historyUpdates.viewCount = updates.viewCount
    }
    if (updates.tags !== undefined) {
      historyUpdates.tags = updates.tags
    }
    if (updates.playlistId !== undefined) {
      historyUpdates.playlistId = updates.playlistId
    }
    if (updates.playlistTitle !== undefined) {
      historyUpdates.playlistTitle = updates.playlistTitle
    }
    if (updates.playlistIndex !== undefined) {
      historyUpdates.playlistIndex = updates.playlistIndex
    }
    if (updates.playlistSize !== undefined) {
      historyUpdates.playlistSize = updates.playlistSize
    }
    if (updates.selectedFormat !== undefined) {
      historyUpdates.selectedFormat = updates.selectedFormat
    }
    if (updates.status !== undefined) {
      historyUpdates.status = updates.status
    }
    if (updates.completedAt !== undefined) {
      historyUpdates.completedAt = updates.completedAt
    }
    if (updates.error !== undefined) {
      historyUpdates.error = updates.error
    }
    if (updates.ytDlpCommand !== undefined) {
      historyUpdates.ytDlpCommand = updates.ytDlpCommand
    }
    if (updates.ytDlpLog !== undefined) {
      historyUpdates.ytDlpLog = updates.ytDlpLog
    }
    if (updates.savedFileName !== undefined) {
      historyUpdates.savedFileName = updates.savedFileName
    }

    if (Object.keys(historyUpdates).length > 0) {
      this.upsertHistoryEntry(id, snapshot.options, historyUpdates)
    }

    if (Object.keys(updates).length > 0) {
      this.emit('download-updated', id, { ...updates })
    }

    this.scheduleSessionPersist()
  }

  private scheduleSessionPersist(): void {
    if (this.sessionPersistTimer) {
      return
    }
    this.sessionPersistTimer = setTimeout(() => {
      this.sessionPersistTimer = null
      this.persistSession()
    }, 1000)
  }

  private persistSession(): void {
    const entries: DownloadSessionItem[] = []
    const activeEntries = this.queue.getActiveEntries()
    const queuedEntries = this.queue.getQueuedEntries()

    for (const entry of [...activeEntries, ...queuedEntries]) {
      if (!entry?.item?.id) {
        continue
      }
      entries.push({
        id: entry.item.id,
        options: entry.options,
        item: entry.item
      })
    }

    saveDownloadSession(entries)
  }

  private addToHistory(
    id: string,
    options: DownloadOptions,
    status: DownloadHistoryItem['status'],
    error?: string
  ): void {
    // Get the download item from the queue to get additional info
    const completedDownload = this.queue.getCompletedDownload(id)
    // scopedLoggers.download.info('Completed download:', completedDownload)
    const completedAt = Date.now()

    this.upsertHistoryEntry(id, options, {
      title: completedDownload?.item.title || `Download ${id}`,
      thumbnail: completedDownload?.item.thumbnail,
      status,
      completedAt,
      error,
      duration: completedDownload?.item.duration,
      fileSize: completedDownload?.item.fileSize,
      description: completedDownload?.item.description,
      channel: completedDownload?.item.channel,
      uploader: completedDownload?.item.uploader,
      viewCount: completedDownload?.item.viewCount,
      tags: completedDownload?.item.tags,
      origin: completedDownload?.item.origin,
      subscriptionId: completedDownload?.item.subscriptionId,
      playlistId: completedDownload?.item.playlistId,
      playlistTitle: completedDownload?.item.playlistTitle,
      playlistIndex: completedDownload?.item.playlistIndex,
      playlistSize: completedDownload?.item.playlistSize
    })
  }

  private upsertHistoryEntry(
    id: string,
    options: DownloadOptions,
    updates: Partial<DownloadHistoryItem>
  ): void {
    const existing = historyManager.getHistoryById(id)
    const resolvedDownloadPath =
      updates.downloadPath ?? existing?.downloadPath ?? options.customDownloadPath
    const base: DownloadHistoryItem = existing ?? {
      id,
      url: options.url,
      title: updates.title || `Download ${id}`,
      thumbnail: updates.thumbnail,
      type: options.type,
      status: updates.status || 'pending',
      downloadPath: resolvedDownloadPath,
      savedFileName: updates.savedFileName,
      fileSize: updates.fileSize,
      duration: updates.duration,
      downloadedAt: updates.downloadedAt ?? Date.now(),
      completedAt: updates.completedAt,
      error: updates.error,
      ytDlpCommand: updates.ytDlpCommand,
      ytDlpLog: updates.ytDlpLog,
      description: updates.description,
      channel: updates.channel,
      uploader: updates.uploader,
      viewCount: updates.viewCount,
      tags: updates.tags ?? options.tags,
      origin: updates.origin ?? options.origin,
      subscriptionId: updates.subscriptionId ?? options.subscriptionId,
      // Download-specific format info
      selectedFormat: updates.selectedFormat,
      playlistId: updates.playlistId,
      playlistTitle: updates.playlistTitle,
      playlistIndex: updates.playlistIndex,
      playlistSize: updates.playlistSize
    }

    const merged: DownloadHistoryItem = {
      ...base,
      ...updates,
      id,
      url: updates.url ?? base.url,
      type: updates.type ?? base.type,
      title: updates.title ?? base.title,
      status: updates.status ?? base.status,
      downloadedAt: updates.downloadedAt ?? base.downloadedAt,
      downloadPath: resolvedDownloadPath ?? base.downloadPath,
      tags: updates.tags ?? base.tags,
      origin: updates.origin ?? base.origin,
      subscriptionId: updates.subscriptionId ?? base.subscriptionId
    }

    historyManager.addHistoryItem(merged)
  }
}

export const downloadEngine = new DownloadEngine()
