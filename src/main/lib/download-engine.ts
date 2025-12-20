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
  VideoInfo
} from '../../shared/types'
import {
  buildDownloadArgs,
  resolveVideoFormatSelector,
  sanitizeFilenameTemplate
} from '../download-engine/args-builder'
import {
  findFormatByIdCandidates,
  parseSizeToBytes,
  resolveSelectedFormat
} from '../download-engine/format-utils'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { resolvePathWithHome } from '../utils/path-helpers'
import { DownloadQueue } from './download-queue'
import { ffmpegManager } from './ffmpeg-manager'
import { historyManager } from './history-manager'
import { ytdlpManager } from './ytdlp-manager'

interface DownloadProcess {
  controller: AbortController
  process: YTDlpEventEmitter
}

const ensureDirectoryExists = (dir?: string): void => {
  if (!dir) {
    return
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    scopedLoggers.download.error('Failed to ensure download directory:', error)
  }
}

const sanitizeFolderName = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return sanitized || fallback
}

const isLikelyChannelUrl = (url: string): boolean => {
  const normalized = url.toLowerCase()
  if (normalized.includes('list=')) {
    return false
  }
  return /youtube\.com\/(channel\/|c\/|user\/|@)/.test(normalized)
}

const resolveAutoPlaylistDownloadPath = (
  basePath: string,
  info: PlaylistInfo,
  url: string
): string => {
  const kindFolder = isLikelyChannelUrl(url) ? 'Channels' : 'Playlists'
  const title = sanitizeFolderName(
    info.title || (kindFolder === 'Channels' ? 'Channel' : 'Playlist'),
    kindFolder === 'Channels' ? 'Channel' : 'Playlist'
  )
  return path.join(basePath, kindFolder, title)
}

const resolveAutoVideoDownloadPath = (basePath: string, info?: VideoInfo): string => {
  const root = path.join(basePath, 'Videos')
  if (!info) {
    return root
  }
  const label = info.uploader?.trim() || info.title?.trim()
  if (!label) {
    return root
  }
  return path.join(root, sanitizeFolderName(label, 'Video'))
}

