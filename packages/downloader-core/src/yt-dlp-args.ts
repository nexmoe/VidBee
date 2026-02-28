import os from 'node:os'
import path from 'node:path'

export interface YtDlpDownloadSettings {
  downloadPath?: string
  browserForCookies?: string
  cookiesPath?: string
  proxy?: string
  configPath?: string
  embedSubs?: boolean
  embedThumbnail?: boolean
  embedMetadata?: boolean
  embedChapters?: boolean
}

export interface YtDlpDownloadOptions {
  url: string
  type: 'video' | 'audio'
  format?: string
  audioFormat?: string
  audioFormatIds?: string[]
  startTime?: string
  endTime?: string
  customDownloadPath?: string
  customFilenameTemplate?: string
}

const YOUTUBE_HOST_SUFFIXES = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] as const
const YOUTUBE_SAFE_PLAYER_CLIENTS = 'default,-web,-web_safari'
const DEFAULT_FILENAME_TEMPLATE = '%(title)s via VidBee.%(ext)s'

const hasYouTubeHost = (host: string): boolean =>
  YOUTUBE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

const trim = (value?: string | null): string => value?.trim() ?? ''

const isBilibiliUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes('bilibili.com') || host.includes('b23.tv') || host.includes('bili.tv')
  } catch {
    return false
  }
}

export const resolvePathWithHome = (rawPath?: string | null): string | undefined => {
  const trimmed = trim(rawPath)
  if (!trimmed) {
    return undefined
  }

  if (trimmed === '~') {
    return os.homedir()
  }

  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }

  return trimmed
}

export const sanitizeFilenameTemplate = (template: string): string => {
  const trimmed = template.trim()
  if (!trimmed) {
    return DEFAULT_FILENAME_TEMPLATE
  }
  const normalized = trimmed.replace(/\\/g, '/')
  const safeParts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*]/g, '-').replace(/[. ]+$/g, ''))
    .filter((part) => part !== '')
  return safeParts.length === 0 ? DEFAULT_FILENAME_TEMPLATE : safeParts.join('/')
}

export const isYouTubeUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hasYouTubeHost(host)
  } catch {
    return false
  }
}

export const appendYouTubeSafeExtractorArgs = (args: string[], url: string): void => {
  if (!isYouTubeUrl(url)) {
    return
  }
  args.push('--extractor-args', `youtube:player_client=${YOUTUBE_SAFE_PLAYER_CLIENTS}`)
}

export const formatYtDlpCommand = (args: string[]): string => {
  const quoted = args.map((arg) => {
    if (arg === '') {
      return '""'
    }
    if (/[\s"'\\]/.test(arg)) {
      return `"${arg.replace(/(["\\])/g, '\\$1')}"`
    }
    return arg
  })
  return `yt-dlp ${quoted.join(' ')}`
}

export const resolveFfmpegLocationFromPath = (ffmpegPath: string): string => path.dirname(ffmpegPath)

export const resolveVideoFormatSelector = (options: YtDlpDownloadOptions): string => {
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
      return 'bestvideo+bestaudio/best'
    }
    return `bestvideo+${audioFormat}`
  }

  if (audioFormat === 'none') {
    return `${format}+none`
  }

  if (!audioFormat || audioFormat === 'best') {
    return `${format}+bestaudio/best`
  }

  return `${format}+${audioFormat}`
}

export const resolveAudioFormatSelector = (options: YtDlpDownloadOptions): string => {
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
  options: YtDlpDownloadOptions,
  fallbackDownloadPath: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args: string[] = ['--no-playlist', '--no-mtime', '--encoding', 'utf-8']

  if (options.type === 'video') {
    const formatSelector = resolveVideoFormatSelector(options)
    if (formatSelector) {
      args.push('-f', formatSelector)
    }
    if ((options.audioFormatIds?.length ?? 0) > 0 || formatSelector.includes('mergeall')) {
      args.push('--audio-multistreams')
    }
  } else if (options.type === 'audio') {
    args.push('-f', resolveAudioFormatSelector(options))
  }

  if (options.startTime || options.endTime) {
    const start = options.startTime || '0'
    const end = options.endTime || ''
    args.push('--download-sections', `*${start}-${end}`)
  }

  const embedSubs = settings.embedSubs ?? true
  const embedThumbnail = settings.embedThumbnail ?? false
  const embedMetadata = settings.embedMetadata ?? true
  const embedChapters = settings.embedChapters ?? true
  const browserForCookies = trim(settings.browserForCookies)
  const cookiesPath = trim(settings.cookiesPath)
  const hasSubtitleAuth = (browserForCookies && browserForCookies !== 'none') || Boolean(cookiesPath)
  const shouldAttemptSubtitles = !isBilibiliUrl(options.url) || hasSubtitleAuth

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

  args.push(embedThumbnail ? '--embed-thumbnail' : '--no-embed-thumbnail')
  args.push(embedMetadata ? '--embed-metadata' : '--no-embed-metadata')
  args.push(embedChapters ? '--embed-chapters' : '--no-embed-chapters')

  const baseDownloadPath =
    trim(options.customDownloadPath) || trim(settings.downloadPath) || fallbackDownloadPath
  const filenameTemplate = sanitizeFilenameTemplate(
    options.customFilenameTemplate ?? DEFAULT_FILENAME_TEMPLATE
  )
  const safeTemplate = filenameTemplate.replace(/^[\\/]+/, '')
  args.push('-o', path.join(baseDownloadPath, safeTemplate))
  args.push('--continue')
  args.push('--no-playlist-reverse')

  if (process.platform === 'win32') {
    args.push('--windows-filenames')
  }

  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }

  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, options.url)
  }

  if (jsRuntimeArgs.length > 0) {
    args.push(...jsRuntimeArgs)
  }

  args.push(options.url)
  return args
}

export const buildVideoInfoArgs = (
  url: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args = ['-j', '--no-playlist', '--no-warnings', '--encoding', 'utf-8']

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  const browserForCookies = trim(settings.browserForCookies)
  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }

  const cookiesPath = trim(settings.cookiesPath)
  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }

  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, url)
  }

  if (jsRuntimeArgs.length > 0) {
    args.push(...jsRuntimeArgs)
  }

  args.push(url)
  return args
}

export const buildPlaylistInfoArgs = (
  url: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = []
): string[] => {
  const args = ['-J', '--flat-playlist', '--no-warnings', '--encoding', 'utf-8']

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  const browserForCookies = trim(settings.browserForCookies)
  if (browserForCookies && browserForCookies !== 'none') {
    args.push('--cookies-from-browser', browserForCookies)
  }

  const cookiesPath = trim(settings.cookiesPath)
  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }

  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, url)
  }

  if (jsRuntimeArgs.length > 0) {
    args.push(...jsRuntimeArgs)
  }

  args.push(url)
  return args
}
