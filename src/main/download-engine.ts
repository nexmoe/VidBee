import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { YTDlpEventEmitter } from 'yt-dlp-wrap-plus'
import type {
  AppSettings,
  DownloadHistoryItem,
  DownloadItem,
  DownloadOptions,
  DownloadProgress,
  OneClickQualityPreset,
  PlaylistDownloadOptions,
  PlaylistInfo,
  VideoFormat,
  VideoInfo
} from '../shared/types'
import { DownloadQueue } from './lib/download-queue'
import { historyManager } from './lib/history-manager'
import { ytdlpManager } from './lib/ytdlp-manager'
import { settingsManager } from './settings'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  auto: null,
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const qualityPresetToAudioAbr: Record<OneClickQualityPreset, number | null> = {
  auto: null,
  best: 320,
  good: 256,
  normal: 192,
  bad: 128,
  worst: 96
}

const selectVideoFormatForPreset = (
  formats: VideoFormat[],
  preset: OneClickQualityPreset
): VideoFormat | undefined => {
  if (formats.length === 0) {
    return undefined
  }

  const sorted = [...formats].sort((a, b) => {
    const heightDiff = (b.height ?? 0) - (a.height ?? 0)
    if (heightDiff !== 0) return heightDiff
    const fpsDiff = (b.fps ?? 0) - (a.fps ?? 0)
    if (fpsDiff !== 0) return fpsDiff
    return (b.tbr ?? 0) - (a.tbr ?? 0)
  })

  if (preset === 'worst') {
    return sorted[sorted.length - 1] ?? sorted[0]
  }

  const heightLimit = qualityPresetToVideoHeight[preset]
  if (!heightLimit) {
    return sorted[0]
  }

  const withinLimit = sorted.find((format) => {
    const height = format.height ?? 0
    return height > 0 && height <= heightLimit
  })

  return withinLimit ?? sorted[0]
}

const selectAudioFormatForPreset = (
  formats: VideoFormat[],
  preset: OneClickQualityPreset
): VideoFormat | undefined => {
  if (formats.length === 0) {
    return undefined
  }

  const sorted = [...formats].sort((a, b) => {
    const bitrateDiff = (b.tbr ?? 0) - (a.tbr ?? 0)
    if (bitrateDiff !== 0) return bitrateDiff
    const sizeA = a.filesize ?? a.filesize_approx ?? 0
    const sizeB = b.filesize ?? b.filesize_approx ?? 0
    if (sizeB !== sizeA) return sizeB - sizeA
    return 0
  })

  if (preset === 'worst') {
    return sorted[sorted.length - 1] ?? sorted[0]
  }

  const abrLimit = qualityPresetToAudioAbr[preset]
  if (!abrLimit) {
    return sorted[0]
  }

  const withinLimit = sorted.find((format) => {
    const bitrate = format.tbr ?? 0
    return bitrate > 0 && bitrate <= abrLimit
  })

  return withinLimit ?? sorted[0]
}

const findFormatBySelector = (
  formats: VideoFormat[],
  selector?: string
): VideoFormat | undefined => {
  if (!selector) {
    return undefined
  }

  const candidateIds = selector
    .split('/')
    .map((option) => option.split('+')[0].trim())
    .filter((option) => option.length > 0)

  for (const candidateId of candidateIds) {
    const match = formats.find((format) => format.format_id === candidateId)
    if (match) {
      return match
    }
  }

  return undefined
}

const findFormatByIdCandidates = (
  formats: VideoFormat[],
  rawFormatId: string | undefined
): VideoFormat | undefined => {
  if (!rawFormatId) {
    return undefined
  }

  const parts = rawFormatId
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  for (const part of parts) {
    const match = formats.find((format) => format.format_id === part)
    if (match) {
      return match
    }
  }

  return undefined
}

