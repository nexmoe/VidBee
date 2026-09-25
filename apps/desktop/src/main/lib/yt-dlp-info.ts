/**
 * Desktop yt-dlp metadata client (NEX-131 A段).
 *
 * Replaces `downloadEngine.getVideoInfo` / `getVideoInfoWithCommand` /
 * `getPlaylistInfo`, which were the only stateless calls on the legacy
 * download engine. Uses the existing ytdlpManager-bound binary, so
 * cookies/proxy/runtime args stay consistent with the queue executor.
 */

import { retryTransientYtDlpNetworkError } from '@vidbee/downloader-core'
import type { PlaylistInfo, VideoInfo, VideoInfoCommandResult } from '../../shared/types'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { createBoundedTextBuffer } from './bounded-output-buffer'
import { probeConfiguredBrowserCookieAccess } from './browser-cookie-access'
import { buildPlaylistInfoArgs, buildVideoInfoArgs, formatYtDlpCommand } from './command-utils'
import { applyExtensionCookieSettings } from './extension-cookies'
import { ytdlpManager } from './ytdlp-manager'

/**
 * Return a cookie-permission error when macOS blocks the configured browser.
 */
const cookieAccessError = (): string | null =>
  probeConfiguredBrowserCookieAccess(settingsManager.getAll().browserForCookies)

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

/**
 * Run one yt-dlp `-j` probe and parse the resulting video info payload.
 */
const execVideoInfo = (url: string, args: string[], signal?: AbortSignal): Promise<VideoInfo> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const instance = ytdlpManager.getInstance()
    const proc = signal ? instance.exec(args, {}, signal) : instance.exec(args)
    const stdout = createBoundedTextBuffer()
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stdout?.on('data', (d: Buffer) => stdout.append(d))
    proc.ytDlpProcess?.stderr?.on('data', (d: Buffer) => stderr.append(d))
    proc.on('close', (code) => {
      const out = stdout.get()
      const err = stderr.get()
      if (code === 0 && out) {
        try {
          resolve(inflateEstimatedSizes(parseVideoInfoPayload(out)))
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

/**
 * Merge live extension cookies into the current app settings when available.
 *
 * @param url Download or metadata URL.
 */
const settingsForUrl = async (url: string) => {
  const settings = settingsManager.getAll()
  const overlay = await applyExtensionCookieSettings(url, {
    browserForCookies: settings.browserForCookies,
    cookiesPath: settings.cookiesPath
  })
  return overlay ? { ...settings, ...overlay } : settings
}

export const fetchVideoInfo = async (url: string, signal?: AbortSignal): Promise<VideoInfo> => {
  const settings = await settingsForUrl(url)
  if (settings.browserForCookies && settings.browserForCookies !== 'none') {
    const blocked = cookieAccessError()
    if (blocked) {
      throw new Error(blocked)
    }
  }
  const args = buildVideoInfoArgs(url, settings)
  return retryTransientYtDlpNetworkError(() => execVideoInfo(url, args, signal))
}

export const fetchVideoInfoWithCommand = async (url: string): Promise<VideoInfoCommandResult> => {
  const settings = await settingsForUrl(url)
  const args = buildVideoInfoArgs(url, settings)
  const ytDlpCommand = formatYtDlpCommand(args)
  if (settings.browserForCookies && settings.browserForCookies !== 'none') {
    const blocked = cookieAccessError()
    if (blocked) {
      return { error: blocked, ytDlpCommand }
    }
  }
  try {
    const info = await retryTransientYtDlpNetworkError(() => execVideoInfo(url, args))
    return { info, ytDlpCommand }
  } catch (error) {
    return {
      ytDlpCommand,
      error: error instanceof Error ? error.message : 'Failed to fetch video info'
    }
  }
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

/**
 * Run one yt-dlp playlist listing probe.
 */
const execPlaylistInfo = (
  url: string,
  args: string[],
  signal?: AbortSignal
): Promise<PlaylistInfo> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const instance = ytdlpManager.getInstance()
    const proc = signal ? instance.exec(args, {}, signal) : instance.exec(args)
    const stdout = createBoundedTextBuffer()
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stdout?.on('data', (d: Buffer) => stdout.append(d))
    proc.ytDlpProcess?.stderr?.on('data', (d: Buffer) => stderr.append(d))
    proc.on('close', (code) => {
      const out = stdout.get()
      const err = stderr.get()
      if (code === 0 && out) {
        try {
          const parsed = JSON.parse(out) as {
            id?: string
            title?: string
            entries?: RawPlaylistEntry[]
          }
          const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : []
          const entries = rawEntries
            .map((entry, i) => ({
              id: entry.id || `${i}`,
              title: entry.title || `Entry ${i + 1}`,
              url: resolveEntryUrl(entry),
              index: i + 1
            }))
            .filter((e) => e.url.length > 0)
          resolve({
            id: parsed.id || url,
            title: parsed.title || 'Playlist',
            entries,
            entryCount: entries.length
          })
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

export const fetchPlaylistInfo = async (
  url: string,
  signal?: AbortSignal
): Promise<PlaylistInfo> => {
  const settings = await settingsForUrl(url)
  if (settings.browserForCookies && settings.browserForCookies !== 'none') {
    const blocked = cookieAccessError()
    if (blocked) {
      throw new Error(blocked)
    }
  }
  const args = buildPlaylistInfoArgs(url, settings)
  return retryTransientYtDlpNetworkError(() => execPlaylistInfo(url, args, signal))
}
