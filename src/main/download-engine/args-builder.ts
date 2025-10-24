import path from 'node:path'
import type { AppSettings, DownloadOptions } from '../../shared/types'

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
    args.push('-f', resolveVideoFormatSelector(options))
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
  const outputTemplate = path.join(downloadPath, '%(title)s.%(ext)s')
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

  if (settings.proxy) {
    args.push('--proxy', settings.proxy)
  }

  if (settings.configPath) {
    args.push('--config-location', settings.configPath)
  }

  args.push(options.url)

  return args
}
