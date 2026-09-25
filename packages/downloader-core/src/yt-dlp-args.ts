import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseBrowserCookiesSetting } from './browser-cookies-setting'
import {
  DEFAULT_FILENAME_TEMPLATE,
  type FilenameStyle,
  resolveFilenameTemplate
} from './filename-style'
import type { OneClickContainerOption } from './format-preferences'
import { expandSubtitleLanguageAliases, resolveSubtitleLanguages } from './subtitle-languages'

export interface YtDlpDownloadSettings {
  downloadPath?: string
  browserForCookies?: string
  cookiesPath?: string
  proxy?: string
  configPath?: string
  downloadSubtitles?: boolean
  subtitleLanguages?: string[]
  interfaceLanguage?: string
  embedSubs?: boolean
  writeAutoSubs?: boolean
  embedThumbnail?: boolean
  embedMetadata?: boolean
  embedChapters?: boolean
  filenameStyle?: FilenameStyle
  filenameViaVidBee?: boolean
  shareWatermark?: boolean
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
const BILIBILI_AUTO_SUBTITLE_PREFIX = 'ai-'
// GitHub issue #359: drop only the bare `web` client (which requires a PO
// token and frequently 403s) but keep `web_safari` and the other defaults so
// extraction has more fallbacks before failing.
const YOUTUBE_SAFE_PLAYER_CLIENTS = 'default,-web'
export const VIDBEE_OUTPUT_PATH_PREFIX = '__VIDBEE_OUTPUT_PATH__:'
const WINDOWS_FILENAME_TRIM_LENGTH = '120'
const DIRECT_MEDIA_SEGMENT_EXTENSION = /\.(?:cmfa|cmfv|m4s)(?:$|[?#])/i

// GitHub issues #326, #355, #325: yt-dlp's default of 10 retries and no
// socket timeout left users with `Giving up after N retries` and DNS hangs
// on flaky networks. Push the defaults up and add a short backoff so a
// single transient failure does not abort the whole download.
const DEFAULT_RETRIES = '30'
const DEFAULT_FRAGMENT_RETRIES = '30'
const DEFAULT_EXTRACTOR_RETRIES = '10'
const DEFAULT_RETRY_SLEEP = '2'
const DEFAULT_SOCKET_TIMEOUT = '30'

/**
 * Resolve canonical, regional, and Bilibili AI subtitle language tags.
 *
 * yt-dlp exposes Bilibili AI captions as regular subtitle tracks such as `ai-zh`,
 * so `--write-auto-subs` alone cannot select them. Common extractor aliases are
 * always included; Bilibili AI aliases are added only while automatic captions are on.
 */
const resolveDownloadSubtitleLanguages = (
  languages: readonly string[],
  isBilibili: boolean,
  writeAutoSubs: boolean
): string[] => {
  const resolved = new Map(
    expandSubtitleLanguageAliases(languages).map((language) => [language.toLowerCase(), language])
  )
  if (isBilibili && writeAutoSubs) {
    for (const language of languages) {
      if (language.toLowerCase().startsWith(BILIBILI_AUTO_SUBTITLE_PREFIX)) {
        continue
      }
      const primaryLanguage = language.split('-')[0]?.toLowerCase()
      if (primaryLanguage) {
        const automaticLanguage = `${BILIBILI_AUTO_SUBTITLE_PREFIX}${primaryLanguage}`
        resolved.set(automaticLanguage, automaticLanguage)
      }
    }
  }

  return [...resolved.values()]
}

const appendNetworkResilienceArgs = (args: string[]): void => {
  args.push('--retries', DEFAULT_RETRIES)
  args.push('--fragment-retries', DEFAULT_FRAGMENT_RETRIES)
  args.push('--extractor-retries', DEFAULT_EXTRACTOR_RETRIES)
  args.push('--retry-sleep', DEFAULT_RETRY_SLEEP)
  args.push('--retry-sleep', `extractor:${DEFAULT_RETRY_SLEEP}`)
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)
}

/** Add bounded retries to metadata probes without fragment-only flags. */
const appendMetadataNetworkResilienceArgs = (args: string[]): void => {
  args.push('--retries', DEFAULT_RETRIES)
  args.push('--extractor-retries', DEFAULT_EXTRACTOR_RETRIES)
  args.push('--retry-sleep', DEFAULT_RETRY_SLEEP)
  args.push('--retry-sleep', `extractor:${DEFAULT_RETRY_SLEEP}`)
  args.push('--socket-timeout', DEFAULT_SOCKET_TIMEOUT)
}

export const METADATA_NETWORK_ATTEMPTS = 3
export const METADATA_NETWORK_RETRY_DELAY_MS = 1000

/**
 * Return whether a yt-dlp failure is a truncated or timed-out HTTP read.
 *
 * Extractor webpage/JSON reads do not honor `--retries`. IncompleteRead and
 * read timeouts therefore fail a `-j` probe unless the whole process is retried.
 */
export const isTransientYtDlpNetworkError = (error: string): boolean => {
  const normalized = error.toLowerCase()
  return (
    normalized.includes('incompleteread') ||
    normalized.includes('error reading response') ||
    normalized.includes('read timed out') ||
    normalized.includes('connection reset') ||
    normalized.includes('connection aborted') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnaborted')
  )
}

/**
 * Return a string message from an unknown thrown value.
 */
const networkErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Sleep for the metadata retry backoff.
 */
const delayMetadataRetry = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Retry a yt-dlp metadata probe when the site truncates or times out the HTTP body.
 */
export const retryTransientYtDlpNetworkError = async <T>(
  run: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = delayMetadataRetry
): Promise<T> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= METADATA_NETWORK_ATTEMPTS; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      lastError = error
      const canRetry =
        attempt < METADATA_NETWORK_ATTEMPTS &&
        isTransientYtDlpNetworkError(networkErrorMessage(error))
      if (!canRetry) {
        throw error
      }
      await sleep(METADATA_NETWORK_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

const hasYouTubeHost = (host: string): boolean =>
  YOUTUBE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

const trim = (value?: string | null): string => value?.trim() ?? ''

/** Remove trailing Windows-invalid dots and spaces in linear time. */
const trimWindowsFilenameSegmentEnd = (value: string): string => {
  let end = value.length
  while (end > 0) {
    const characterCode = value.charCodeAt(end - 1)
    if (characterCode !== 32 && characterCode !== 46) {
      break
    }
    end -= 1
  }
  return value.slice(0, end)
}

/** Convert a seconds, MM:SS, or HH:MM:SS timecode to seconds. */
export const parseDownloadTimecode = (value: string): number | null => {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const parts = normalized.split(':')
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    return null
  }

  const numericParts = parts.map(Number)
  if (numericParts.some((part) => !Number.isFinite(part))) {
    return null
  }
  if (parts.length > 1 && numericParts.slice(1).some((part) => part >= 60)) {
    return null
  }

  return numericParts.reduce((total, part) => total * 60 + part, 0)
}

/** Validate optional time-range values before passing them to yt-dlp. */
export const validateDownloadTimeRange = (startTime?: string, endTime?: string): void => {
  const start = trim(startTime)
  const end = trim(endTime)
  const startSeconds = start ? parseDownloadTimecode(start) : 0
  const endSeconds = end ? parseDownloadTimecode(end) : null

  if (start && startSeconds === null) {
    throw new Error('Invalid start time. Use seconds, MM:SS, or HH:MM:SS.')
  }
  if (end && endSeconds === null) {
    throw new Error('Invalid end time. Use seconds, MM:SS, or HH:MM:SS.')
  }
  if (endSeconds !== null && startSeconds !== null && endSeconds <= startSeconds) {
    throw new Error('End time must be later than start time.')
  }
}

/**
 * Return whether a URL points at a single DASH media segment instead of a
 * page or manifest that yt-dlp can resolve into a complete download.
 */
export const isDirectMediaSegmentUrl = (value: string): boolean =>
  DIRECT_MEDIA_SEGMENT_EXTENSION.test(value.trim())

/** Reject bare media-segment URLs with guidance that is useful in every host. */
export const assertDownloadSourceUrl = (value: string): void => {
  if (isDirectMediaSegmentUrl(value)) {
    throw new Error(
      'This URL points to a single media segment. Paste the original video page URL instead.'
    )
  }
}

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
  if (browser === 'firefox' && isAbsolutePath && existsSync(path.join(profile, 'cookies.sqlite'))) {
    return `${browser}:${profile}`
  }

  const profileName = isWindowsPath ? path.win32.basename(profile) : path.posix.basename(profile)
  return profileName ? `${browser}:${profileName}` : browser
}

/** Return whether a host is the domain itself or one of its subdomains. */
const hostMatchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

/** Return whether a URL uses a Bilibili-owned video domain. */
const isBilibiliUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return ['bilibili.com', 'b23.tv', 'bili.tv'].some((domain) => hostMatchesDomain(host, domain))
  } catch {
    return false
  }
}

