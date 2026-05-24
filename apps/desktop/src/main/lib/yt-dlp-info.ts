/**
 * Desktop yt-dlp metadata client (NEX-131 A段).
 *
 * Replaces `downloadEngine.getVideoInfo` / `getVideoInfoWithCommand` /
 * `getPlaylistInfo`, which were the only stateless calls on the legacy
 * download engine. Uses the existing ytdlpManager-bound binary, so
 * cookies/proxy/runtime args stay consistent with the queue executor.
 */

import type { PlaylistInfo, VideoInfo, VideoInfoCommandResult } from '../../shared/types'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { resolvePathWithHome } from '../utils/path-helpers'
import { createBoundedTextBuffer } from './bounded-output-buffer'
import {
  appendJsRuntimeArgs,
  appendYouTubeSafeExtractorArgs,
  buildVideoInfoArgs,
  formatYtDlpCommand
} from './command-utils'
import { ytdlpManager } from './ytdlp-manager'

const logger = scopedLoggers.download

const inflateEstimatedSizes = (info: VideoInfo): VideoInfo => {
  if (!(Array.isArray(info.formats) && info.duration) || info.duration <= 0) {
    return info
  }
  const duration = info.duration
  for (const format of info.formats) {
    if (
      !(format.filesize || format.filesize_approx) &&
      typeof format.tbr === 'number' &&
      format.tbr > 0
    ) {
      format.filesize_approx = Math.round(((format.tbr * 1000) / 8) * duration)
    }
  }
  return info
}

const parseVideoInfoPayload = (stdout: string): VideoInfo => {
  try {
    return JSON.parse(stdout) as VideoInfo
  } catch (error) {
    const firstLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('{') || line.startsWith('['))
    if (!firstLine) {
      throw error
    }
    return JSON.parse(firstLine) as VideoInfo
  }
}

interface RawVideoInfoWithFallbacks extends VideoInfo {
  entries?: RawVideoInfoWithFallbacks[]
  requested_formats?: VideoInfo['formats']
  format_id?: string
  ext?: string
  height?: number
  width?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesize_approx?: number
  format_note?: string
  video_ext?: string
  audio_ext?: string
  tbr?: number
  quality?: number
  protocol?: string
  language?: string
}

const hasFormats = (info: VideoInfo): boolean =>
  Array.isArray(info.formats) && info.formats.length > 0

const normalizeVideoInfo = (info: RawVideoInfoWithFallbacks, fallbackUrl: string): VideoInfo => {
  if (hasFormats(info)) {
    return inflateEstimatedSizes(info)
  }

  const entryWithFormats = info.entries?.find((entry) => hasFormats(entry))
  if (entryWithFormats) {
    return normalizeVideoInfo(entryWithFormats, fallbackUrl)
  }

  const requestedFormats = Array.isArray(info.requested_formats) ? info.requested_formats : []
  if (requestedFormats.length > 0) {
    return inflateEstimatedSizes({
      ...info,
      formats: requestedFormats
    })
  }

  if (info.format_id) {
    return inflateEstimatedSizes({
      ...info,
      formats: [
        {
          format_id: info.format_id,
          ext: info.ext ?? 'unknown',
          height: info.height,
          width: info.width,
          fps: info.fps,
          vcodec: info.vcodec,
          acodec: info.acodec,
          filesize: info.filesize,
          filesize_approx: info.filesize_approx,
          format_note: info.format_note,
          video_ext: info.video_ext,
          audio_ext: info.audio_ext,
          tbr: info.tbr,
          quality: info.quality,
          protocol: info.protocol,
          language: info.language
        }
      ]
    })
  }

  return {
    ...info,
    id: info.id || fallbackUrl,
    title: info.title || fallbackUrl,
    formats: []
  }
}

const buildVideoInfoFallbackArgs = (url: string): string[] => {
  const args = buildVideoInfoArgs(url, settingsManager.getAll())
  const jsonArgIndex = args.indexOf('-j')
  if (jsonArgIndex >= 0) {
    args[jsonArgIndex] = '-J'
  }
  return args
}

