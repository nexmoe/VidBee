import path from 'node:path'
import type { AppSettings, DownloadOptions } from '../../shared/types'
import { exportCookiesToTempFile } from '../lib/synced-cookies-store'
import { resolvePathWithHome } from '../utils/path-helpers'

export const sanitizeFilenameTemplate = (template: string): string => {
  const trimmed = template.trim()
  if (!trimmed) {
    return '%(title)s via VidBee.%(ext)s'
  }
  const normalized = trimmed.replace(/\\/g, '/')
  const safeParts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*]/g, '-').replace(/[. ]+$/g, ''))
    .filter((part) => part !== '')
  return safeParts.length === 0 ? '%(title)s via VidBee.%(ext)s' : safeParts.join('/')
}

export const resolveVideoFormatSelector = (options: DownloadOptions): string => {
  const format = options.format
  const audioFormat = options.audioFormat
  const audioFormatIds = (options.audioFormatIds ?? []).filter((id) => id.trim() !== '')

  if (format && audioFormat === '') {
    return format
  }

  if (format && (format.includes('/') || format.includes('+') || format.includes('['))) {
    return format
  }

  if (audioFormatIds.length > 0) {
    const baseVideo = format && format !== 'best' ? format : 'bestvideo*'
    return `${baseVideo}+${audioFormatIds.join('+')}`
  }

  if (!format || format === 'best') {
    if (audioFormat === 'none') {
      return 'bestvideo+none'
    }
    if (!audioFormat || audioFormat === 'best') {
      // Prefer merged formats, but allow single-file "best" for sites without separate streams.
      return 'bestvideo+bestaudio/best'
    }
    return `bestvideo+${audioFormat}`
  }

  if (audioFormat === 'none') {
    return `${format}+none`
  }

  const audio = audioFormat && audioFormat !== 'best' ? audioFormat : 'bestaudio'
  return `${format}+${audio}`
}

export const resolveAudioFormatSelector = (options: DownloadOptions): string => {
  const format = options.format

  if (!format) {
    return 'bestaudio'
  }

  if (format.includes('/') || format.includes('+') || format.includes('[')) {
    return format
  }

  return format
}

const isBilibiliUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes('bilibili.com') || host.includes('b23.tv') || host.includes('bili.tv')
  } catch {
    return false
  }
}

export const buildDownloadArgs = (
  options: DownloadOptions,
  downloadPath: string,
  settings: AppSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args: string[] = ['--no-playlist', '--no-mtime']

  // Add encoding support for proper handling of non-ASCII characters
  args.push('--encoding', 'utf-8')

  // Format selection
  if (options.type === 'video') {
    const formatSelector = resolveVideoFormatSelector(options)
    if (formatSelector) {
      args.push('-f', formatSelector)
    }
    if (options.audioFormatIds && options.audioFormatIds.length > 0) {
      args.push('--audio-multistreams')
    } else if (formatSelector.includes('mergeall')) {
      args.push('--audio-multistreams')
    }
    // Let yt-dlp automatically choose the best merge format (mkv/webm/mp4)
    // based on codec compatibility. Forcing MP4 can cause failures
    // when codecs are incompatible (e.g., VP9+Opus requires mkv/webm)
  } else if (options.type === 'audio') {
    args.push('-f', resolveAudioFormatSelector(options))
  }

  // Time range
  if (options.startTime || options.endTime) {
    const start = options.startTime || '0'
    const end = options.endTime || ''
    args.push('--download-sections', `*${start}-${end || ''}`)
  }

  const embedSubs = settings.embedSubs
  const embedMetadata = settings.embedMetadata
  const embedChapters = settings.embedChapters
  const cookiesSource = settings.cookiesSource ?? 'browser'
  const shouldUseBrowserCookies =
    cookiesSource === 'browser' &&
    settings.browserForCookies &&
    settings.browserForCookies !== 'none'
  const syncedCookiesPath = cookiesSource === 'extension' ? exportCookiesToTempFile() : null
  const hasSubtitleAuth = Boolean(syncedCookiesPath || shouldUseBrowserCookies)
  const shouldAttemptSubtitles = !isBilibiliUrl(options.url) || hasSubtitleAuth

  // Subtitles
  if (shouldAttemptSubtitles) {
    if (embedSubs) {
      args.push('--sub-langs', 'all')
    } else {
      args.push('--write-subs')
    }
    args.push(embedSubs ? '--embed-subs' : '--no-embed-subs')
  } else {
    args.push('--no-embed-subs')
  }
  args.push(settings.embedThumbnail ? '--embed-thumbnail' : '--no-embed-thumbnail')
  args.push(embedMetadata ? '--embed-metadata' : '--no-embed-metadata')
  args.push(embedChapters ? '--embed-chapters' : '--no-embed-chapters')

  // Output path with proper encoding handling
  const baseDownloadPath = options.customDownloadPath?.trim() || downloadPath
  const filenameTemplate = sanitizeFilenameTemplate(
    options.customFilenameTemplate ?? '%(title)s via VidBee.%(ext)s'
  )
  const safeTemplate = filenameTemplate.replace(/^[\\/]+/, '')
  const outputTemplate = path.join(baseDownloadPath, safeTemplate)
  args.push('-o', outputTemplate)

  // Allow resume support across restarts
  args.push('--continue')
  args.push('--no-playlist-reverse')

  if (process.platform === 'win32') {
    args.push('--windows-filenames')
  }

  if (syncedCookiesPath) {
    args.push('--cookies', syncedCookiesPath)
  } else if (shouldUseBrowserCookies) {
    args.push('--cookies-from-browser', settings.browserForCookies)
  }

  if (settings.proxy) {
    args.push('--proxy', settings.proxy)
  }

  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  }

  if (jsRuntimeArgs.length > 0) {
    args.push(...jsRuntimeArgs)
  }

  args.push(options.url)

  return args
}
