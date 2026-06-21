import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseBrowserCookiesSetting } from './browser-cookies-setting'
import type { OneClickContainerOption } from './format-preferences'

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
  containerFormat?: OneClickContainerOption
}

const YOUTUBE_HOST_SUFFIXES = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] as const
// GitHub issue #359: drop only the bare `web` client (which requires a PO
// token and frequently 403s) but keep `web_safari` and the other defaults so
// extraction has more fallbacks before failing.
const YOUTUBE_SAFE_PLAYER_CLIENTS = 'default,-web'
const DEFAULT_FILENAME_TEMPLATE = '%(title)s via VidBee.%(ext)s'
const WINDOWS_FILENAME_TRIM_LENGTH = '120'

// GitHub issues #326, #355, #325: yt-dlp's default of 10 retries and no
// socket timeout left users with `Giving up after N retries` and DNS hangs
// on flaky networks. Push the defaults up and add a short backoff so a
// single transient failure does not abort the whole download.
const DEFAULT_RETRIES = '30'
const DEFAULT_FRAGMENT_RETRIES = '30'
const DEFAULT_RETRY_SLEEP = '2'
const DEFAULT_SOCKET_TIMEOUT = '30'

const appendNetworkResilienceArgs = (args: string[]): void => {
  args.push('--retries', DEFAULT_RETRIES)
  args.push('--fragment-retries', DEFAULT_FRAGMENT_RETRIES)
  args.push('--retry-sleep', DEFAULT_RETRY_SLEEP)
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)
}

const hasYouTubeHost = (host: string): boolean =>
  YOUTUBE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

const trim = (value?: string | null): string => value?.trim() ?? ''

/**
 * Normalize browser cookies settings before passing them to yt-dlp.
 *
 * Issue refs: #331, #337, #341.
 */
export const normalizeBrowserCookiesSettingForYtDlp = (value?: string | null): string => {
  const rawValue = trim(value)
  if (!rawValue || rawValue === 'none') {
    return 'none'
  }

  const { browser, profile } = parseBrowserCookiesSetting(rawValue)
  if (!profile) {
    return browser
  }

  if (browser === 'safari') {
    return 'safari'
  }

  const looksLikePath = profile.includes('/') || profile.includes('\\')
  if (!looksLikePath) {
    return `${browser}:${profile}`
  }

  // GitHub issue #331: yt-dlp accepts either a profile name or an absolute
  // path. Firefox profiles in non-default locations (portable/custom installs)
  // cannot be resolved by name, so when the absolute path holds a
  // cookies.sqlite we pass it verbatim; otherwise fall back to the basename,
  // which keeps resolving for standard installs.
  const isWindowsPath = profile.includes('\\')
  const isAbsolutePath = isWindowsPath
    ? path.win32.isAbsolute(profile)
    : path.posix.isAbsolute(profile)
  if (
    browser === 'firefox' &&
    isAbsolutePath &&
    existsSync(path.join(profile, 'cookies.sqlite'))
  ) {
    return `${browser}:${profile}`
  }

  const profileName = isWindowsPath
    ? path.win32.basename(profile)
    : path.posix.basename(profile)
  return profileName ? `${browser}:${profileName}` : browser
}

const isBilibiliUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes('bilibili.com') || host.includes('b23.tv') || host.includes('bili.tv')
  } catch {
    return false
  }
}

const isTwitchUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.includes('twitch.tv')
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

/**
 * Appends platform-specific filename safety flags.
 */
export const appendPlatformFilenameSafetyArgs = (
  args: string[],
  platform: NodeJS.Platform = process.platform
): void => {
  if (platform === 'win32') {
    args.push('--windows-filenames')
  }

  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    args.push('--trim-filenames', WINDOWS_FILENAME_TRIM_LENGTH)
    return
  }
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

export const resolveFfmpegLocationFromPath = (ffmpegPath: string): string =>
  path.dirname(ffmpegPath)

const BEST_FORMAT_FALLBACK = 'bestvideo+bestaudio/best'

/**
 * Append a best-available fallback so a strict `video+audio` selection
 * degrades instead of hard-failing with "Requested format is not available"
 * (GitHub issue #294). Selectors that already carry a `/` fallback are kept.
 */
const withBestFallback = (selector: string): string =>
  selector.includes('/') ? selector : `${selector}/${BEST_FORMAT_FALLBACK}`

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
    return withBestFallback(`bestvideo+${audioFormat}`)
  }

  if (audioFormat === 'none') {
    return `${format}+none`
  }

  if (!audioFormat || audioFormat === 'best') {
    return `${format}+bestaudio/best`
  }

  return withBestFallback(`${format}+${audioFormat}`)
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
    // GitHub issues #367 and #351 (2): the user-selected container takes
    // precedence over the default. `original` skips the flag entirely so
    // yt-dlp uses its built-in defaults; explicit mp4/mkv/webm forces the
    // chosen container and remuxes single-source files when possible.
    // GitHub issues #207 and #129: `auto` keeps the mp4/mkv fallback so
    // ffmpeg muxing failures (HEVC + Hi-Res audio on bilibili, webm
    // fragments on YouTube under proxies, etc.) do not abort the download.
    const container = options.containerFormat ?? 'auto'
    if (container === 'auto') {
      args.push('--merge-output-format', 'mp4/mkv')
    } else if (container !== 'original') {
      args.push('--merge-output-format', container)
      args.push('--remux-video', container)
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
  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  const cookiesPath = trim(settings.cookiesPath)
  const hasSubtitleAuth =
    (browserForCookies && browserForCookies !== 'none') || Boolean(cookiesPath)
  // GitHub issue #370: Twitch exposes the `rechat` chat-replay as a subtitle
  // track that frequently 404s; forcing `--write-subs` then aborts the whole
  // VOD. Like Bilibili, skip forced subtitles for Twitch unless the user has
  // provided cookies that may unlock real subtitle tracks.
  const shouldAttemptSubtitles =
    (!isBilibiliUrl(options.url) && !isTwitchUrl(options.url)) || hasSubtitleAuth

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

  appendPlatformFilenameSafetyArgs(args)
  appendNetworkResilienceArgs(args)

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

  // GitHub issues #355 / #325: cap info-fetch socket waits so a broken DNS
  // or proxy fails fast with a clear error instead of hanging.
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)

  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
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
  // GitHub issue #322: a single unavailable entry (e.g. an age-restricted
  // video in a channel/playlist) must not abort listing the whole playlist.
  const args = ['-J', '--flat-playlist', '--ignore-errors', '--no-warnings', '--encoding', 'utf-8']

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  // GitHub issues #355 / #325: cap info-fetch socket waits so a broken DNS
  // or proxy fails fast with a clear error instead of hanging.
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)

  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
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
