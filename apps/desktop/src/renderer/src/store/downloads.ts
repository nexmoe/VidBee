import { atom, type Getter, type Setter } from 'jotai'
import type { DownloadHistoryItem, DownloadItem } from '../../../shared/types'
import {
  downloadLivePatchesAtom,
  livePatchHasFields,
  sameChangedFields,
  splitDownloadChanges,
  withLivePatch,
  withoutLivePatches
} from './download-live-patch'
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

/**
 * Drop overlay patches for ids that left the active set. No-op when none were stored.
 */
const dropLivePatches = (get: Getter, set: Setter, ids: Iterable<string>): void => {
  const next = withoutLivePatches(get(downloadLivePatchesAtom), ids)
  if (next) {
    set(downloadLivePatchesAtom, next)
  }
}

/**
 * Shallow field compare for a full record write. Nested values stay reference checks.
 */
const sameShallowRecord = (existing: DownloadRecord, next: DownloadRecord): boolean => {
  const leftKeys = Object.keys(existing)
  const rightKeys = Object.keys(next)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  for (const key of rightKeys) {
    if (!Object.is(existing[key as keyof DownloadRecord], next[key as keyof DownloadRecord])) {
      return false
    }
  }
  return true
}

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
  // Terminal yt-dlp text is loaded on demand by DownloadItem via history.getHistoryById.
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
  cookieSources: item.cookieSources,
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
    const existing = get(downloadRecordsAtom).get(recordKey('active', update.id))
    if (!existing) {
      return
    }
    // Undefined fields are omitted so a snapshot cannot wipe optimistic metadata.
    // Empty strings are kept. Progress and logs stay on the live overlay.
    const { live, structural } = splitDownloadChanges(update.changes)
    if (livePatchHasFields(live)) {
      const nextPatches = withLivePatch(get(downloadLivePatchesAtom), update.id, live)
      if (nextPatches) {
        set(downloadLivePatchesAtom, nextPatches)
      }
    }
    if (Object.keys(structural).length === 0 || sameChangedFields(existing, structural)) {
      return
    }
    const downloads = new Map(get(downloadRecordsAtom))
    downloads.set(recordKey('active', update.id), { ...existing, ...structural })
    set(downloadRecordsAtom, downloads)
  }
)

export const removeDownloadAtom = atom(null, (get, set, id: string) => {
  const downloads = new Map(get(downloadRecordsAtom))
  downloads.delete(recordKey('active', id))
  set(downloadRecordsAtom, downloads)
  dropLivePatches(get, set, [id])
})

export const clearCompletedAtom = atom(null, (get, set) => {
  const downloads = new Map(get(downloadRecordsAtom))
  const removed: string[] = []
  for (const [key, item] of downloads.entries()) {
    if (item.entryType === 'active' && item.status === 'completed') {
      downloads.delete(key)
      removed.push(item.id)
    }
  }
  set(downloadRecordsAtom, downloads)
  dropLivePatches(get, set, removed)
})

export const addHistoryRecordAtom = atom(null, (get, set, item: DownloadHistoryItem) => {
  const current = get(downloadRecordsAtom)
  const activeKey = recordKey('active', item.id)
  const active = current.get(activeKey)
  if (active && !isFinalStatus(item.status)) {
    return
  }
  const nextRecord = toHistoryRecord(item)
  const historyKey = recordKey('history', item.id)
  const existingHistory = current.get(historyKey)
  const keepsActive = Boolean(active && isFinalStatus(item.status))
  if (!keepsActive && existingHistory && sameShallowRecord(existingHistory, nextRecord)) {
    return
  }
  const downloads = new Map(current)
  if (active && isFinalStatus(item.status)) {
    downloads.delete(activeKey)
  }
  downloads.set(historyKey, nextRecord)
  set(downloadRecordsAtom, downloads)
  if (isFinalStatus(item.status)) {
    dropLivePatches(get, set, [item.id])
  }
})

/**
 * Replace every history row in one write and drop patches for removed or finished tasks.
 */
export const replaceHistoryRecordsAtom = atom(null, (get, set, items: DownloadHistoryItem[]) => {
  const current = get(downloadRecordsAtom)
  const downloads = new Map(current)
  const clearIds: string[] = []
  let changed = false
  for (const [key, item] of current) {
    if (item.entryType !== 'history') {
      continue
    }
    downloads.delete(key)
    clearIds.push(item.id)
    changed = true
  }
  for (const item of items) {
    const activeKey = recordKey('active', item.id)
    if (downloads.has(activeKey)) {
      if (!isFinalStatus(item.status)) {
        continue
      }
      downloads.delete(activeKey)
      clearIds.push(item.id)
    } else if (isFinalStatus(item.status)) {
      clearIds.push(item.id)
    }
    downloads.set(recordKey('history', item.id), toHistoryRecord(item))
    changed = true
  }
  if (!changed) {
    return
  }
  set(downloadRecordsAtom, downloads)
  dropLivePatches(get, set, clearIds)
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
  dropLivePatches(get, set, ids)
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
  const removed: string[] = []
  for (const [key, item] of downloads.entries()) {
    if (item.entryType === 'history') {
      downloads.delete(key)
      removed.push(item.id)
    }
  }
  set(downloadRecordsAtom, downloads)
  dropLivePatches(get, set, removed)
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
