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
import { createBoundedTextBuffer } from './bounded-output-buffer'
import { buildPlaylistInfoArgs, buildVideoInfoArgs, formatYtDlpCommand } from './command-utils'
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

export const fetchVideoInfo = async (url: string): Promise<VideoInfo> => {
  const ytdlp = ytdlpManager.getInstance()
  const args = buildVideoInfoArgs(url, settingsManager.getAll())
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
          resolve({ info: inflateEstimatedSizes(parseVideoInfoPayload(out)), ytDlpCommand })
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

export const fetchPlaylistInfo = async (url: string): Promise<PlaylistInfo> => {
  const ytdlp = ytdlpManager.getInstance()
  const args = buildPlaylistInfoArgs(url, settingsManager.getAll())
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
}
