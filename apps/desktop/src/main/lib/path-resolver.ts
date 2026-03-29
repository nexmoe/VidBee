import fs from 'node:fs'
import path from 'node:path'
import type { PlaylistInfo, VideoInfo } from '../../shared/types'
import { sanitizeFilenameTemplate } from '../download-engine/args-builder'
import { scopedLoggers } from '../utils/logger'

const INVALID_VARIATION_SELECTOR_REGEX = /[\ufe00-\ufe0f]/gu
const INVALID_PATH_SEGMENT_PUNCTUATION_REGEX = /[\\/:*?"<>|]+/g

/**
 * Returns whether a code point is unsafe inside a path segment.
 */
const isInvalidPathCodePoint = (codePoint: number): boolean => {
  if (codePoint <= 0x1f) {
    return true
  }
  if (codePoint >= 0x7f && codePoint <= 0x9f) {
    return true
  }
  return codePoint >= 0xff_f0 && codePoint <= 0xff_ff
}

/**
 * Ensures a target directory exists before writing files into it.
 */
export const ensureDirectoryExists = (dir?: string): void => {
  if (!dir) {
    return
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    scopedLoggers.download.error('Failed to ensure download directory:', error)
  }
}

/**
 * Normalizes user-derived path segments so they remain valid on desktop filesystems.
 */
const sanitizePathSegment = (value: string): string => {
  const filtered = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && !isInvalidPathCodePoint(codePoint)
    })
    .join('')

  return filtered
    .replace(INVALID_VARIATION_SELECTOR_REGEX, '')
    .replace(INVALID_PATH_SEGMENT_PUNCTUATION_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

/**
 * Sanitizes a folder name generated from remote metadata.
 */
export const sanitizeFolderName = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  const sanitized = sanitizePathSegment(trimmed)
  return sanitized || fallback
}

/**
 * Sanitizes a template value before interpolating it into a download path.
 */
export const sanitizeTemplateValue = (value: string): string => sanitizePathSegment(value)

const resolveTemplateToken = (token: string, info?: VideoInfo): string | undefined => {
  if (!info) {
    return undefined
  }
  switch (token) {
    case 'uploader':
      return info.uploader
    case 'title':
      return info.title
    case 'id':
      return info.id
    case 'channel':
      return info.uploader
    case 'extractor':
      return info.extractor_key
    default:
      return undefined
  }
}

export const isLikelyChannelUrl = (url: string): boolean => {
  const normalized = url.toLowerCase()
  if (normalized.includes('list=')) {
    return false
  }
  return /youtube\.com\/(channel\/|c\/|user\/|@)/.test(normalized)
}

export const resolveAutoPlaylistDownloadPath = (
  basePath: string,
  info: PlaylistInfo,
  url: string
): string => {
  const kindFolder = isLikelyChannelUrl(url) ? 'Channels' : 'Playlists'
  const title = sanitizeFolderName(
    info.title || (kindFolder === 'Channels' ? 'Channel' : 'Playlist'),
    kindFolder === 'Channels' ? 'Channel' : 'Playlist'
  )
  return path.join(basePath, kindFolder, title)
}

export const resolveAutoVideoDownloadPath = (basePath: string, info?: VideoInfo): string => {
  const root = path.join(basePath, 'Videos')
  if (!info) {
    return root
  }
  const label = info.uploader?.trim() || info.title?.trim()
  if (!label) {
    return root
  }
  return path.join(root, sanitizeFolderName(label, 'Video'))
}

export const resolveHistoryDownloadPath = (
  basePath: string,
  filenameTemplate?: string,
  info?: VideoInfo
): string => {
  if (!filenameTemplate?.trim()) {
    return basePath
  }
  const safeTemplate = sanitizeFilenameTemplate(filenameTemplate)
  const resolvedTemplate = safeTemplate.replace(/%\(([^)]+)\)s/g, (match, token) => {
    const value = resolveTemplateToken(token, info)
    if (!value) {
      return match
    }
    return sanitizeTemplateValue(value)
  })
  const templateDir = path.posix.dirname(resolvedTemplate)
  if (templateDir === '.' || templateDir === '/') {
    return basePath
  }
  if (/%\([^)]+\)s/.test(templateDir)) {
    return basePath
  }
  return path.join(basePath, templateDir)
}
