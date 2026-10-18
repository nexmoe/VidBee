import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { ipcServices } from '../lib/ipc'
import { transcriptBodyKey } from '../lib/transcript-detail-merge'
import { playbackClockAtom, playbackSessionAtom } from './transcript-playback'
import type { TranscriptSegmentView, TranscriptSnapshotView } from './transcripts'
import { transcriptMapAtom } from './transcripts'

const EMPTY_SEGMENTS: TranscriptSegmentView[] = []

/** In-flight cue read. One Jotai store keeps one token. */
export interface PlaybackCueInflight {
  downloadTaskId: string
  identity: string
  language: string | null
  requestId: number
  snapshotSourceKind: 'asr' | 'captions' | null
  sourceKind: 'asr' | 'captions'
  transcriptId: string
  updatedAt: number
}

/** Cue payload returned by `getPlaybackCues`. Word timestamps are absent. */
export interface PlaybackCuePayload {
  language: string | null
  segments: ReadonlyArray<{
    confidence: number | null
    endMs: number
    id: string
    sortIndex: number
    speakerId: string | null
    startMs: number
    text: string
    words?: unknown
  }>
  snapshotSourceKind: 'asr' | 'captions' | null
  sourceKind: 'asr' | 'captions'
  transcriptId: string
  updatedAt: number
}

/** Cues for the single playing download. Word timestamps are not stored. */
export interface PlaybackCueState {
  downloadTaskId: string | null
  identity: string | null
  inflight: PlaybackCueInflight | null
  loaded: boolean
  requestId: number
  segments: TranscriptSegmentView[]
  updatedAt: number
}

/** What the playback bar and host ask the cue cache to follow. */
export interface PlaybackCueRequest {
  downloadTaskId: string | null
  identity: string | null
  language?: string | null
  paused?: boolean
  snapshotSourceKind?: 'asr' | 'captions' | null
  sourceKind?: 'asr' | 'captions' | null
  transcriptId?: string | null
  updatedAt: number
}

export const EMPTY_PLAYBACK_CUES: PlaybackCueState = {
  downloadTaskId: null,
  identity: null,
  inflight: null,
  loaded: false,
  requestId: 0,
  segments: EMPTY_SEGMENTS,
  updatedAt: 0
}

export const playbackCueStateAtom = atom<PlaybackCueState>(EMPTY_PLAYBACK_CUES)

/** Play/pause only. Clock ticks must not refetch cues. */
const playbackCuePausedAtom = atom((get) => {
  if (!get(playbackSessionAtom)?.downloadId) {
    return false
  }
  return get(playbackClockAtom).playing !== true
})

/**
 * Decide whether a cue sync should keep, clear, or refresh.
 * Pause keeps the current cues. Closing the session or changing identity clears them.
 *
 * @param previous Cue cache for this store.
 * @param request Session and list-record identity.
 */
export const planPlaybackCueSync = (
  previous: PlaybackCueState,
  request: PlaybackCueRequest
): { fetch: boolean; keep: boolean; next: PlaybackCueState } => {
  if (!request.downloadTaskId) {
    if (!previous.downloadTaskId && previous.segments.length === 0) {
      return { fetch: false, keep: true, next: previous }
    }
    return {
      fetch: false,
      keep: false,
      next: { ...EMPTY_PLAYBACK_CUES, requestId: previous.requestId }
    }
  }
  const sameSession =
    previous.downloadTaskId === request.downloadTaskId && previous.identity === request.identity
  if (request.paused && sameSession) {
    return { fetch: false, keep: true, next: previous }
  }
  if (!request.identity) {
    if (sameSession && previous.segments.length === 0 && !previous.inflight) {
      return { fetch: false, keep: true, next: previous }
    }
    return {
      fetch: false,
      keep: false,
      next: {
        ...EMPTY_PLAYBACK_CUES,
        downloadTaskId: request.downloadTaskId,
        requestId: previous.requestId
      }
    }
  }
  const sameKey = sameSession && previous.updatedAt === request.updatedAt
  if (sameKey && previous.loaded) {
    return { fetch: false, keep: true, next: previous }
  }
  if (
    previous.inflight &&
    previous.inflight.downloadTaskId === request.downloadTaskId &&
    previous.inflight.identity === request.identity &&
    previous.inflight.updatedAt === request.updatedAt
  ) {
    return { fetch: false, keep: true, next: previous }
  }
  return {
    fetch: true,
    keep: false,
    next: {
      ...previous,
      downloadTaskId: request.downloadTaskId,
      identity: request.identity,
      inflight: null,
      loaded: false,
      segments: sameSession ? previous.segments : EMPTY_SEGMENTS,
      updatedAt: request.updatedAt
    }
  }
}

