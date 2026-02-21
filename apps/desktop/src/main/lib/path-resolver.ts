import fs from 'node:fs'
import path from 'node:path'
import type { PlaylistInfo, VideoInfo } from '../../shared/types'
import { sanitizeFilenameTemplate } from '../download-engine/args-builder'
import { scopedLoggers } from '../utils/logger'

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

export const sanitizeFolderName = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (!trimmed) {
    return fallback
  }
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return sanitized || fallback
}

export const sanitizeTemplateValue = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

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