const parseSizeToBytes = (value?: string): number | undefined => {
  if (!value) {
    return undefined
  }

  const cleaned = value.trim().replace(/^~\s*/, '')
  if (!cleaned) {
    return undefined
  }

  const match = cleaned.match(/^([\d.,]+)\s*([KMGTP]?i?B)$/i)
  if (!match) {
    return undefined
  }

  const amount = Number(match[1].replace(/,/g, ''))
  if (Number.isNaN(amount)) {
    return undefined
  }

  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1_000,
    KIB: 1_024,
    MB: 1_000_000,
    MIB: 1_048_576,
    GB: 1_000_000_000,
    GIB: 1_073_741_824,
    TB: 1_000_000_000_000,
    TIB: 1_099_511_627_776
  }

  const multiplier = multipliers[unit]
  if (!multiplier) {
    return undefined
  }

  return Math.round(amount * multiplier)
}

const resolveSelectedFormat = (
  formats: VideoFormat[],
  options: DownloadOptions,
  settings: AppSettings
): VideoFormat | undefined => {
  const directMatch = findFormatBySelector(formats, options.format)
  if (directMatch) {
    return directMatch
  }

  const preset = settings.oneClickQuality ?? 'auto'

  if (options.type === 'video') {
    const videoFormats = formats.filter(
      (format) => format.video_ext !== 'none' && !!format.vcodec && format.vcodec !== 'none'
    )
    return selectVideoFormatForPreset(videoFormats, preset)
  }

  if (options.type === 'audio' || options.type === 'extract') {
    const audioFormats = formats.filter(
      (format) =>
        !!format.acodec &&
        format.acodec !== 'none' &&
        (!format.video_ext || format.video_ext === 'none')
    )
    return selectAudioFormatForPreset(audioFormats, preset)
  }

  return undefined
}

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
            resolve(info)
          } catch (error) {
            reject(new Error(`Failed to parse video info: ${error}`))
          }
        } else {
          reject(new Error(stderr || 'Failed to fetch video info'))
        }
      })

      process.on('error', (error) => {
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

    console.log(
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
      outputPath: options.outputPath
    })
  }

  private async executeDownload(id: string, options: DownloadOptions): Promise<void> {
    const ytdlp = ytdlpManager.getInstance()
    const settings = settingsManager.getAll()
    const downloadPath = options.outputPath || settings.downloadPath

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

    // First, get detailed video info to capture basic metadata and formats
    try {
      const videoInfo = await this.getVideoInfo(options.url)

      availableFormats = Array.isArray(videoInfo.formats) ? videoInfo.formats : []
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
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        duration: videoInfo.duration,
        description: videoInfo.description,
        uploader: videoInfo.uploader,
        viewCount: videoInfo.view_count,
        // Store only essential download info
        selectedFormat
      })

      this.upsertHistoryEntry(id, options, {
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        duration: videoInfo.duration,
        description: videoInfo.description,
        uploader: videoInfo.uploader,
        viewCount: videoInfo.view_count,
        // Store only essential download info
        selectedFormat
      })
    } catch (error) {
      console.warn('Failed to get detailed video info:', error)
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

    const args = this.buildDownloadArgs(options, downloadPath, settings)

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

    // Handle yt-dlp events to capture output file path and format info
    let actualOutputPath: string | null = null

    ytdlpProcess.on('ytDlpEvent', (eventType: string, eventData: string) => {
      // Look for download destination messages
      if (eventType === 'download' && eventData.includes('Destination:')) {
        const match = eventData.match(/Destination:\s*(.+)/)
        if (match?.[1]) {
          actualOutputPath = match[1].trim()
        }
      }

      // Also look for other output path patterns
      if (
        eventType === 'download' &&
        (eventData.includes('has already been downloaded') ||
          eventData.includes('has already been downloaded'))
      ) {
        const match = eventData.match(/\[download\]\s*(.+?)\s+has already been downloaded/)
        if (match?.[1]) {
          actualOutputPath = match[1].trim()
        }
      }

      // Look for final output path in download messages
      if (eventType === 'download' && eventData.includes('[download] 100%')) {
        const match = eventData.match(/\[download\]\s*100%.*?of\s*(.+?)\s+at/)
        if (match?.[1]) {
          actualOutputPath = match[1].trim()
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
        // Try to get the actual output path from yt-dlp events first
        let finalOutputPath = actualOutputPath

        // If we don't have the actual path, try to construct it
        if (!finalOutputPath) {
          try {
            // Get video info to construct the expected output path
            const videoInfo = await this.getVideoInfo(options.url)
            const title = videoInfo.title || 'Unknown'

            // Sanitize title for filename - handle Chinese characters and special chars
            const sanitizedTitle = title
              .replace(/[<>:"/\\|?*]/g, '_')
              .replace(/[\u4e00-\u9fff]/g, '') // Remove Chinese characters
              .replace(/\s+/g, '_') // Replace spaces with underscores
              .replace(/_{2,}/g, '_') // Replace multiple underscores with single
              .substring(0, 50) // Shorter limit for safety

            // Determine file extension based on format
            let extension = 'mp4' // default
            if (options.type === 'audio') {
              extension = options.extractFormat || 'mp3'
            } else if (actualFormat) {
              extension = actualFormat
            }

            // Construct the expected output path
            const expectedFileName = `${sanitizedTitle}.${extension}`
            const expectedPath = path.join(downloadPath, expectedFileName)

            // Check if the file exists
            const fs = await import('node:fs/promises')
            try {
              await fs.access(expectedPath)
              finalOutputPath = expectedPath
            } catch {
              // Try to find any file with similar name in the download directory
              try {
                const files = await fs.readdir(downloadPath)
                const matchingFile = files.find((file) => {
                  // Look for files that might match our download
                  const isVideoFile =
                    file.endsWith('.mp4') ||
                    file.endsWith('.webm') ||
                    file.endsWith('.mkv') ||
                    file.endsWith('.avi') ||
                    file.endsWith('.mov')

                  const isAudioFile =
                    file.endsWith('.mp3') ||
                    file.endsWith('.m4a') ||
                    file.endsWith('.aac') ||
                    file.endsWith('.ogg')

                  const isCorrectType =
                    (options.type === 'video' && isVideoFile) ||
                    (options.type === 'audio' && isAudioFile)

                  // Check if file was created recently (within last 5 minutes)
                  const filePath = path.join(downloadPath, file)
                  try {
                    const fsSync = require('node:fs')
                    const stats = fsSync.statSync(filePath)
                    const isRecent = Date.now() - stats.mtime.getTime() < 5 * 60 * 1000
                    return isCorrectType && isRecent
                  } catch {
                    return false
                  }
                })
                if (matchingFile) {
                  finalOutputPath = path.join(downloadPath, matchingFile)
                }
              } catch (error) {
                console.warn('Failed to search for matching files:', error)
              }
            }
          } catch (error) {
            console.warn('Failed to construct output path:', error)
          }
        }

        // Fallback to default path if still no output path
        if (!finalOutputPath) {
          // Create a generic filename with timestamp
          const timestamp = Date.now()
          const extension = options.type === 'audio' ? options.extractFormat || 'mp3' : 'mp4'
          const genericFileName = `download_${timestamp}.${extension}`
          finalOutputPath = path.join(downloadPath, genericFileName)
        }

        // Get file size if we have the output path
        let fileSize: number | undefined
        let fileSizeError: unknown
        if (finalOutputPath) {
          try {
            const fs = await import('node:fs/promises')
            const stats = await fs.stat(finalOutputPath)
            fileSize = stats.size
          } catch (error) {
            fileSizeError = error
          }
        }

        if (fileSize === undefined && latestKnownSizeBytes !== undefined) {
          fileSize = latestKnownSizeBytes
        } else if (fileSize === undefined && fileSizeError) {
          console.warn('Failed to get file size:', fileSizeError)
        }

        this.updateDownloadInfo(id, {
          status: 'completed',
          outputPath: finalOutputPath,
          completedAt: Date.now(),
          fileSize,
          format: actualFormat || undefined,
          quality: actualQuality || undefined,
          codec: actualCodec || undefined
        })
        this.emit('download-completed', id)
        this.addToHistory(id, options, 'completed', undefined, finalOutputPath)
      } else {
        this.emit('download-error', id, new Error(`Download exited with code ${code}`))
        this.addToHistory(id, options, 'error', `Download exited with code ${code}`)
      }
    })

    // Handle errors
    ytdlpProcess.on('error', (error: Error) => {
      this.activeDownloads.delete(id)
      this.queue.downloadCompleted(id)
      this.emit('download-error', id, error)
      this.addToHistory(id, options, 'error', error.message)
    })
  }

  private buildDownloadArgs(
    options: DownloadOptions,
    downloadPath: string,
    settings: AppSettings
  ): string[] {
    const args: string[] = ['--no-playlist', '--embed-chapters', '--no-mtime']

    // Add encoding support for proper handling of non-ASCII characters
    args.push('--encoding', 'utf-8')

    // Format selection
    if (options.type === 'video') {
      args.push('-f', this.resolveVideoFormatSelector(options))
    } else if (options.type === 'audio') {
      args.push('-f', this.resolveAudioFormatSelector(options))
    } else if (options.type === 'extract') {
      args.push('-x')
      args.push('--audio-format', options.extractFormat || 'mp3')
      args.push('--audio-quality', options.extractQuality || '5')
    }

    // Time range
    if (options.startTime || options.endTime) {
      const start = options.startTime || '0'
      const end = options.endTime || ''
      args.push('--download-sections', `*${start}-${end || ''}`)
    }

    // Subtitles
    if (options.downloadSubs) {
      args.push('--write-subs', '--sub-langs', 'all')
    }

    // Output path with proper encoding handling
    // Use sanitized filename to avoid encoding issues
    const outputTemplate = path.join(downloadPath, '%(title).100s.%(ext)s')
    args.push('-o', outputTemplate)

    // Add options for better filename handling on Windows
    if (process.platform === 'win32') {
      // On Windows, use a more conservative approach to avoid encoding issues
      args.push('--windows-filenames') // Use Windows-compatible filenames
    }

    // Browser cookies
    if (settings.browserForCookies && settings.browserForCookies !== 'none') {
      args.push('--cookies-from-browser', settings.browserForCookies)
    }

    // Proxy
    if (settings.proxy) {
      args.push('--proxy', settings.proxy)
    }

    // Config file
    if (settings.configPath) {
      args.push('--config-location', settings.configPath)
    }

    // URL (must be last)
    args.push(options.url)

    return args
  }

  private resolveVideoFormatSelector(options: DownloadOptions): string {
    const format = options.format
    const audioFormat = options.audioFormat

    if (format && (format.includes('/') || (audioFormat === undefined && format.includes('+')))) {
      return format
    }

    if (!format || format === 'best') {
      if (audioFormat === 'none') {
        return 'bestvideo+none'
      }
      if (!audioFormat || audioFormat === 'best') {
        return 'best'
      }
      return `bestvideo+${audioFormat}`
    }

    if (audioFormat === 'none') {
      return `${format}+none`
    }

    const audio = audioFormat && audioFormat !== 'best' ? audioFormat : 'bestaudio'
    return `${format}+${audio}`
  }

  private resolveAudioFormatSelector(options: DownloadOptions): string {
    const format = options.format

    if (!format) {
      return 'bestaudio'
    }

    if (format.includes('/') || format.includes('+') || format.includes('[')) {
      return format
    }

    return format
  }

  cancelDownload(id: string): boolean {
    const snapshot = this.queue.getItemDetails(id)

    const download = this.activeDownloads.get(id)
    if (download) {
      download.controller.abort()
      const removedFromQueue = this.queue.remove(id)
      this.activeDownloads.delete(id)
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
    if (updates.outputPath !== undefined) {
      historyUpdates.outputPath = updates.outputPath
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
    error?: string,
    actualOutputPath?: string
  ): void {
    // Get the download item from the queue to get additional info
    const completedDownload = this.queue.getCompletedDownload(id)

    const completedAt = Date.now()

    this.upsertHistoryEntry(id, options, {
      title: completedDownload?.item.title || `Download ${id}`,
      thumbnail: completedDownload?.item.thumbnail,
      status,
      outputPath: actualOutputPath || options.outputPath,
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
      outputPath: updates.outputPath,
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