/** Return whether a URL uses a Twitch domain. */
const isTwitchUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hostMatchesDomain(host, 'twitch.tv')
  } catch {
    return false
  }
}

/** Return whether a URL uses a TikTok domain. */
const isTikTokUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hostMatchesDomain(host, 'tiktok.com')
  } catch {
    return false
  }
}

export type SubtitleDownloadSkipReason = 'auth-required' | 'automatic-captions-disabled'

/**
 * Explain why a requested video subtitle download must be skipped before yt-dlp starts.
 *
 * @param options Download source and media type.
 * @param settings Effective runtime subtitle and authentication settings.
 * @returns A stable skip reason, or null when subtitle arguments should be emitted.
 */
export const resolveSubtitleDownloadSkipReason = (
  options: Pick<YtDlpDownloadOptions, 'type' | 'url'>,
  settings: YtDlpDownloadSettings
): SubtitleDownloadSkipReason | null => {
  if (options.type !== 'video' || !(settings.downloadSubtitles ?? true)) {
    return null
  }
  if (isTikTokUrl(options.url) && !(settings.writeAutoSubs ?? true)) {
    return 'automatic-captions-disabled'
  }

  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  const hasSubtitleAuth =
    (browserForCookies && browserForCookies !== 'none') || Boolean(trim(settings.cookiesPath))
  if ((isBilibiliUrl(options.url) || isTwitchUrl(options.url)) && !hasSubtitleAuth) {
    return 'auth-required'
  }

  return null
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

export const sanitizeFilenameTemplate = (
  template: string,
  fallbackTemplate = DEFAULT_FILENAME_TEMPLATE
): string => {
  const trimmed = template.trim()
  if (!trimmed) {
    return fallbackTemplate
  }
  const normalized = trimmed.replace(/\\/g, '/')
  const safeParts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => trimWindowsFilenameSegmentEnd(part.replace(/[<>:"|?*]/g, '-')))
    .filter((part) => part !== '')
  return safeParts.length === 0 ? fallbackTemplate : safeParts.join('/')
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
  assertDownloadSourceUrl(options.url)
  validateDownloadTimeRange(options.startTime, options.endTime)
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

  const startTime = trim(options.startTime)
  const endTime = trim(options.endTime)
  if (startTime || endTime) {
    const start = startTime || '0'
    const end = endTime || ''
    args.push('--download-sections', `*${start}-${end}`)
  }

  const downloadSubtitles = settings.downloadSubtitles ?? true
  const selectedSubtitleLanguages = resolveSubtitleLanguages(
    settings.subtitleLanguages,
    settings.interfaceLanguage
  )
  const embedSubs = settings.embedSubs ?? true
  const writeAutoSubs = settings.writeAutoSubs ?? true
  const embedThumbnail = settings.embedThumbnail ?? false
  const embedMetadata = settings.embedMetadata ?? true
  const embedChapters = settings.embedChapters ?? true
  const browserForCookies = normalizeBrowserCookiesSettingForYtDlp(settings.browserForCookies)
  const cookiesPath = trim(settings.cookiesPath)
  const isBilibili = isBilibiliUrl(options.url)
  const subtitleLanguages = resolveDownloadSubtitleLanguages(
    selectedSubtitleLanguages,
    isBilibili,
    writeAutoSubs
  )
  // GitHub issue #370: Twitch `rechat` 404s abort the VOD. GitHub issue #196:
  // Bilibili subtitle fetch without cookies can fail and abort the video. TikTok
  // exposes its generated captions as normal subtitles, so the automatic-captions
  // switch must gate subtitle fetching there instead of relying on yt-dlp's flag.
  const subtitleSkipReason = resolveSubtitleDownloadSkipReason(options, settings)
  const shouldAttemptSubtitles =
    options.type === 'video' && downloadSubtitles && subtitleSkipReason === null
  // GitHub issues #129, #196, #199, #291, #347: Bilibili lists danmaku as a
  // subtitle track (`danmaku.xml`). ffmpeg cannot mux XML into MP4/MKV and
  // aborts with `Invalid data found when processing input` after the video
  // and audio have already merged. Keep XML/SRT as sidecar files instead.
  const shouldEmbedSubs = embedSubs && shouldAttemptSubtitles && !isBilibili

  if (shouldAttemptSubtitles) {
    args.push('--sub-langs', subtitleLanguages.join(','))
    args.push('--sleep-subtitles', '1')
    // `--embed-subs` only writes official / creator-uploaded captions.
    // YouTube videos often have automatic captions and no official track, so
    // also request those when the setting is on; otherwise the embed step
    // has nothing to mux.
    if (writeAutoSubs) {
      args.push('--write-auto-subs')
    } else {
      args.push('--no-write-auto-subs')
    }
    if (shouldEmbedSubs) {
      args.push('--embed-subs')
    } else {
      args.push('--write-subs')
      args.push('--no-embed-subs')
    }
  } else {
    args.push('--no-write-subs', '--no-write-auto-subs', '--no-embed-subs')
  }

  args.push(embedThumbnail ? '--embed-thumbnail' : '--no-embed-thumbnail')
  args.push(embedMetadata ? '--embed-metadata' : '--no-embed-metadata')
  args.push(embedChapters ? '--embed-chapters' : '--no-embed-chapters')

  const baseDownloadPath =
    trim(options.customDownloadPath) || trim(settings.downloadPath) || fallbackDownloadPath
  const defaultFilenameTemplate = resolveFilenameTemplate(
    settings.filenameStyle,
    options.type,
    settings.shareWatermark,
    settings.filenameViaVidBee
  )
  const filenameTemplate = sanitizeFilenameTemplate(
    options.customFilenameTemplate ?? defaultFilenameTemplate,
    defaultFilenameTemplate
  )
  const safeTemplate = filenameTemplate.replace(/^[\\/]+/, '')
  args.push('-o', path.join(baseDownloadPath, safeTemplate))
  args.push('--continue')
  args.push('--no-playlist-reverse')
  // GitHub issue #447: emit the final post-processed path without suppressing
  // progress output so the executor can stat the exact saved file.
  args.push(
    '--print',
    `after_move:${VIDBEE_OUTPUT_PATH_PREFIX}%(filepath)s`,
    '--print',
    'before_dl:VIDBEE_VISIBILITY:%(availability)s',
    '--print',
    'before_dl:VIDBEE_DURATION:%(duration)s',
    '--no-quiet'
  )

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
    args.push('--ignore-config')
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
  assertDownloadSourceUrl(url)
  const args = ['-j', '--no-playlist', '--no-warnings', '--encoding', 'utf-8']

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  // GitHub issues #289, #355, and #325: metadata requests need the same
  // bounded retry/backoff policy as downloads, not only a socket timeout.
  appendMetadataNetworkResilienceArgs(args)

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
    // GitHub issue #294: an implicit user yt-dlp config can inject a strict
    // format selector into `-j` and make metadata discovery fail.
    args.push('--ignore-config')
    appendYouTubeSafeExtractorArgs(args, url)
  }

  if (jsRuntimeArgs.length > 0) {
    args.push(...jsRuntimeArgs)
  }

  args.push(url)
  return args
}

/**
 * Build a skip-download yt-dlp argv that writes caption sidecars next to an info JSON.
 *
 * @param url Watch URL.
 * @param outputTemplate yt-dlp `-o` template without an extension.
 * @param settings Host cookies, proxy, and config.
 * @param jsRuntimeArgs Active Desktop JS runtime flags.
 * @param subtitleLanguages yt-dlp `--sub-langs` value.
 */
export const buildCaptionExtractArgs = (
  url: string,
  outputTemplate: string,
  settings: YtDlpDownloadSettings,
  jsRuntimeArgs: string[] = [],
  subtitleLanguages = 'all'
): string[] => {
  assertDownloadSourceUrl(url)
  const args = [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--write-info-json',
    '--sub-langs',
    subtitleLanguages || 'all',
    '--sub-format',
    'vtt/srt/ttml/best',
    '--sleep-subtitles',
    '1',
    '--no-playlist',
    '--no-warnings',
    '--encoding',
    'utf-8',
    '-o',
    outputTemplate
  ]

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  appendMetadataNetworkResilienceArgs(args)

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
    args.push('--ignore-config')
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
  assertDownloadSourceUrl(url)
  // GitHub issue #322: a single unavailable entry (e.g. an age-restricted
  // video in a channel/playlist) must not abort listing the whole playlist.
  const args = ['-J', '--flat-playlist', '--ignore-errors', '--no-warnings', '--encoding', 'utf-8']

  const proxy = trim(settings.proxy)
  if (proxy) {
    args.push('--proxy', proxy)
  }

  appendMetadataNetworkResilienceArgs(args)

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
    args.push('--ignore-config')
    appendYouTubeSafeExtractorArgs(args, url)
  }

  if (jsRuntimeArgs.length > 0) {
    args.push(...jsRuntimeArgs)
  }

  args.push(url)
  return args
}
