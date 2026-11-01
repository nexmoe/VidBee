import { randomUUID } from 'node:crypto'
import {
  deleteTranscriptSegmentsFromList,
  type InsertTranscriptSegmentInput,
  insertTranscriptSegmentInList,
  type TranscriptSegmentPatch,
  updateTranscriptSegmentList
} from './transcript-edit'
import type { TranscriptStore } from './transcript-store'
import type { PipelineResult, TranscriptRecord } from './types'

type CommitInput = Parameters<TranscriptStore['commit']>[0]

export class MemoryTranscriptStore {
  private readonly rows = new Map<string, TranscriptRecord>()
  private readonly clock: () => number

  constructor(opts?: { clock?: () => number }) {
    this.clock = opts?.clock ?? Date.now
  }

  applySchema(): void {}

  getById(id: string): TranscriptRecord | null {
    return this.rows.get(id) ?? null
  }

  getByTranscriptionTaskId(taskId: string): TranscriptRecord | null {
    const matches = [...this.rows.values()]
      .filter((row) => row.transcriptionTaskId === taskId)
      .sort((a, b) => b.createdAt - a.createdAt)
    return matches[0] ?? null
  }

  getLatestForDownload(downloadTaskId: string): TranscriptRecord | null {
    const matches = [...this.rows.values()]
      .filter((row) => row.downloadTaskId === downloadTaskId && row.supersededAt == null)
      .sort((a, b) => b.createdAt - a.createdAt)
    return matches[0] ?? null
  }

