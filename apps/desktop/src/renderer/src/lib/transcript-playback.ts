import { DEFAULT_VIDEO_ASPECT_RATIO } from './transcript-player-frame'

export const PLAYBACK_BAR_HEIGHT_PX = 80

/** Visible height of the collapsed detail-page bar: the 2px seek track only. */
export const PLAYBACK_BAR_PEEK_PX = 2

export const DEFAULT_AUDIO_COVER_RATIO = 1

export const PLAYBACK_BAR_HEIGHT_VAR = '--playback-bar-height'

export const PLAYBACK_BAR_FULL_VAR = '--playback-bar-full'

export const PLAYBACK_BAR_PEEK_VAR = '--playback-bar-peek'

/** Extra invisible hover band above the collapsed seek track. */
export const PLAYBACK_BAR_HOVER_SLOP_PX = 20

export const PLAYBACK_BAR_HOVER_SLOP_VAR = '--playback-bar-hover-slop'

export const PLAYBACK_BAR_TOGGLE_MS = 240

/** Shared chrome for circular playback-bar controls. */
export const PLAYBACK_BAR_CONTROL_CLASS = 'size-10 shrink-0 rounded-full p-0 [&_svg]:size-5'

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const DEFAULT_PLAYBACK_RATE = 1

/** Restart the current item instead of skipping back when playback is past this point. */
export const PLAYBACK_PREVIOUS_RESTART_SECONDS = 3

export type PlaybackPreviousCommand = 'seek-start' | 'skip'

const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 3

/**
 * Choose whether Previous should restart the current item or skip backward.
 */
export const resolvePlaybackPreviousCommand = (input: {
  currentTime: number
  previousId: string | null
}): PlaybackPreviousCommand => {
  if (input.currentTime > PLAYBACK_PREVIOUS_RESTART_SECONDS) {
    return 'seek-start'
  }
  return input.previousId ? 'skip' : 'seek-start'
}

/**
 * Keep a user-chosen playback rate inside the supported range.
 */
export const clampPlaybackRate = (rate: number): number => {
  if (!(Number.isFinite(rate) && rate > 0)) {
    return DEFAULT_PLAYBACK_RATE
  }
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate))
}

/**
 * Format a rate for the playback-bar label without trailing zeros.
 */
export const formatPlaybackRate = (rate: number): string => {
  return String(Number(clampPlaybackRate(rate).toFixed(2)))
}

let parkingEl: HTMLElement | null = null
let playerWrapEl: HTMLElement | null = null

/**
 * Remember the always-mounted parking lot for the live player node.
 */
export const setPlaybackParkingEl = (el: HTMLElement | null): void => {
  parkingEl = el
}

/**
 * Remember the live player wrap so route unmounts can park it first.
 */
export const setPlaybackPlayerWrapEl = (el: HTMLElement | null): void => {
  playerWrapEl = el
}

const TRANSCRIPT_DETAIL_PATH = /^\/downloads\/[^/]+\/transcript$/

/**
 * Strip trailing slashes so `/` and `/foo/` compare the same.
 *
 * @param pathname Raw router pathname.
 * @returns A pathname with no trailing slash, except for root.
 */
const normalizePlaybackPathname = (pathname: string): string => {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * True when the hash path is any transcript detail page.
 *
 * @param pathname Current router pathname.
 * @returns Whether this is `/downloads/:id/transcript`.
 */
export const isTranscriptDetailPathname = (pathname: string): boolean =>
  TRANSCRIPT_DETAIL_PATH.test(normalizePlaybackPathname(pathname))

/**
 * Match a transcript detail pathname to a download id.
 *
 * @param pathname Current router pathname.
 * @param downloadId Download id that owns the open transcript.
 * @returns Whether this path is that download's transcript page.
 */
export const isTranscriptDetailPath = (pathname: string, downloadId: string): boolean => {
  if (!downloadId) {
    return false
  }
  return normalizePlaybackPathname(pathname) === `/downloads/${downloadId}/transcript`
}

/**
 * Clamp currentTime/duration into a 0–100 fill percent for the mini seek bar.
 */
export const playbackSeekPercent = (currentTime: number, duration: number): number => {
  if (!Number.isFinite(currentTime)) {
    return 0
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, (currentTime / duration) * 100))
}