const fetchVideoInfoPayload = async (url: string, args: string[]): Promise<VideoInfo> => {
  const ytdlp = ytdlpManager.getInstance()
  return new Promise<VideoInfo>((resolve, reject) => {
    const proc = ytdlp.exec(args)
    const stdout = createBoundedTextBuffer()
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stdout?.on('data', (d: Buffer) => stdout.append(d))
    proc.ytDlpProcess?.stderr?.on('data', (d: Buffer) => stderr.append(d))
    proc.on('close', (code) => {
      const out = stdout.get()
      const err = stderr.get()
      if (code === 0 && out) {
        try {
          resolve(normalizeVideoInfo(parseVideoInfoPayload(out) as RawVideoInfoWithFallbacks, url))
        } catch (error) {
          reject(new Error(`Failed to parse video info: ${error}`))
        }
        return
      }
      logger.error('Failed to fetch video info for:', url, 'exit', code, err)
      reject(new Error(err || 'Failed to fetch video info'))
    })
    proc.on('error', reject)
  })
}

export const fetchVideoInfo = async (url: string): Promise<VideoInfo> => {
  const args = buildVideoInfoArgs(url, settingsManager.getAll())
  const info = await fetchVideoInfoPayload(url, args)
  if (hasFormats(info)) {
    return info
  }
  return fetchVideoInfoPayload(url, buildVideoInfoFallbackArgs(url))
}

export const fetchVideoInfoWithCommand = async (url: string): Promise<VideoInfoCommandResult> => {
  const args = buildVideoInfoArgs(url, settingsManager.getAll())
  const ytDlpCommand = formatYtDlpCommand(args)
  return new Promise<VideoInfoCommandResult>((resolve) => {
    const ytdlp = ytdlpManager.getInstance()
    const proc = ytdlp.exec(args)
    const stdout = createBoundedTextBuffer()
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stdout?.on('data', (d: Buffer) => stdout.append(d))
    proc.ytDlpProcess?.stderr?.on('data', (d: Buffer) => stderr.append(d))
    proc.on('close', (code) => {
      const out = stdout.get()
      const err = stderr.get()
      if (code === 0 && out) {
        try {
          const info = normalizeVideoInfo(
            parseVideoInfoPayload(out) as RawVideoInfoWithFallbacks,
            url
          )
          if (hasFormats(info)) {
            resolve({ info, ytDlpCommand })
            return
          }
          fetchVideoInfoPayload(url, buildVideoInfoFallbackArgs(url))
            .then((fallbackInfo) => {
              resolve({ info: fallbackInfo, ytDlpCommand })
            })
            .catch((error) => {
              resolve({
                info,
                ytDlpCommand,
                error: error instanceof Error ? error.message : String(error)
              })
            })
          return
        } catch (error) {
          resolve({
            ytDlpCommand,
            error: `Failed to parse video info: ${error instanceof Error ? error.message : error}`
          })
          return
        }
      }
      resolve({ ytDlpCommand, error: err || 'Failed to fetch video info' })
    })
    proc.on('error', (error) => {
      resolve({
        ytDlpCommand,
        error: error instanceof Error ? error.message : 'Failed to fetch video info'
      })
    })
  })
}

interface RawPlaylistEntry {
  id?: string
  title?: string
  url?: string
  webpage_url?: string
  original_url?: string
  ie_key?: string
}

const resolveEntryUrl = (entry: RawPlaylistEntry): string => {
  if (entry.url?.startsWith('http')) {
    return entry.url
  }
  if (entry.webpage_url) {
    return entry.webpage_url
  }
  if (entry.original_url) {
    return entry.original_url
  }
  if (!entry.url) {
    return entry.id ?? ''
  }
  const ie = entry.ie_key?.toLowerCase() ?? ''
  if (ie.includes('youtubemusic')) {
    return `https://music.youtube.com/watch?v=${entry.url}`
  }
  if (ie.includes('youtube')) {
    return `https://www.youtube.com/watch?v=${entry.url}`
  }
  return entry.id ?? ''
}

