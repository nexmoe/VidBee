import type { TranscriptSnapshotView } from '../store/transcripts'

/** Result of applying a detail response that may already be stale. */
export type TranscriptDetailTake =
  | { stale: true }
  | { snapshot: TranscriptSnapshotView; stale: false }

/**
 * Identity of the transcript body on screen.
 * Source, language, and record id changes must not keep the previous text.
 *
 * @param snapshot Detail or list snapshot.
 */
export const transcriptBodyKey = (
  snapshot: Pick<TranscriptSnapshotView, 'record' | 'sourceKind'> | null | undefined
): string | null => {
  const record = snapshot?.record
  if (!record) {
    return null
  }
  return [
    record.id,
    record.sourceKind ?? '',
    record.language ?? '',
    snapshot.sourceKind ?? ''
  ].join('\0')
}

/**
 * Drop caption text, speakers, and detail-only flags before a snapshot enters the library map.
 *
 * @param snapshot Full RPC snapshot or a list snapshot.
 */
export const stripTranscriptMapSnapshot = (
  snapshot: TranscriptSnapshotView
): TranscriptSnapshotView => {
  const {
    bodyStale: _bodyStale,
    bodyUpdatedAt: _bodyUpdatedAt,
    sources: _sources,
    record,
    ...rest
  } = snapshot
  if (!record) {
    return { ...rest, record: null }
  }
  return {
    ...rest,
    record: {
      asrTier: record.asrTier,
      createdAt: record.createdAt,
      id: record.id,
      language: record.language,
      modelVersion: record.modelVersion,
      resultKind: record.resultKind,
      sourceKind: record.sourceKind,
      updatedAt: record.updatedAt
    }
  }
}

/**
 * Advance the detail request token. A later response must carry the same token.
 *
 * @param current Token stored for the open transcript page.
 */
export const bumpDetailRequest = (current: number): number => current + 1

/** List identity and revision a `getDetail` read was started for. */
export interface DetailResponseExpect {
  identity: string | null
  updatedAt: number
}

/**
 * True when a list event names another body or another stored revision.
 * A second event for the same revision must not drop `bodyStale` or the open read.
 *
 * @param previous Body currently on the page.
 * @param incoming List event or RPC snapshot.
 */
export const detailVersionMoved = (
  previous: TranscriptSnapshotView | null,
  incoming: TranscriptSnapshotView
): boolean =>
  transcriptBodyKey(previous) !== transcriptBodyKey(incoming) ||
  (previous?.record?.updatedAt ?? 0) !== (incoming.record?.updatedAt ?? 0) ||
  Boolean(previous?.record) !== Boolean(incoming.record)

/**
 * True when a read-only detail body is the identity and revision that was requested.
 * Full RPC actions do not use this check; they commit their snapshot directly.
 *
 * @param incoming `getDetail` payload.
 * @param expected Token captured when that read started.
 */
export const detailResponseMatchesExpect = (
  incoming: TranscriptSnapshotView,
  expected: DetailResponseExpect
): boolean =>
  transcriptBodyKey(incoming) === expected.identity &&
  (incoming.record?.updatedAt ?? 0) === expected.updatedAt

/**
 * Merge a list event or a full snapshot into the open transcript page.
 * A list event has no `segments` array. A full snapshot includes that array, even when empty.
 *
 * @param previous Body currently on the page.
 * @param incoming IPC event or RPC result.
 */
export const mergeTranscriptDetail = (
  previous: TranscriptSnapshotView | null,
  incoming: TranscriptSnapshotView
): TranscriptSnapshotView => {
  const sources = incoming.sources === undefined ? previous?.sources : incoming.sources
  if (!incoming.record) {
    return { ...incoming, bodyStale: false, bodyUpdatedAt: undefined, record: null, sources }
  }
  if (Array.isArray(incoming.record.segments)) {
    return {
      ...incoming,
      bodyStale: false,
      bodyUpdatedAt: incoming.record.updatedAt,
      record: { ...incoming.record, segmentsLoaded: true },
      sources
    }
  }
  const sameBody =
    previous?.record != null && transcriptBodyKey(previous) === transcriptBodyKey(incoming)
  const bodyLoaded = Boolean(
    sameBody && previous?.record?.segmentsLoaded === true && Array.isArray(previous.record.segments)
  )
  if (!(bodyLoaded && previous?.record)) {
    return {
      ...incoming,
      bodyStale: false,
      bodyUpdatedAt: undefined,
      record: {
        asrTier: incoming.record.asrTier,
        createdAt: incoming.record.createdAt,
        id: incoming.record.id,
        language: incoming.record.language,
        modelVersion: incoming.record.modelVersion,
        resultKind: incoming.record.resultKind,
        segments: [],
        segmentsLoaded: false,
        sourceKind: incoming.record.sourceKind,
        speakers: [],
        updatedAt: incoming.record.updatedAt
      },
      sources
    }
  }
  const bodyUpdatedAt = previous.bodyUpdatedAt ?? previous.record.updatedAt
  return {
    ...incoming,
    bodyStale:
      previous.bodyStale === true || (incoming.record.updatedAt ?? 0) !== (bodyUpdatedAt ?? 0),
    bodyUpdatedAt,
    record: {
      ...incoming.record,
      segments: previous.record.segments,
      segmentsLoaded: true,
      speakers: previous.record.speakers
    },
    sources
  }
}

/**
 * Keep a `getDetail` body only when the request token, identity, and `updatedAt` still match.
 * A newer list revision already on the page also rejects the response.
 * Full RPC actions (import, source switch, edit, start, cancel) call `mergeTranscriptDetail` instead.
 *
 * @param currentRequest Token after later switches or full RPC commits.
 * @param responseRequest Token captured when this fetch started.
 * @param previous Body currently on the page.
 * @param incoming Full snapshot from `getDetail`.
 * @param expected Identity and revision this read was allowed to apply.
 */
export const takeDetailResponse = (
  currentRequest: number,
  responseRequest: number,
  previous: TranscriptSnapshotView | null,
  incoming: TranscriptSnapshotView,
  expected: DetailResponseExpect
): TranscriptDetailTake => {
  if (currentRequest !== responseRequest || !detailResponseMatchesExpect(incoming, expected)) {
    return { stale: true }
  }
  if (
    previous?.record &&
    (transcriptBodyKey(previous) !== expected.identity ||
      (previous.record.updatedAt ?? 0) !== expected.updatedAt)
  ) {
    return { stale: true }
  }
  return { snapshot: mergeTranscriptDetail(previous, incoming), stale: false }
}
