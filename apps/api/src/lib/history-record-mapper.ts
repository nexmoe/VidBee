import type { DownloadHistoryInsert, DownloadHistoryRow } from '@vidbee/db/history'
import type { DownloadTask } from '@vidbee/downloader-core'

const TERMINAL_STATUSES = new Set<DownloadTask['status']>(['completed', 'error', 'cancelled'])
const TAG_SEPARATOR = '\n'

const parseJson = <T>(value: string | null | undefined): T | undefined => {
  if (!value) {
    return undefined
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

const sanitizeList = (values?: string[]): string[] => {
  if (!values || values.length === 0) {
    return []
  }
  return values
    .map((value) => value.trim())
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
}

const serializeTags = (values?: string[]): string | null => {
  const sanitized = sanitizeList(values)
  return sanitized.length > 0 ? sanitized.join(TAG_SEPARATOR) : null
}

const parseTags = (value: string | null): string[] | undefined => {
  if (!value) {
    return undefined
  }
  const parsed = value
    .split(TAG_SEPARATOR)
    .map((tag) => tag.trim())
    .filter((tag, index, array) => tag.length > 0 && array.indexOf(tag) === index)
  return parsed.length > 0 ? parsed : undefined
}

export const isTerminalTask = (task: DownloadTask): boolean => TERMINAL_STATUSES.has(task.status)

export const serializeHistoryTask = (task: DownloadTask): DownloadHistoryInsert => {
  const downloadedAt = task.createdAt
  const completedAt = task.completedAt ?? null
  const sortKey = completedAt ?? downloadedAt

  return {
    id: task.id,
    url: task.url,
    title: task.title ?? task.url,
    thumbnail: task.thumbnail ?? null,
    type: task.type,
    status: task.status,
    downloadPath: task.downloadPath ?? null,
    savedFileName: task.savedFileName ?? null,
    fileSize: task.fileSize ?? null,
    duration: task.duration ?? null,
    downloadedAt,
    completedAt,
    sortKey,
    error: task.error ?? null,
    ytDlpCommand: task.ytDlpCommand ?? null,
    ytDlpLog: task.ytDlpLog ?? null,
    description: task.description ?? null,
    channel: task.channel ?? null,
    uploader: task.uploader ?? null,
    viewCount: task.viewCount ?? null,
    tags: serializeTags(task.tags),
    origin: null,
    subscriptionId: null,
    selectedFormat: task.selectedFormat ? JSON.stringify(task.selectedFormat) : null,
    playlistId: task.playlistId ?? null,
    playlistTitle: task.playlistTitle ?? null,
    playlistIndex: task.playlistIndex ?? null,
    playlistSize: task.playlistSize ?? null
  }
}

export const mapHistoryRowToTask = (row: DownloadHistoryRow): DownloadTask => {
  const parsedTags = parseTags(row.tags ?? null)
  const parsedSelectedFormat = parseJson<DownloadTask['selectedFormat']>(row.selectedFormat)

  return {
    id: row.id,
    url: row.url,
    title: row.title,
    thumbnail: row.thumbnail ?? undefined,
    type: row.type as DownloadTask['type'],
    status: row.status as DownloadTask['status'],
    createdAt: row.downloadedAt,
    completedAt: row.completedAt ?? undefined,
    downloadPath: row.downloadPath ?? undefined,
    savedFileName: row.savedFileName ?? undefined,
    fileSize: row.fileSize ?? undefined,
    duration: row.duration ?? undefined,
    error: row.error ?? undefined,
    ytDlpCommand: row.ytDlpCommand ?? undefined,
    ytDlpLog: row.ytDlpLog ?? undefined,
    description: row.description ?? undefined,
    channel: row.channel ?? undefined,
    uploader: row.uploader ?? undefined,
    viewCount: row.viewCount ?? undefined,
    tags: parsedTags,
    selectedFormat: parsedSelectedFormat,
    playlistId: row.playlistId ?? undefined,
    playlistTitle: row.playlistTitle ?? undefined,
    playlistIndex: row.playlistIndex ?? undefined,
    playlistSize: row.playlistSize ?? undefined
  }
}