/**
 * Map a client X on the seek track to a time in seconds.
 */
export const playbackSeekTimeFromClientX = (
  clientX: number,
  track: { left: number; width: number },
  duration: number
): number => {
  if (!(Number.isFinite(clientX) && Number.isFinite(duration) && duration > 0)) {
    return 0
  }
  if (!(Number.isFinite(track.width) && track.width > 0)) {
    return 0
  }
  const ratio = Math.min(1, Math.max(0, (clientX - track.left) / track.width))
  return ratio * duration
}

/**
 * Pick the now-playing cover width÷height for audio art, video, or a still image.
 */
export const playbackBarCoverRatio = (input: {
  imageRatio?: number | null
  isAudio: boolean
  videoRatio?: number | null
}): number => {
  const image =
    typeof input.imageRatio === 'number' &&
    Number.isFinite(input.imageRatio) &&
    input.imageRatio > 0
      ? input.imageRatio
      : null
  const video =
    typeof input.videoRatio === 'number' &&
    Number.isFinite(input.videoRatio) &&
    input.videoRatio > 0
      ? input.videoRatio
      : null
  if (input.isAudio) {
    return image ?? DEFAULT_AUDIO_COVER_RATIO
  }
  return video ?? image ?? DEFAULT_VIDEO_ASPECT_RATIO
}

/**
 * Keep a started session when opening a different transcript.
 */
export const shouldKeepPlaybackSession = (
  current: { downloadId: string; started: boolean } | null,
  nextDownloadId: string
): boolean => {
  if (!current?.started) {
    return false
  }
  return current.downloadId !== nextDownloadId
}

/**
 * Show the now-playing bar after playback starts and the queue is not empty.
 *
 * Transcript detail pages keep the bar mounted and collapse it to the seek
 * strip via `shouldCollapsePlaybackBar` instead of hiding it.
 */
export const shouldShowPlaybackBar = (input: {
  downloadId: string | null
  pathname: string
  playlistCount: number
  started: boolean
}): boolean => {
  return Boolean(input.started && input.downloadId && input.playlistCount > 0)
}

/**
 * Collapse the now-playing bar to the seek strip on any transcript detail page.
 *
 * @param pathname Current router pathname.
 * @returns Whether the bar should start collapsed.
 */
export const shouldCollapsePlaybackBar = (pathname: string): boolean =>
  isTranscriptDetailPathname(pathname)

/**
 * Layout height reserved for the now-playing bar.
 *
 * Hover-expand on a detail page overlays the full bar and does not change this.
 *
 * @param input Visibility and collapse flags for the current route.
 * @returns Reserved height in pixels.
 */
export const playbackBarReservedHeightPx = (input: {
  collapsed: boolean
  visible: boolean
}): number => {
  if (!input.visible) {
    return 0
  }
  return input.collapsed ? PLAYBACK_BAR_PEEK_PX : PLAYBACK_BAR_HEIGHT_PX
}

/**
 * Mark a library row when it owns the started now-playing session.
 *
 * @param session Current playback session, if any.
 * @param downloadId Library row download id.
 */
export const isNowPlayingLibraryItem = (
  session: { downloadId: string; started: boolean } | null,
  downloadId: string
): boolean => {
  if (!(session?.started && downloadId)) {
    return false
  }
  return session.downloadId === downloadId
}

/**
 * Move a live player node into `target`, or park it without leaving the document.
 *
 * `appendChild` keeps the media element in the document so Chromium does not pause it.
 */
export const rehomePlaybackNode = (
  node: HTMLElement | null,
  target: HTMLElement | null,
  parking: HTMLElement | null
): void => {
  if (!node) {
    return
  }
  const liveTarget = target && document.contains(target) ? target : null
  const parent = liveTarget ?? parking
  if (!parent || node.parentElement === parent) {
    return
  }
  parent.appendChild(node)
}

/**
 * Attach the live player wrap to a slot, or park it if the slot is gone.
 */
export const attachPlaybackPlayer = (target: HTMLElement | null): void => {
  rehomePlaybackNode(playerWrapEl, target, parkingEl)
}

/**
 * Pull the live player out of a slot before React removes that slot.
 */
export const parkPlaybackPlayer = (): void => {
  rehomePlaybackNode(playerWrapEl, null, parkingEl)
}