  listForDownload(downloadTaskId: string): TranscriptRecord[] {
    return [...this.rows.values()]
      .filter((row) => row.downloadTaskId === downloadTaskId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Return every current (non-superseded) transcript, newest first.
   */
  listLatest(): TranscriptRecord[] {
    return [...this.rows.values()]
      .filter((row) => row.supersededAt == null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Persist a transcript, optionally keeping it as a secondary track without changing the current row. */
  commit(input: CommitInput): TranscriptRecord {
    const existing = this.getByTranscriptionTaskId(input.transcriptionTaskId)
    if (existing && (input.activate === false || existing.supersededAt == null)) {
      return existing
    }
    const now = this.clock()
    for (const row of this.rows.values()) {
      if (
        input.activate !== false &&
        row.downloadTaskId === input.downloadTaskId &&
        row.supersededAt == null
      ) {
        row.supersededAt = now
        row.updatedAt = now
      }
    }
    const record = hydrateRecord(input, now)
    if (input.activate === false) {
      record.supersededAt = now
    }
    this.rows.set(record.id, record)
    return record
  }

  /** Mirror the persistent store's additive caption writes without replacing existing cue IDs. */
  appendCaptionCues(
    transcriptId: string,
    cues: ReadonlyArray<{ startMs: number; endMs: number; text: string }>
  ): TranscriptRecord {
    const record = this.rows.get(transcriptId)
    if (record?.sourceKind !== 'captions') {
      throw new Error('Caption transcript is unavailable')
    }
    const firstIndex =
      record.segments.reduce((max, segment) => Math.max(max, segment.sortIndex), -1) + 1
    this.writeSegments(record, [
      ...record.segments,
      ...cues.map((cue, index) => ({
        ...cue,
        id: randomUUID(),
        speakerId: null,
        confidence: null,
        words: [],
        sortIndex: firstIndex + index
      }))
    ])
    return record
  }

  /**
   * Drop every stored transcript for a download, including superseded rows.
   *
   * @param downloadTaskId Parent download id.
   */
  deleteByDownload(downloadTaskId: string): void {
    for (const [id, row] of this.rows) {
      if (row.downloadTaskId === downloadTaskId) {
        this.rows.delete(id)
      }
    }
  }

  /**
   * Make one stored transcript the current row for a download.
   *
   * @param downloadTaskId Parent download id.
   * @param transcriptId Row to restore.
   */
  activate(downloadTaskId: string, transcriptId: string): TranscriptRecord | null {
    const target = this.rows.get(transcriptId)
    if (!target || target.downloadTaskId !== downloadTaskId) {
      return null
    }
    const current = this.getLatestForDownload(downloadTaskId)
    if (current?.id === target.id) {
      return current
    }
    const now = this.clock()
    for (const row of this.rows.values()) {
      if (
        row.downloadTaskId === downloadTaskId &&
        row.supersededAt == null &&
        row.id !== target.id
      ) {
        row.supersededAt = now
        row.updatedAt = now
      }
    }
    target.supersededAt = null
    target.updatedAt = now
    return target
  }

  /**
   * Patch one caption on a stored transcript.
   *
   * @param transcriptId Row that owns the caption.
   * @param segmentId Caption to change.
   * @param patch Text, speaker, or times.
   */
  updateSegment(
    transcriptId: string,
    segmentId: string,
    patch: TranscriptSegmentPatch
  ): TranscriptRecord | null {
    const record = this.rows.get(transcriptId)
    if (!record) {
      return null
    }
    const segments = updateTranscriptSegmentList(record.segments, segmentId, patch)
    if (!segments) {
      return null
    }
    this.writeSegments(record, segments)
    return record
  }

  /**
   * Remove one or more captions from a stored transcript.
   *
   * @param transcriptId Row that owns the captions.
   * @param segmentIds Caption ids to drop.
   */
  deleteSegments(transcriptId: string, segmentIds: string[]): TranscriptRecord | null {
    const record = this.rows.get(transcriptId)
    if (!record) {
      return null
    }
    const wanted = new Set(segmentIds)
    if (!record.segments.some((segment) => wanted.has(segment.id))) {
      return record
    }
    this.writeSegments(record, deleteTranscriptSegmentsFromList(record.segments, segmentIds))
    return record
  }

  /**
   * Insert a caption and return the updated record plus the new row id.
   *
   * @param transcriptId Row that owns the captions.
   * @param input Neighbor, playhead, or explicit times.
   */
  insertSegment(
    transcriptId: string,
    input: InsertTranscriptSegmentInput
  ): { record: TranscriptRecord; segmentId: string } | null {
    const record = this.rows.get(transcriptId)
    if (!record) {
      return null
    }
    const inserted = insertTranscriptSegmentInList(record.segments, input, () => randomUUID())
    this.writeSegments(record, inserted.segments)
    return { record, segmentId: inserted.segmentId }
  }

  /**
   * Replace captions on an in-memory transcript row.
   *
   * @param record Parent row to mutate.
   * @param segments Captions after the mutation.
   */
  private writeSegments(record: TranscriptRecord, segments: TranscriptRecord['segments']): void {
    record.segments = segments
    record.updatedAt = this.clock()
    if (segments.length > 0) {
      record.resultKind = 'transcript'
    }
  }
}

const hydrateRecord = (input: CommitInput, now: number): TranscriptRecord => {
  const transcriptId = input.transcriptId ?? randomUUID()
  const speakers = input.result.speakers.map((speaker, index) => ({
    id: randomUUID(),
    speakerKey: speaker.speakerKey,
    displayName: speaker.displayName,
    sortIndex: index
  }))
  const speakerIdByKey = new Map(speakers.map((speaker) => [speaker.speakerKey, speaker.id]))
  const segments = input.result.segments.map((segment, index) => ({
    id: randomUUID(),
    speakerId: segment.speakerKey ? (speakerIdByKey.get(segment.speakerKey) ?? null) : null,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    words: segment.words ?? [],
    confidence: segment.confidence,
    sortIndex: index
  }))
  return {
    id: transcriptId,
    downloadTaskId: input.downloadTaskId,
    transcriptionTaskId: input.transcriptionTaskId,
    resultKind: input.result.resultKind,
    modelVersion: input.result.modelVersion,
    asrTier: input.result.asrTier ?? null,
    language: input.result.language,
    sourceFilePath: input.sourceFilePath,
    sourceKind: input.result.sourceKind ?? 'asr',
    supersededAt: null,
    createdAt: now,
    updatedAt: now,
    speakers,
    segments
  }
}

export type { PipelineResult }
