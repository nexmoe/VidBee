import { atom } from 'jotai'
import type { DownloadHistoryItem, DownloadItem } from '../../../shared/types'
import { removePlaybackPlaylistItemsAtom } from './transcript-playlist'

export type DownloadRecord = DownloadItem & {
  entryType: 'active' | 'history'
  downloadedAt?: number
  downloadPath?: string
  savedFileName?: string
}

const isFinalStatus = (status: DownloadHistoryItem['status']): boolean =>
  status === 'completed' || status === 'error' || status === 'cancelled'

const recordKey = (entryType: DownloadRecord['entryType'], id: string) => `${entryType}:${id}`

const toActiveRecord = (item: DownloadItem): DownloadRecord => ({
  ...item,
  entryType: 'active'
})

/** Preserve recorded lifecycle times without inventing missing history timestamps. */
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
  ytDlpLog: item.ytDlpLog,
  downloadPath: item.downloadPath,
  speed: undefined,
  duration: item.duration,
  fileSize: item.fileSize,
  createdAt: item.createdAt ?? item.downloadedAt,
  startedAt: item.startedAt,
  completedAt: item.completedAt,
  description: item.description,
  channel: item.channel,
  uploader: item.uploader,
  viewCount: item.viewCount,
  tags: item.tags,
  origin: item.origin,
  agentConversation: item.agentConversation,
  parentId: item.parentId,
  taskKind: item.taskKind,
  subscriptionId: item.subscriptionId,
  selectedFormat: item.selectedFormat,
  playlistId: item.playlistId,
  playlistTitle: item.playlistTitle,
  playlistIndex: item.playlistIndex,
  playlistSize: item.playlistSize,
  savedFileName: item.savedFileName,
  resolvedFormatId: item.resolvedFormatId,
  subtitleStatus: item.subtitleStatus,
  subtitleLanguages: item.subtitleLanguages,
  entryType: 'history',
  downloadedAt: item.downloadedAt
})

export const downloadRecordsAtom = atom<Map<string, DownloadRecord>>(new Map())

export const addDownloadAtom = atom(null, (get, set, item: DownloadItem) => {
  const downloads = new Map(get(downloadRecordsAtom))
  downloads.delete(recordKey('history', item.id))
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
    // The facade emits the full projected DownloadItem on snapshot-changed,
    // so an undefined `title`/`thumbnail`/etc. (when the kernel doesn't have
    // metadata stashed on TaskInput) would otherwise stomp the optimistic
    // row. Filter undefined so existing values stick around. status/error
    // can still be set explicitly via narrow `changes` from `handleStarted`/
    // `handleCompleted`/`handleError`.
    const filtered = Object.fromEntries(
      Object.entries(update.changes).filter(([, value]) => value !== undefined)
    ) as Partial<DownloadItem>
    downloads.set(key, { ...existing, ...filtered })
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
  const activeKey = recordKey('active', item.id)
  if (downloads.has(activeKey)) {
    if (!isFinalStatus(item.status)) {
      set(downloadRecordsAtom, downloads)
      return
    }
    downloads.delete(activeKey)
  }
  downloads.set(recordKey('history', item.id), toHistoryRecord(item))
  set(downloadRecordsAtom, downloads)
})

/** Remove downloads from history and the persisted playback playlist together. */
export const removeHistoryRecordsAtom = atom(null, (get, set, ids: string[]) => {
  if (ids.length === 0) {
    return
  }
  const downloads = new Map(get(downloadRecordsAtom))
  for (const id of ids) {
    downloads.delete(recordKey('history', id))
  }
  set(downloadRecordsAtom, downloads)
  set(removePlaybackPlaylistItemsAtom, ids)
})

/** Remove one history record through the shared playlist cleanup path. */
export const removeHistoryRecordAtom = atom(null, (_get, set, id: string) => {
  set(removeHistoryRecordsAtom, [id])
})

/** Remove all history records belonging to a downloaded playlist. */
export const removeHistoryRecordsByPlaylistAtom = atom(null, (get, set, playlistId: string) => {
  if (!playlistId) {
    return
  }
  const ids = Array.from(get(downloadRecordsAtom).values())
    .filter((item) => item.entryType === 'history' && item.playlistId === playlistId)
    .map((item) => item.id)
  set(removeHistoryRecordsAtom, ids)
})

/** Reset cached history for reloading without changing the playback playlist. */
export const clearHistoryRecordsAtom = atom(null, (get, set) => {
  const downloads = new Map(get(downloadRecordsAtom))
  for (const [key, item] of downloads.entries()) {
    if (item.entryType === 'history') {
      downloads.delete(key)
    }
  }
  set(downloadRecordsAtom, downloads)
})

/** Delete history records with the requested status and their playlist entries. */
export const clearHistoryRecordsByStatusAtom = atom(
  null,
  (get, set, status: DownloadHistoryItem['status']) => {
    const ids = Array.from(get(downloadRecordsAtom).values())
      .filter((item) => item.entryType === 'history' && item.status === status)
      .map((item) => item.id)
    set(removeHistoryRecordsAtom, ids)
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
      if (item.status === 'completed') {
        acc.completed += 1
      }
      if (item.status === 'error') {
        acc.error += 1
      }
      if (item.status === 'cancelled') {
        acc.cancelled += 1
      }
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
        (item.entryType === 'active' && item.status === 'downloading') ||
        item.status === 'processing' ||
        item.status === 'pending'
      ) {
        acc.active += 1
      }
      if (item.status === 'completed') {
        acc.completed += 1
      }
      if (item.status === 'error') {
        acc.error += 1
      }
      if (item.status === 'cancelled') {
        acc.cancelled += 1
      }
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
      (item.entryType === 'active' && item.status === 'downloading') ||
      item.status === 'processing'
    ) {
      count++
    }
  }
  return count
})
