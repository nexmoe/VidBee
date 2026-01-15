import { atom } from 'jotai'
import type { DownloadHistoryItem, DownloadItem } from '../../../shared/types'

export type DownloadRecord = DownloadItem & {
  entryType: 'active' | 'history'
  downloadedAt?: number
  downloadPath?: string
  savedFileName?: string
}

const recordKey = (entryType: DownloadRecord['entryType'], id: string) => `${entryType}:${id}`

const toActiveRecord = (item: DownloadItem): DownloadRecord => ({
  ...item,
  entryType: 'active'
})

const toHistoryRecord = (item: DownloadHistoryItem): DownloadRecord => ({
  id: item.id,
  url: item.url,
  title: item.title,
  thumbnail: item.thumbnail,
  type: item.type,
  status: item.status,
  progress: undefined,
  error: item.error,
  ytDlpCommand: item.ytDlpCommand,
  downloadPath: item.downloadPath,
  speed: undefined,
  duration: item.duration,
  fileSize: item.fileSize,
  createdAt: item.downloadedAt,
  startedAt: item.downloadedAt,
  completedAt: item.completedAt ?? item.downloadedAt,
  description: item.description,
  channel: item.channel,
  uploader: item.uploader,
  viewCount: item.viewCount,
  tags: item.tags,
  selectedFormat: item.selectedFormat,
  playlistId: item.playlistId,
  playlistTitle: item.playlistTitle,
  playlistIndex: item.playlistIndex,
  playlistSize: item.playlistSize,
  savedFileName: item.savedFileName,
  entryType: 'history',
  downloadedAt: item.downloadedAt
})

export const downloadRecordsAtom = atom<Map<string, DownloadRecord>>(new Map())

export const addDownloadAtom = atom(null, (get, set, item: DownloadItem) => {
  const downloads = new Map(get(downloadRecordsAtom))
  downloads.set(recordKey('active', item.id), toActiveRecord(item))
  set(downloadRecordsAtom, downloads)
})

export const updateDownloadAtom = atom(
  null,
  (get, set, update: { id: string; changes: Partial<DownloadItem> }) => {
    const downloads = new Map(get(downloadRecordsAtom))
    const key = recordKey('active', update.id)
    const existing = downloads.get(key)
    if (!existing) {
      return
    }
    downloads.set(key, { ...existing, ...update.changes })
    set(downloadRecordsAtom, downloads)
  }
)

export const removeDownloadAtom = atom(null, (get, set, id: string) => {
  const downloads = new Map(get(downloadRecordsAtom))
  downloads.delete(recordKey('active', id))
  set(downloadRecordsAtom, downloads)
})

export const clearCompletedAtom = atom(null, (get, set) => {
  const downloads = new Map(get(downloadRecordsAtom))
  for (const [key, item] of downloads.entries()) {
    if (item.entryType === 'active' && item.status === 'completed') {
      downloads.delete(key)
    }
  }
  set(downloadRecordsAtom, downloads)
})

export const addHistoryRecordAtom = atom(null, (get, set, item: DownloadHistoryItem) => {
  const downloads = new Map(get(downloadRecordsAtom))
  downloads.set(recordKey('history', item.id), toHistoryRecord(item))
  set(downloadRecordsAtom, downloads)
})

export const removeHistoryRecordAtom = atom(null, (get, set, id: string) => {
  const downloads = new Map(get(downloadRecordsAtom))
  downloads.delete(recordKey('history', id))
  set(downloadRecordsAtom, downloads)
})

export const removeHistoryRecordsAtom = atom(null, (get, set, ids: string[]) => {
  if (!ids || ids.length === 0) {
    return
  }
  const downloads = new Map(get(downloadRecordsAtom))
  const uniqueIds = Array.from(new Set(ids))
  uniqueIds.forEach((id) => {
    downloads.delete(recordKey('history', id))
  })
  set(downloadRecordsAtom, downloads)
})

export const removeHistoryRecordsByPlaylistAtom = atom(null, (get, set, playlistId: string) => {
  if (!playlistId) {
    return
  }
  const downloads = new Map(get(downloadRecordsAtom))
  for (const [key, item] of downloads.entries()) {
    if (item.entryType === 'history' && item.playlistId === playlistId) {
      downloads.delete(key)
    }
  }
  set(downloadRecordsAtom, downloads)
})

export const clearHistoryRecordsAtom = atom(null, (get, set) => {
  const downloads = new Map(get(downloadRecordsAtom))
  for (const [key, item] of downloads.entries()) {
    if (item.entryType === 'history') {
      downloads.delete(key)
    }
  }
  set(downloadRecordsAtom, downloads)
})

export const clearHistoryRecordsByStatusAtom = atom(
  null,
  (get, set, status: DownloadHistoryItem['status']) => {
    const downloads = new Map(get(downloadRecordsAtom))
    for (const [key, item] of downloads.entries()) {
      if (item.entryType === 'history' && item.status === status) {
        downloads.delete(key)
      }
    }
    set(downloadRecordsAtom, downloads)
  }
)

export const downloadsArrayAtom = atom((get) => {
  const downloads = get(downloadRecordsAtom)
  return Array.from(downloads.values()).sort((a, b) => b.createdAt - a.createdAt)
})

export const activeDownloadsArrayAtom = atom((get) =>
  get(downloadsArrayAtom).filter((item) => item.entryType === 'active')
)

export const historyDownloadsArrayAtom = atom((get) =>
  get(downloadsArrayAtom).filter((item) => item.entryType === 'history')
)

export const historyStatsAtom = atom((get) => {
  const history = get(historyDownloadsArrayAtom)
  return history.reduce(
    (acc, item) => {
      acc.total += 1
      if (item.status === 'completed') acc.completed += 1
      if (item.status === 'error') acc.error += 1
      if (item.status === 'cancelled') acc.cancelled += 1
      return acc
    },
    { total: 0, completed: 0, error: 0, cancelled: 0 }
  )
})

export const downloadStatsAtom = atom((get) => {
  const downloads = get(downloadsArrayAtom)
  return downloads.reduce(
    (acc, item) => {
      acc.total += 1
      if (
        item.entryType === 'active' &&
        (item.status === 'downloading' || item.status === 'processing' || item.status === 'pending')
      ) {
        acc.active += 1
      }
      if (item.status === 'completed') acc.completed += 1
      if (item.status === 'error') acc.error += 1
      if (item.status === 'cancelled') acc.cancelled += 1
      return acc
    },
    { total: 0, active: 0, completed: 0, error: 0, cancelled: 0 }
  )
})

export const activeDownloadsCountAtom = atom((get) => {
  const downloads = get(downloadRecordsAtom)
  let count = 0
  for (const item of downloads.values()) {
    if (
      item.entryType === 'active' &&
      (item.status === 'downloading' || item.status === 'processing')
    ) {
      count++
    }
  }
  return count
})
