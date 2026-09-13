export const PLAYBACK_PLAYLIST_STORAGE_KEY = 'vidbee.transcript.playlist'
export const TRANSCRIPT_PLAYLIST_DRAG_TYPE = 'application/x-vidbee-playlist-item'
export const MAX_PLAYBACK_PLAYLIST_ITEMS = 100

/**
 * Parse a persisted playlist and discard invalid or duplicate ids.
 */
export const parsePlaybackPlaylist = (raw: string | null): string[] => {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    const ids: string[] = []
    const seen = new Set<string>()
    for (const value of parsed) {
      if (typeof value !== 'string') {
        continue
      }
      const id = value.trim()
      if (!(id && !seen.has(id))) {
        continue
      }
      ids.push(id)
      seen.add(id)
      if (ids.length >= MAX_PLAYBACK_PLAYLIST_ITEMS) {
        break
      }
    }
    return ids
  } catch {
    return []
  }
}

/**
 * Load the ordered playback playlist from local storage.
 */
export const loadPlaybackPlaylist = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return []
    }
    return parsePlaybackPlaylist(localStorage.getItem(PLAYBACK_PLAYLIST_STORAGE_KEY))
  } catch {
    return []
  }
}

/**
 * Persist the ordered playback playlist when browser storage is available.
 */
export const savePlaybackPlaylist = (ids: readonly string[]): void => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(PLAYBACK_PLAYLIST_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    return
  }
}

/**
 * Append an item once while keeping the persisted list bounded.
 */
export const appendPlaybackPlaylistItem = (
  ids: readonly string[],
  downloadId: string
): string[] => {
  if (!downloadId || ids.includes(downloadId)) {
    return [...ids]
  }
  return [...ids, downloadId].slice(-MAX_PLAYBACK_PLAYLIST_ITEMS)
}

/**
 * Put the active item first while preserving the order of every other item.
 */
export const promotePlaybackPlaylistItem = (
  ids: readonly string[],
  downloadId: string
): string[] => {
  if (!downloadId) {
    return [...ids]
  }
  return [downloadId, ...ids.filter((id) => id !== downloadId)].slice(
    0,
    MAX_PLAYBACK_PLAYLIST_ITEMS
  )
}

/**
 * Move one playlist item to the position currently occupied by another item.
 */
export const reorderPlaybackPlaylist = (
  ids: readonly string[],
  activeId: string,
  overId: string
): string[] => {
  const fromIndex = ids.indexOf(activeId)
  const toIndex = ids.indexOf(overId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return [...ids]
  }
  const next = [...ids]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return next
  }
  next.splice(toIndex, 0, moved)
  return next
}

export type PlaylistSkipDirection = 'next' | 'previous'

/**
 * Resolve the next or previous playlist id, wrapping when more than one item exists.
 */
export const resolvePlaylistSkip = (
  ids: readonly string[],
  currentId: string | null,
  direction: PlaylistSkipDirection
): string | null => {
  if (ids.length === 0) {
    return null
  }
  if (!currentId) {
    return ids[0] ?? null
  }
  const index = ids.indexOf(currentId)
  if (index < 0) {
    return ids[0] ?? null
  }
  if (ids.length === 1) {
    return null
  }
  const nextIndex =
    direction === 'next' ? (index + 1) % ids.length : (index - 1 + ids.length) % ids.length
  return ids[nextIndex] ?? null
}

/**
 * Walk to the next playable neighbor, skipping items the caller cannot start.
 */
export const resolvePlayablePlaylistSkip = (
  ids: readonly string[],
  currentId: string | null,
  direction: PlaylistSkipDirection,
  isPlayable: (downloadId: string) => boolean
): string | null => {
  const visited = new Set<string>()
  let cursor = currentId
  while (visited.size <= ids.length) {
    const nextId = resolvePlaylistSkip(ids, cursor, direction)
    if (!nextId || visited.has(nextId)) {
      return null
    }
    visited.add(nextId)
    if (isPlayable(nextId)) {
      return nextId
    }
    cursor = nextId
  }
  return null
}