/**
 * Accept a cue response only when every field of the request token still matches.
 *
 * @param token Request captured before the RPC.
 * @param currentRequestId Token now stored for this Jotai store.
 * @param snapshot RPC payload, or null when that download has no cues.
 */
export const playbackCueResponseMatches = (
  token: PlaybackCueInflight,
  currentRequestId: number,
  snapshot: PlaybackCuePayload | null
): boolean => {
  if (!(snapshot && currentRequestId === token.requestId)) {
    return false
  }
  return (
    snapshot.transcriptId === token.transcriptId &&
    snapshot.sourceKind === token.sourceKind &&
    (snapshot.language ?? null) === token.language &&
    (snapshot.snapshotSourceKind ?? null) === token.snapshotSourceKind &&
    snapshot.updatedAt === token.updatedAt
  )
}

/**
 * Copy cue rows and drop word timestamps.
 *
 * @param cues Playback cues. `words` is ignored when a caller passes a detail segment.
 */
export const toCueSegments = (cues: PlaybackCuePayload['segments']): TranscriptSegmentView[] =>
  cues.map((cue) => ({
    confidence: cue.confidence,
    endMs: cue.endMs,
    id: cue.id,
    sortIndex: cue.sortIndex,
    speakerId: cue.speakerId,
    startMs: cue.startMs,
    text: cue.text
  }))

/**
 * Cues from a detail body that is already showing the current revision.
 * A stale body and word timestamps are not copied.
 *
 * @param snapshot Open transcript page snapshot.
 */
export const cuesFromDetailSnapshot = (
  snapshot: TranscriptSnapshotView | null | undefined
): TranscriptSegmentView[] | null => {
  const record = snapshot?.record
  if (!record || snapshot.bodyStale === true || record.segmentsLoaded !== true) {
    return null
  }
  if (!Array.isArray(record.segments)) {
    return null
  }
  return toCueSegments(record.segments)
}

/**
 * Build the inflight token for a fetch. Incomplete list identity does not start a read.
 *
 * @param request Playback request.
 * @param requestId Next token for this store.
 */
const cueInflight = (
  request: PlaybackCueRequest,
  requestId: number
): PlaybackCueInflight | null => {
  if (!(request.downloadTaskId && request.identity && request.transcriptId && request.sourceKind)) {
    return null
  }
  return {
    downloadTaskId: request.downloadTaskId,
    identity: request.identity,
    language: request.language ?? null,
    requestId,
    snapshotSourceKind: request.snapshotSourceKind ?? null,
    sourceKind: request.sourceKind,
    transcriptId: request.transcriptId,
    updatedAt: request.updatedAt
  }
}

/**
 * Drop one inflight token. A newer read is left in place.
 *
 * @param current Cue cache after the RPC settled.
 * @param requestId Token owned by the read that just finished.
 */
const withoutPlaybackInflight = (
  current: PlaybackCueState,
  requestId: number
): PlaybackCueState | null => {
  if (current.inflight?.requestId !== requestId) {
    return null
  }
  return { ...current, inflight: null }
}

/**
 * Load cues for the playing download.
 * The response must match transcript id, source, language, and `updatedAt`.
 * A rejected RPC clears only this inflight token.
 *
 * @param get Cue atom reader for this Jotai store.
 * @param set Store setter.
 * @param request Session identity. `paused` does not clear cues.
 */
