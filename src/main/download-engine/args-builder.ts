import path from 'node:path'
import type { AppSettings, DownloadOptions } from '../../shared/types'
import { resolvePathWithHome } from '../utils/path-helpers'

export const sanitizeFilenameTemplate = (template: string): string => {
  const trimmed = template.trim()
  const sanitized = trimmed.replace(/[/\\]+/g, '-')
  return sanitized === '' ? '%(title)s via VidBee.%(ext)s' : sanitized
}

export const resolveVideoFormatSelector = (options: DownloadOptions): string => {
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
      // Use bestvideo+bestaudio to ensure video and audio are merged into a single file
      return 'bestvideo+bestaudio'
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

export const buildDownloadArgs = (
  options: DownloadOptions,
  downloadPath: string,
  settings: AppSettings
): string[] => {
  const args: string[] = ['--no-playlist', '--embed-chapters', '--no-mtime']

  // Add encoding support for proper handling of non-ASCII characters
  args.push('--encoding', 'utf-8')

  // Format selection
  if (options.type === 'video') {
    const formatSelector = resolveVideoFormatSelector(options)
    args.push('-f', formatSelector)
    // Let yt-dlp automatically choose the best merge format (mkv/webm/mp4)
    // based on codec compatibility. Forcing MP4 can cause failures
    // when codecs are incompatible (e.g., VP9+Opus requires mkv/webm)
  } else if (options.type === 'audio') {
    args.push('-f', resolveAudioFormatSelector(options))
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
  const baseDownloadPath = options.customDownloadPath?.trim() || downloadPath
  const filenameTemplate = sanitizeFilenameTemplate(
    options.customFilenameTemplate ?? '%(title)s via VidBee.%(ext)s'
  )
  const safeTemplate = filenameTemplate.replace(/^[\\/]+/, '')
  const outputTemplate = path.join(baseDownloadPath, safeTemplate)
  args.push('-o', outputTemplate)

  // Add options for better filename handling
  args.push('--no-part')
  args.push('--no-playlist-reverse')

  if (process.platform === 'win32') {
    args.push('--windows-filenames')
  }

  if (settings.browserForCookies && settings.browserForCookies !== 'none') {
    args.push('--cookies-from-browser', settings.browserForCookies)
  }

  const cookiesPath = settings.cookiesPath?.trim()
  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }

  if (settings.proxy) {
    args.push('--proxy', settings.proxy)
  }

  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  }

  args.push(options.url)

  return args
}
