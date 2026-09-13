import { loadPlaybackPositions } from '@renderer/lib/transcript-playback-position'
import {
  appendPlaybackPlaylistItem,
  loadPlaybackPlaylist,
  promotePlaybackPlaylistItem,
  reorderPlaybackPlaylist,
  savePlaybackPlaylist
} from '@renderer/lib/transcript-playlist'
import { atom } from 'jotai'

export interface PlaylistPlaybackProgress {
  currentTime: number
  duration: number
}

/**
 * Build the initial progress map from stored per-download resume points.
 */
const loadPlaylistProgress = (): Record<string, PlaylistPlaybackProgress> => {
  const result: Record<string, PlaylistPlaybackProgress> = {}
  for (const [downloadId, entry] of Object.entries(loadPlaybackPositions())) {
    result[downloadId] = {
      currentTime: entry.seconds,
      duration: entry.duration ?? 0
    }
  }
  return result
}

export const playbackPlaylistAtom = atom<string[]>(loadPlaybackPlaylist())

export const playlistPlaybackProgressAtom = atom<Record<string, PlaylistPlaybackProgress>>(
  loadPlaylistProgress()
)

/**
 * Add one download to the end of the playlist without creating duplicates.
 */
export const addPlaybackPlaylistItemAtom = atom(null, (get, set, downloadId: string) => {
  const current = get(playbackPlaylistAtom)
  const next = appendPlaybackPlaylistItem(current, downloadId)
  if (next.length === current.length) {
    return
  }
  set(playbackPlaylistAtom, next)
  savePlaybackPlaylist(next)
})

/**
 * Append many downloads once, skipping duplicates, and return how many were new.
 */
export const addPlaybackPlaylistItemsAtom = atom(
  null,
  (get, set, downloadIds: string[]): number => {
    let next = get(playbackPlaylistAtom)
    let added = 0
    for (const downloadId of downloadIds) {
      const after = appendPlaybackPlaylistItem(next, downloadId)
      if (after.length !== next.length) {
        added += 1
        next = after
      }
    }
    if (added === 0) {
      return 0
    }
    set(playbackPlaylistAtom, next)
    savePlaybackPlaylist(next)
    return added
  }
)

/**
 * Add the active item if needed and keep it at the front of the queue.
 */
export const activatePlaybackPlaylistItemAtom = atom(null, (get, set, downloadId: string) => {
  const current = get(playbackPlaylistAtom)
  const next = promotePlaybackPlaylistItem(current, downloadId)
  if (next.every((id, index) => id === current[index])) {
    return
  }
  set(playbackPlaylistAtom, next)
  savePlaybackPlaylist(next)
})

/** Remove downloads in one update and persist the remaining playlist order. */
export const removePlaybackPlaylistItemsAtom = atom(null, (get, set, downloadIds: string[]) => {
  const current = get(playbackPlaylistAtom)
  const removedIds = new Set(downloadIds)
  const next = current.filter((id) => !removedIds.has(id))
  if (next.length === current.length) {
    return current[0] ?? null
  }
  set(playbackPlaylistAtom, next)
  savePlaybackPlaylist(next)
  return next[0] ?? null
})

/** Remove one download and return the next item at the front of the playlist. */
export const removePlaybackPlaylistItemAtom = atom(null, (_get, set, downloadId: string) => {
  return set(removePlaybackPlaylistItemsAtom, [downloadId])
})

/**
 * Remove a completed item and return the next queued id.
 */
export const finishPlaybackPlaylistItemAtom = atom(
  null,
  (get, set, downloadId: string): string | null => {
    const current = get(playbackPlaylistAtom)
    const next = current.filter((id) => id !== downloadId)
    if (next.length !== current.length) {
      set(playbackPlaylistAtom, next)
      savePlaybackPlaylist(next)
    }
    return next[0] ?? null
  }
)

/**
 * Move one item onto another item's ordered position and return the new first item.
 */
export const reorderPlaybackPlaylistAtom = atom(
  null,
  (get, set, update: { activeId: string; overId: string }): string | null => {
    const current = get(playbackPlaylistAtom)
    const next = reorderPlaybackPlaylist(current, update.activeId, update.overId)
    if (next.every((id, index) => id === current[index])) {
      return current[0] ?? null
    }
    set(playbackPlaylistAtom, next)
    savePlaybackPlaylist(next)
    return next[0] ?? null
  }
)

/**
 * Publish the latest clock for one playlist item without rerendering unrelated state.
 */
export const updatePlaylistPlaybackProgressAtom = atom(
  null,
  (get, set, update: { currentTime: number; downloadId: string; duration: number }) => {
    const current = get(playlistPlaybackProgressAtom)
    set(playlistPlaybackProgressAtom, {
      ...current,
      [update.downloadId]: {
        currentTime: update.currentTime,
        duration: update.duration
      }
    })
  }
)