const resolveHistoryDownloadPath = (basePath: string, filenameTemplate?: string): string => {
  if (!filenameTemplate?.trim()) {
    return basePath
  }
  const safeTemplate = sanitizeFilenameTemplate(filenameTemplate)
  const templateDir = path.posix.dirname(safeTemplate)
  if (templateDir === '.' || templateDir === '/') {
    return basePath
  }
  return path.join(basePath, templateDir)
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

    // Note: Some sites (e.g., YouTube) may not provide filesize information
    // in the initial request. This is normal behavior and filesize may be null/undefined
    // for many formats. File size information might require additional HTTP HEAD requests
    // which would significantly slow down info extraction, so yt-dlp doesn't fetch it by default.

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

            // Calculate estimated file size for formats missing filesize information
            // Using tbr (total bitrate in kbps) and duration (in seconds)
            // Formula: (tbr * 1000) / 8 * duration = size in bytes
            if (info.formats && Array.isArray(info.formats) && info.duration) {
              const duration = info.duration
              for (const format of info.formats) {
                if (
                  !format.filesize &&
                  !format.filesize_approx &&
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
    }

    args.push(url)

    type RawPlaylistEntry = {
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

    // Create download items for each video in the playlist
    for (const entry of selectedEntries) {
      const downloadId = `${groupId}_${Math.random().toString(36).substring(2, 10)}`

      const downloadOptions: DownloadOptions = {
        url: entry.url,
        type: options.type,
        format: options.format,
        audioFormat: options.type === 'audio' ? options.format : undefined,
        customDownloadPath: resolvedDownloadPath
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
      this.queue.add(downloadId, downloadOptions, {
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
      })

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
      endIndex: selectedEntries[selectedEntries.length - 1]?.index ?? rangeEnd + 1,
      entries: downloadEntries
    }
  }

  startDownload(id: string, options: DownloadOptions): void {
    if (this.activeDownloads.has(id)) {
      console.warn(`Download ${id} is already active`)
      return
    }

    const createdAt = Date.now()
    const settings = settingsManager.getAll()
    const targetDownloadPath = options.customDownloadPath?.trim() || settings.downloadPath
    const origin = options.origin ?? 'manual'
    ensureDirectoryExists(targetDownloadPath)

    const item: DownloadItem = {
      id,
      url: options.url,
      title: 'Downloading...',
      type: options.type,
      status: 'pending' as const,
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
      downloadPath: targetDownloadPath,
      tags: options.tags,
      origin,
      subscriptionId: options.subscriptionId
    })
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

    // First, get detailed video info to capture basic metadata and formats
    try {
      const info = await this.getVideoInfo(options.url)
      videoInfo = info

      availableFormats = Array.isArray(info.formats) ? info.formats : []
      selectedFormat = resolveSelectedFormat(availableFormats, options, settings)

      if (selectedFormat) {
        actualFormat = selectedFormat.ext || actualFormat
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

    if (!options.customDownloadPath?.trim()) {
      resolvedDownloadPath = resolveAutoVideoDownloadPath(defaultDownloadPath, videoInfo)
      options.customDownloadPath = resolvedDownloadPath
    }

    const historyDownloadPath = resolveHistoryDownloadPath(
      resolvedDownloadPath,
      options.customFilenameTemplate
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

    const args = buildDownloadArgs(options, resolvedDownloadPath, settings)

    const captureOutputPath = (rawPath: string | undefined): void => {
      if (!rawPath) {
        return
      }
      const trimmed = rawPath.trim().replace(/^"|"$/g, '')
      if (!trimmed) {
        return
      }
      lastKnownOutputPath = path.isAbsolute(trimmed)
        ? trimmed
        : path.join(resolvedDownloadPath, trimmed)
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

    args.push('--ffmpeg-location', ffmpegPath)
    args.push(urlArg)

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
      this.activeDownloads.delete(id)
      this.queue.downloadCompleted(id)

      if (code === 0) {
        // Generate file path using downloadPath + title + ext
        const title = videoInfo?.title || 'Unknown'
        const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50)

        // Determine file extension based on download type and format
        // yt-dlp automatically chooses the best merge format (mkv/webm/mp4)
        // based on codec compatibility, so we should use actualFormat when available
        let extension: string
        if (options.type === 'audio') {
          extension = options.extractFormat || 'mp3'
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
        const candidatePaths = lastKnownOutputPath
          ? [lastKnownOutputPath, fallbackOutputPath]
          : [fallbackOutputPath]

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
            const matchingFiles = files.filter((file) => {
              const baseName = file.replace(/\.[^.]+$/, '')
              const fileExt = file.split('.').pop()?.toLowerCase()
              return (
                (baseName === sanitizedTitle || baseName.startsWith(sanitizedTitle)) &&
                fileExt === extension.toLowerCase()
              )
            })

            if (matchingFiles.length > 0) {
              const fileStats = await Promise.all(
                matchingFiles.map(async (file) => {
                  const filePath = path.join(resolvedDownloadPath, file)
                  const stats = await fs.stat(filePath)
                  return { path: filePath, mtime: stats.mtime, size: stats.size }
                })
              )
              const mostRecent = fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0]
              actualFilePath = mostRecent.path
              fileSize = mostRecent.size
              located = true
              scopedLoggers.download.info('Found actual file:', actualFilePath, 'Size:', fileSize)
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

        const savedFileName = path.basename(actualFilePath)

        this.updateDownloadInfo(id, {
          status: 'completed',
          completedAt: Date.now(),
          fileSize,
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
    if (updates.savedFileName !== undefined) {
      historyUpdates.savedFileName = updates.savedFileName
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