const PLAYLIST_FIELD_SEPARATOR = '\t'
const PLAYLIST_LINE_TEMPLATE = [
  '%(playlist_id|)s',
  '%(playlist_title|)s',
  '%(playlist_index|)s',
  '%(id|)s',
  '%(title|)s',
  '%(url|)s',
  '%(webpage_url|)s',
  '%(original_url|)s',
  '%(ie_key|)s'
].join(PLAYLIST_FIELD_SEPARATOR)

const buildPlaylistArgs = (url: string): string[] => {
  const settings = settingsManager.getAll()
  const args: string[] = [
    '--flat-playlist',
    '--no-warnings',
    '--encoding',
    'utf-8',
    '--socket-timeout',
    '30',
    '--print',
    PLAYLIST_LINE_TEMPLATE
  ]
  if (settings.proxy) {
    args.push('--proxy', settings.proxy)
  }
  if (settings.browserForCookies && settings.browserForCookies !== 'none') {
    args.push('--cookies-from-browser', settings.browserForCookies)
  }
  const cookiesPath = settings.cookiesPath?.trim()
  if (cookiesPath) {
    args.push('--cookies', cookiesPath)
  }
  const configPath = resolvePathWithHome(settings.configPath)
  if (configPath) {
    args.push('--config-location', configPath)
  } else {
    appendYouTubeSafeExtractorArgs(args, url)
  }
  appendJsRuntimeArgs(args)
  args.push(url)
  return args
}

const parsePlaylistIndex = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const normalizePrintedPlaylistField = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? ''
  return trimmed === 'NA' ? '' : trimmed
}

const parsePrintedPlaylistInfo = (stdout: string, fallbackUrl: string): PlaylistInfo => {
  const entries: PlaylistInfo['entries'] = []
  let playlistId = ''
  let playlistTitle = ''

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    const [
      rawPlaylistId,
      rawPlaylistTitle,
      rawIndex,
      rawId,
      rawTitle,
      rawUrl,
      rawWebpageUrl,
      rawOriginalUrl,
      rawIeKey
    ] = line.replace(/\r$/, '').split(PLAYLIST_FIELD_SEPARATOR)

    playlistId ||= normalizePrintedPlaylistField(rawPlaylistId)
    playlistTitle ||= normalizePrintedPlaylistField(rawPlaylistTitle)

    const id = normalizePrintedPlaylistField(rawId) || `${entries.length}`
    const entryUrl = resolveEntryUrl({
      id,
      title: normalizePrintedPlaylistField(rawTitle),
      url: normalizePrintedPlaylistField(rawUrl),
      webpage_url: normalizePrintedPlaylistField(rawWebpageUrl),
      original_url: normalizePrintedPlaylistField(rawOriginalUrl),
      ie_key: normalizePrintedPlaylistField(rawIeKey)
    })

    if (!entryUrl) {
      continue
    }

    entries.push({
      id,
      title: normalizePrintedPlaylistField(rawTitle) || `Entry ${entries.length + 1}`,
      url: entryUrl,
      index: parsePlaylistIndex(rawIndex, entries.length + 1)
    })
  }

  return {
    id: playlistId || fallbackUrl,
    title: playlistTitle || 'Playlist',
    entries,
    entryCount: entries.length
  }
}

export const fetchPlaylistInfo = async (url: string): Promise<PlaylistInfo> => {
  const ytdlp = ytdlpManager.getInstance()
  const args = buildPlaylistArgs(url)
  return new Promise<PlaylistInfo>((resolve, reject) => {
    const proc = ytdlp.exec(args)
    const stdout = createBoundedTextBuffer()
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stdout?.on('data', (d: Buffer) => stdout.append(d))
    proc.ytDlpProcess?.stderr?.on('data', (d: Buffer) => stderr.append(d))
    proc.on('close', (code) => {
      const out = stdout.get()
      const err = stderr.get()
      if (code === 0 && out) {
        try {
          resolve(parsePrintedPlaylistInfo(out, url))
          return
        } catch (error) {
          reject(new Error(`Failed to parse playlist info: ${error}`))
          return
        }
      }
      logger.error('Failed to fetch playlist info for:', url, 'exit', code, err)
      reject(new Error(err || 'Failed to fetch playlist info'))
    })
    proc.on('error', reject)
  })
}