export const syncPlaybackCuesAtom = atom(
  null,
  async (get, set, request: PlaybackCueRequest): Promise<void> => {
    const previous = get(playbackCueStateAtom)
    const plan = planPlaybackCueSync(previous, request)
    if (plan.keep) {
      return
    }
    const requestId = previous.requestId + 1
    const inflight = plan.fetch ? cueInflight(request, requestId) : null
    set(playbackCueStateAtom, { ...plan.next, inflight, requestId })
    if (!inflight) {
      return
    }
    try {
      const snapshot = await ipcServices.transcript.getPlaybackCues(inflight.downloadTaskId)
      const current = get(playbackCueStateAtom)
      if (!(snapshot && playbackCueResponseMatches(inflight, current.requestId, snapshot))) {
        const cleared = withoutPlaybackInflight(current, requestId)
        if (cleared) {
          set(playbackCueStateAtom, cleared)
        }
        return
      }
      set(playbackCueStateAtom, {
        ...current,
        inflight: null,
        loaded: true,
        segments: toCueSegments(snapshot.segments)
      })
    } catch {
      const cleared = withoutPlaybackInflight(get(playbackCueStateAtom), requestId)
      if (cleared) {
        set(playbackCueStateAtom, cleared)
      }
    }
  }
)

/**
 * Seed the playing item from a non-stale detail body. Word timestamps are dropped.
 * A different download's cache is left alone.
 *
 * @param get Cue atom reader.
 * @param set Store setter.
 * @param snapshot Detail snapshot for the open page.
 */
export const seedPlaybackCuesAtom = atom(
  null,
  (get, set, snapshot: TranscriptSnapshotView): void => {
    const segments = cuesFromDetailSnapshot(snapshot)
    const identity = transcriptBodyKey(snapshot)
    const record = snapshot.record
    if (!(segments && identity && record)) {
      return
    }
    const previous = get(playbackCueStateAtom)
    if (previous.downloadTaskId && previous.downloadTaskId !== snapshot.downloadTaskId) {
      return
    }
    const updatedAt = record.updatedAt ?? 0
    if (
      previous.loaded &&
      previous.downloadTaskId === snapshot.downloadTaskId &&
      previous.identity === identity &&
      previous.updatedAt === updatedAt
    ) {
      return
    }
    set(playbackCueStateAtom, {
      downloadTaskId: snapshot.downloadTaskId,
      identity,
      inflight: null,
      loaded: true,
      requestId: previous.requestId + 1,
      segments,
      updatedAt
    })
  }
)

/**
 * Shared cues for the playing item. The host and the bar share this store entry.
 * Pause keeps cues. Stopping or switching the item clears them.
 */
export const useTranscriptPlaybackCues = (): TranscriptSegmentView[] => {
  const session = useAtomValue(playbackSessionAtom)
  const paused = useAtomValue(playbackCuePausedAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const cues = useAtomValue(playbackCueStateAtom)
  const sync = useSetAtom(syncPlaybackCuesAtom)
  const downloadId = session?.downloadId ?? null
  const snapshot = downloadId ? transcriptMap[downloadId] : undefined
  const record = snapshot?.record
  const identity = transcriptBodyKey(snapshot)
  const updatedAt = record?.updatedAt ?? 0
  const transcriptId = record?.id ?? null
  const sourceKind = record?.sourceKind ?? null
  const language = record?.language ?? null
  const snapshotSourceKind = snapshot?.sourceKind ?? null

  useEffect(() => {
    void sync({
      downloadTaskId: downloadId,
      identity,
      language,
      paused,
      snapshotSourceKind,
      sourceKind,
      transcriptId,
      updatedAt
    })
  }, [
    downloadId,
    identity,
    language,
    paused,
    snapshotSourceKind,
    sourceKind,
    sync,
    transcriptId,
    updatedAt
  ])

  if (!downloadId || cues.downloadTaskId !== downloadId || cues.identity !== identity) {
    return EMPTY_SEGMENTS
  }
  return cues.segments
}
