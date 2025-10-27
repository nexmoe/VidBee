import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { YTDlpEventEmitter } from 'yt-dlp-wrap-plus'
import type {
  DownloadHistoryItem,
  DownloadItem,
  DownloadOptions,
  DownloadProgress,
  PlaylistDownloadOptions,
  PlaylistInfo,
  VideoFormat,
  VideoInfo
} from '../../shared/types'
import { buildDownloadArgs } from '../download-engine/args-builder'
import {
  findFormatByIdCandidates,
  parseSizeToBytes,
  resolveSelectedFormat
} from '../download-engine/format-utils'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { DownloadQueue } from './download-queue'
import { historyManager } from './history-manager'
import { ytdlpManager } from './ytdlp-manager'

interface DownloadProcess {
  controller: AbortController
  process: YTDlpEventEmitter
}

class DownloadEngine extends EventEmitter {
  private activeDownloads: Map<string, DownloadProcess> = new Map()
  private queue: DownloadQueue

  constructor() {
    super()
    const maxConcurrent = settingsManager.get('maxConcurrentDownloads')
    this.queue = new DownloadQueue(maxConcurrent)

    this.queue.on('start-download', async (item) => {
      await this.executeDownload(item.id, item.options)
    })
  }

  async getVideoInfo(url: string): Promise<VideoInfo> {
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()

    const args = ['-j', '--no-playlist', '--no-warnings']

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
    if (settings.configPath) {
      args.push('--config-location', `"${settings.configPath}"`)
    }

    args.push(url)

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

  async getPlaylistInfo(url: string): Promise<PlaylistInfo> {
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()

    const args = ['-j', '--flat-playlist', '--no-warnings']

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

    args.push(url)

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
            const lines = stdout.trim().split('\n')
            const entries = lines.map((line) => JSON.parse(line))
            const playlistEntry = entries[0]

            resolve({
              id: playlistEntry.id || '',
              title: playlistEntry.title || 'Playlist',
              entries: entries.map((entry) => ({
                id: entry.id || '',
                title: entry.title || 'Unknown',
                url: entry.url || entry.webpage_url || ''
              })),
              entryCount: entries.length
            })
          } catch (error) {
            reject(new Error(`Failed to parse playlist info: ${error}`))
          }
        } else {
          reject(new Error(stderr || 'Failed to fetch playlist info'))
        }
      })

      process.on('error', (error) => {
        reject(error)
      })
    })
  }

  async startPlaylistDownload(options: PlaylistDownloadOptions): Promise<string[]> {
    const playlistInfo = await this.getPlaylistInfo(options.url)
    const downloadIds: string[] = []

    // Calculate the range of entries to download
    const startIndex = (options.startIndex || 1) - 1 // Convert to 0-based index
    const endIndex = options.endIndex ? options.endIndex - 1 : playlistInfo.entries.length - 1
    const entriesToDownload = playlistInfo.entries.slice(startIndex, endIndex + 1)

    scopedLoggers.download.info(
      `Starting playlist download: ${entriesToDownload.length} videos from "${playlistInfo.title}"`
    )

    // Create download items for each video in the playlist
    for (const entry of entriesToDownload) {
      const downloadId = `playlist_${Date.now()}_${Math.random().toString(36).substring(7)}`
      downloadIds.push(downloadId)

      const downloadOptions: DownloadOptions = {
        url: entry.url,
        type: options.type,
        format: options.format,
        audioFormat: options.type === 'audio' ? options.format : undefined
      }

      const createdAt = Date.now()

      // Add to queue
      this.queue.add(downloadId, downloadOptions, {
        id: downloadId,
        url: entry.url,
        title: entry.title,
        type: options.type,
        status: 'pending',
        progress: { percent: 0 },
        createdAt
      })

      this.upsertHistoryEntry(downloadId, downloadOptions, {
        title: entry.title,
        status: 'pending',
        downloadedAt: createdAt
      })
    }

    return downloadIds
  }

  startDownload(id: string, options: DownloadOptions): void {
    if (this.activeDownloads.has(id)) {
      console.warn(`Download ${id} is already active`)
      return
    }

    const createdAt = Date.now()
    const settings = settingsManager.getAll()

    const item: DownloadItem = {
      id,
      url: options.url,
      title: 'Downloading...',
      type: options.type,
      status: 'pending' as const,
      createdAt
    }

    this.queue.add(id, options, item)

    this.upsertHistoryEntry(id, options, {
      title: item.title,
      status: 'pending',
      downloadedAt: createdAt,
      downloadPath: settings.downloadPath
    })
  }

  private async executeDownload(id: string, options: DownloadOptions): Promise<void> {
    scopedLoggers.download.info('Starting download execution for ID:', id, 'URL:', options.url)
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()
    const downloadPath = settings.downloadPath

    // Set environment variables for proper encoding on Windows
    if (process.platform === 'win32') {
      process.env.PYTHONIOENCODING = 'utf-8'
      process.env.LC_ALL = 'C.UTF-8'
    }

    let availableFormats: VideoFormat[] = []
    let selectedFormat: VideoFormat | undefined
    let actualFormat: string | null = null
    let actualQuality: string | null = null
    let actualCodec: string | null = null
    let videoInfo: VideoInfo | undefined

    // First, get detailed video info to capture basic metadata and formats
    try {
      const info = await this.getVideoInfo(options.url)
      videoInfo = info

      availableFormats = Array.isArray(info.formats) ? info.formats : []
      selectedFormat = resolveSelectedFormat(availableFormats, options, settings)

      if (selectedFormat) {
        actualFormat = selectedFormat.ext || actualFormat

        if (selectedFormat.height) {
          actualQuality = `${selectedFormat.height}p${
            selectedFormat.fps && selectedFormat.fps === 60 ? '60' : ''
          }`
        } else if (selectedFormat.format_note) {
          actualQuality = selectedFormat.format_note
        }

        if (options.type === 'audio' || options.type === 'extract') {
          actualCodec = selectedFormat.acodec || actualCodec
        } else {
          actualCodec = selectedFormat.vcodec || selectedFormat.acodec || actualCodec
        }
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
    } catch (error) {
      scopedLoggers.download.warn('Failed to get detailed video info for ID:', id, error)
    }

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

      if (candidate.height) {
        actualQuality = `${candidate.height}p${candidate.fps === 60 ? '60' : ''}`
      } else if (candidate.format_note) {
        actualQuality = candidate.format_note
      }

      if (options.type === 'audio' || options.type === 'extract') {
        actualCodec = candidate.acodec || actualCodec
      } else {
        actualCodec = candidate.vcodec || candidate.acodec || actualCodec
      }

      this.updateDownloadInfo(id, {
        selectedFormat: candidate
      })

      return true
    }

    const args = buildDownloadArgs(options, downloadPath, settings)

    const controller = new AbortController()
    const ytdlpProcess = ytdlp.exec(args, {
      signal: controller.signal
    })

    this.activeDownloads.set(id, { controller, process: ytdlpProcess })

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

        const downloadProgress: DownloadProgress = {
          percent: progress.percent || 0,
          currentSpeed: progress.currentSpeed || '',
          eta: progress.eta || '',
          downloaded: progress.downloaded || '',
          total: progress.total || ''
        }
        this.emit('download-progress', id, downloadProgress)
      }
    )

    // Handle yt-dlp events to capture format info
    ytdlpProcess.on('ytDlpEvent', (eventType: string, eventData: string) => {
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

          const heightMatch = formatInfo.match(/(\d+)p/)
          if (heightMatch && !actualQuality) {
            actualQuality = `${heightMatch[1]}p`
          }

          const codecMatch = formatInfo.match(/(?:vcodec|acodec)[:\s]*([^\s,]+)/)
          if (codecMatch && !actualCodec) {
            actualCodec = codecMatch[1]
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
    })

    // Handle completion
    ytdlpProcess.on('close', async (code: number | null) => {
      this.activeDownloads.delete(id)
      this.queue.downloadCompleted(id)

      if (code === 0) {
        // Generate file path using downloadPath + title + ext
        const title = videoInfo?.title || 'Unknown'
        const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)
        const extension =
          options.type === 'audio' ? options.extractFormat || 'mp3' : actualFormat || 'mp4'
        const fileName = `${sanitizedTitle}.${extension}`
        const finalOutputPath = path.join(downloadPath, fileName)

        scopedLoggers.download.info('Generated file path for ID:', id, 'Path:', finalOutputPath)

        let fileSize: number | undefined
        try {
          const fs = await import('node:fs/promises')
          const stats = await fs.stat(finalOutputPath)
          fileSize = stats.size
        } catch (error) {
          if (latestKnownSizeBytes !== undefined) {
            fileSize = latestKnownSizeBytes
          } else {
            scopedLoggers.download.warn('Failed to get file size for ID:', id, error)
          }
        }

        if (fileSize === undefined && latestKnownSizeBytes !== undefined) {
          fileSize = latestKnownSizeBytes
        }

        this.updateDownloadInfo(id, {
          status: 'completed',
          completedAt: Date.now(),
          fileSize,
          format: actualFormat || undefined,
          quality: actualQuality || undefined,
          codec: actualCodec || undefined
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
      scopedLoggers.download.error('Download process error for ID:', id, error)
      this.activeDownloads.delete(id)
      this.queue.downloadCompleted(id)
      this.emit('download-error', id, error)
      this.addToHistory(id, options, 'error', error.message)
    })
  }

  cancelDownload(id: string): boolean {
    scopedLoggers.download.info('Cancelling download for ID:', id)
    const snapshot = this.queue.getItemDetails(id)

    const download = this.activeDownloads.get(id)
    if (download) {
      download.controller.abort()
      const removedFromQueue = this.queue.remove(id)
      this.activeDownloads.delete(id)
      scopedLoggers.download.info('Download cancelled successfully for ID:', id)
      this.emit('download-cancelled', id)
      if (snapshot) {
        this.upsertHistoryEntry(id, snapshot.options, {
          status: 'cancelled',
          completedAt: Date.now()
        })
      }
      return removedFromQueue
    }
    const removed = this.queue.remove(id)
    if (removed && snapshot) {
      this.upsertHistoryEntry(id, snapshot.options, {
        status: 'cancelled',
        completedAt: Date.now()
      })
    }
    return removed
  }

  updateMaxConcurrent(max: number): void {
    this.queue.setMaxConcurrent(max)
  }

  getQueueStatus() {
    return this.queue.getQueueStatus()
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
    if (updates.format !== undefined) {
      historyUpdates.format = updates.format
    }
    if (updates.quality !== undefined) {
      historyUpdates.quality = updates.quality
    }
    if (updates.codec !== undefined) {
      historyUpdates.codec = updates.codec
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
    if (updates.status !== undefined) {
      historyUpdates.status = updates.status
    }
    if (updates.completedAt !== undefined) {
      historyUpdates.completedAt = updates.completedAt
    }
    if (updates.error !== undefined) {
      historyUpdates.error = updates.error
    }
    if (updates.selectedFormat !== undefined) {
      historyUpdates.selectedFormat = updates.selectedFormat
    }

    if (Object.keys(historyUpdates).length > 0) {
      this.upsertHistoryEntry(id, snapshot.options, historyUpdates)
    }
  }

  private addToHistory(
    id: string,
    options: DownloadOptions,
    status: DownloadHistoryItem['status'],
    error?: string
  ): void {
    // Get the download item from the queue to get additional info
    const completedDownload = this.queue.getCompletedDownload(id)
    scopedLoggers.download.info('Completed download:', completedDownload)
    const completedAt = Date.now()

    this.upsertHistoryEntry(id, options, {
      title: completedDownload?.item.title || `Download ${id}`,
      thumbnail: completedDownload?.item.thumbnail,
      status,
      completedAt,
      error,
      duration: completedDownload?.item.duration,
      fileSize: completedDownload?.item.fileSize,
      format: completedDownload?.item.format,
      quality: completedDownload?.item.quality,
      codec: completedDownload?.item.codec,
      description: completedDownload?.item.description,
      channel: completedDownload?.item.channel,
      uploader: completedDownload?.item.uploader,
      viewCount: completedDownload?.item.viewCount,
      tags: completedDownload?.item.tags
    })
  }

  private upsertHistoryEntry(
    id: string,
    options: DownloadOptions,
    updates: Partial<DownloadHistoryItem>
  ): void {
    const existing = historyManager.getHistoryById(id)
    const base: DownloadHistoryItem = existing ?? {
      id,
      url: options.url,
      title: updates.title || `Download ${id}`,
      thumbnail: updates.thumbnail,
      type: options.type,
      status: updates.status || 'pending',
      downloadPath: updates.downloadPath,
      fileSize: updates.fileSize,
      duration: updates.duration,
      downloadedAt: updates.downloadedAt ?? Date.now(),
      completedAt: updates.completedAt,
      error: updates.error,
      format: updates.format,
      quality: updates.quality,
      codec: updates.codec,
      description: updates.description,
      channel: updates.channel,
      uploader: updates.uploader,
      viewCount: updates.viewCount,
      tags: updates.tags,
      // Download-specific format info
      selectedFormat: updates.selectedFormat
    }

    const merged: DownloadHistoryItem = {
      ...base,
      ...updates,
      id,
      url: updates.url ?? base.url,
      type: updates.type ?? base.type,
      title: updates.title ?? base.title,
      status: updates.status ?? base.status,
      downloadedAt: updates.downloadedAt ?? base.downloadedAt
    }

    historyManager.addHistoryItem(merged)
  }
}

export const downloadEngine = new DownloadEngine()
