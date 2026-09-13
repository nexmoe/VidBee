export const PLAYBACK_POSITION_STORAGE_KEY = 'vidbee.transcript.playback-position'
export const MIN_RESUME_SECONDS = 5
export const END_MARGIN_SECONDS = 5
export const PLAYBACK_POSITION_SAVE_INTERVAL_MS = 1000
export const RESUME_STUCK_EPSILON_SECONDS = 1.25
export const MAX_STORED_PLAYBACK_POSITIONS = 100

export interface PlaybackPositionEntry {
  duration?: number
  seconds: number
  updatedAt: number
}

export type PlaybackPositions = Record<string, PlaybackPositionEntry>

export type PlaybackPositionWrite =
  | { action: 'clear' }
  | { action: 'keep' }
  | { action: 'save'; seconds: number }

/**
 * True when a stored clock is far enough from the start and end to resume.
 */
export const isResumablePlaybackPosition = (seconds: number, duration: number): boolean => {
  if (!Number.isFinite(seconds) || seconds < MIN_RESUME_SECONDS) {
    return false
  }
  if (Number.isFinite(duration) && duration > 0 && seconds >= duration - END_MARGIN_SECONDS) {
    return false
  }
  return true
}

/**
 * Decide whether a clock sample should replace, clear, or leave stored progress.
 */
export const playbackPositionWrite = (
  currentTime: number,
  duration: number
): PlaybackPositionWrite => {
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return { action: 'keep' }
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return currentTime >= MIN_RESUME_SECONDS
      ? { action: 'save', seconds: currentTime }
      : { action: 'keep' }
  }
  if (currentTime < MIN_RESUME_SECONDS || currentTime >= duration - END_MARGIN_SECONDS) {
    return { action: 'clear' }
  }
  return { action: 'save', seconds: currentTime }
}

/**
 * Keep at most `max` positions, dropping the oldest `updatedAt` first.
 */
export const prunePlaybackPositions = (
  positions: PlaybackPositions,
  max = MAX_STORED_PLAYBACK_POSITIONS
): PlaybackPositions => {
  const entries = Object.entries(positions)
  if (entries.length <= max) {
    return positions
  }
  entries.sort((left, right) => (left[1]?.updatedAt ?? 0) - (right[1]?.updatedAt ?? 0))
  const next: PlaybackPositions = {}
  for (const [id, entry] of entries.slice(entries.length - max)) {
    next[id] = entry
  }
  return next
}

/**
 * Parse a stored playback-position map, ignoring corrupt or partial rows.
 */
export const parsePlaybackPositions = (raw: string | null): PlaybackPositions => {
  if (!raw) {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const next: PlaybackPositions = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!(id && value) || typeof value !== 'object' || Array.isArray(value)) {
        continue
      }
      const row = value as { duration?: unknown; seconds?: unknown; updatedAt?: unknown }
      if (typeof row.seconds !== 'number' || !Number.isFinite(row.seconds) || row.seconds < 0) {
        continue
      }
      const updatedAt =
        typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) ? row.updatedAt : 0
      const duration =
        typeof row.duration === 'number' && Number.isFinite(row.duration) && row.duration > 0
          ? row.duration
          : undefined
      next[id] = duration
        ? { duration, seconds: row.seconds, updatedAt }
        : { seconds: row.seconds, updatedAt }
    }
    return next
  } catch {
    return {}
  }
}

/**
 * Read `localStorage` or return null when the API is missing or throws.
 */
const readStorageItem = (key: string): string | null => {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Write `localStorage` and ignore quota or privacy-mode failures.
 */
const writeStorageItem = (key: string, value: string): void => {
  try {
    if (typeof localStorage === 'undefined') {
      return
    }
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

/**
 * Load every remembered transcript playback position.
 */
export const loadPlaybackPositions = (): PlaybackPositions =>
  parsePlaybackPositions(readStorageItem(PLAYBACK_POSITION_STORAGE_KEY))

/**
 * Persist the full playback-position map.
 */
const savePlaybackPositions = (positions: PlaybackPositions): void => {
  writeStorageItem(PLAYBACK_POSITION_STORAGE_KEY, JSON.stringify(positions))
}

/**
 * Return the stored resume point for one transcript, if any.
 */
export const readPlaybackPosition = (downloadId: string): number | null => {
  if (!downloadId) {
    return null
  }
  const seconds = loadPlaybackPositions()[downloadId]?.seconds
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/**
 * Store a resume point and evict the oldest rows when the map is full.
 */
export const savePlaybackPosition = (
  downloadId: string,
  seconds: number,
  now = Date.now(),
  duration?: number
): void => {
  if (!(downloadId && Number.isFinite(seconds)) || seconds < 0) {
    return
  }
  const entry: PlaybackPositionEntry =
    Number.isFinite(duration) && (duration ?? 0) > 0
      ? { duration, seconds, updatedAt: now }
      : { seconds, updatedAt: now }
  const next = prunePlaybackPositions({
    ...loadPlaybackPositions(),
    [downloadId]: entry
  })
  savePlaybackPositions(next)
}

/**
 * Forget the stored resume point for one transcript.
 */
export const clearPlaybackPosition = (downloadId: string): void => {
  if (!downloadId) {
    return
  }
  const positions = loadPlaybackPositions()
  if (!(downloadId in positions)) {
    return
  }
  delete positions[downloadId]
  savePlaybackPositions(positions)
}

/**
 * Apply a clock sample: save, clear, or leave the stored resume point alone.
 */
export const applyPlaybackPositionWrite = (
  downloadId: string,
  currentTime: number,
  duration: number,
  now = Date.now()
): void => {
  const decision = playbackPositionWrite(currentTime, duration)
  if (decision.action === 'keep') {
    return
  }
  if (decision.action === 'clear') {
    clearPlaybackPosition(downloadId)
    return
  }
  savePlaybackPosition(downloadId, decision.seconds, now, duration)
}

export type ResumeSeekPlan = 'done' | 'seek' | 'skip' | 'wait'

/**
 * Decide whether the player should wait, skip, seek, or treat resume as finished.
 *
 * Seek is retried until `currentTime` is close to `startAt`, because Video.js
 * often resets the clock to 0 after the first seek if the store is not attached yet.
 */
export const planResumeSeek = (
  startAt: number,
  currentTime: number,
  duration: number,
  stuckEpsilon = RESUME_STUCK_EPSILON_SECONDS
): ResumeSeekPlan => {
  if (!(duration > 0)) {
    return 'wait'
  }
  if (!isResumablePlaybackPosition(startAt, duration)) {
    return 'skip'
  }
  if (Math.abs(currentTime - startAt) <= stuckEpsilon) {
    return 'done'
  }
  return 'seek'
}
