import { randomUUID } from 'node:crypto'
import { applyTranscriptMigrations } from '@vidbee/db/transcripts'
import {
  deleteTranscriptSegmentsFromList,
  type InsertTranscriptSegmentInput,
  insertTranscriptSegmentInList,
  type TranscriptSegmentPatch,
  updateTranscriptSegmentList
} from './transcript-edit'
import type { TranscriptHead } from './transcript-sources'
import type {
  PipelineResult,
  TranscriptRecord,
  TranscriptSegment,
  TranscriptSpeaker
} from './types'

interface SqliteStatement {
  run(...params: unknown[]): { changes: number }
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  // biome-ignore lint/suspicious/noExplicitAny: match better-sqlite3 transaction()
  transaction(fn: (...args: any[]) => unknown): ((...args: any[]) => unknown) & {
    immediate: (...args: any[]) => unknown
  }
}

export interface TranscriptStoreOptions {
  db: SqliteDatabase
  clock?: () => number
}

interface TranscriptDbRow {
  id: string
  download_task_id: string
  transcription_task_id: string
  result_kind: TranscriptRecord['resultKind']
  model_version: string
  asr_tier: string | null
  language: string | null
  source_file_path: string | null
  source_kind: string | null
  superseded_at: number | null
  created_at: number
  updated_at: number
}

interface SpeakerDbRow {
  id: string
  speaker_key: string
  display_name: string
  sort_index: number
}

interface SegmentDbRow {
  id: string
  speaker_id: string | null
  start_ms: number
  end_ms: number
  text: string
  words_json: string | null
  confidence: number | null
  sort_index: number
}

/** Playback cue columns. Word timestamps stay in `words_json` and are not selected. */
export interface TranscriptPlaybackCue {
  confidence: number | null
  endMs: number
  id: string
  sortIndex: number
  speakerId: string | null
  startMs: number
  text: string
}

/** Head columns only. This statement must not reference `transcript_segments`. */
export const TRANSCRIPT_HEAD_SQL = `SELECT id, download_task_id, transcription_task_id, result_kind,
            model_version, asr_tier, language, source_file_path, source_kind, superseded_at,
            created_at, updated_at
     FROM transcripts`

/** Cue columns for one transcript. `words_json` is intentionally absent. */
export const TRANSCRIPT_PLAYBACK_CUE_SQL = `SELECT id, speaker_id, start_ms, end_ms, text, confidence, sort_index
     FROM transcript_segments
     WHERE transcript_id = ?
     ORDER BY start_ms ASC, sort_index ASC`

/**
 * Parse persisted ASR words, ignoring corrupt JSON.
 */
/**
 * Map a transcript table row to a head. Segment tables are not queried.
 *
 * @param row Transcripts table row.
 */
const mapTranscriptHead = (row: TranscriptDbRow): TranscriptHead => ({
  asrTier: row.asr_tier ?? null,
  createdAt: row.created_at,
  downloadTaskId: row.download_task_id,
  id: row.id,
  language: row.language,
  modelVersion: row.model_version,
  resultKind: row.result_kind,
  sourceFilePath: row.source_file_path,
  sourceKind: row.source_kind === 'captions' ? 'captions' : 'asr',
  supersededAt: row.superseded_at,
  transcriptionTaskId: row.transcription_task_id,
  updatedAt: row.updated_at
})

const parseWordsJson = (raw: string | null): TranscriptSegment['words'] => {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as { text?: unknown }).text !== 'string' ||
        typeof (item as { startMs?: unknown }).startMs !== 'number' ||
        typeof (item as { endMs?: unknown }).endMs !== 'number'
      ) {
        return []
      }
      const word = item as { endMs: number; startMs: number; text: string }
      return [{ endMs: word.endMs, startMs: word.startMs, text: word.text }]
    })
  } catch {
    return []
  }
}

export class TranscriptStore {
  private readonly db: SqliteDatabase
  private readonly clock: () => number

  constructor(opts: TranscriptStoreOptions) {
    this.db = opts.db
    this.clock = opts.clock ?? Date.now
    this.applySchema()
  }

  applySchema(): void {
    const columnNames = (table: string): string[] =>
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    const exec = (sql: string): void => {
      this.db.exec(sql)
    }
    applyTranscriptMigrations(exec, columnNames('transcripts'))
    applyTranscriptMigrations(exec, columnNames('transcripts'), columnNames('transcript_segments'))
  }

  getById(id: string): TranscriptRecord | null {
    const row = this.db.prepare('SELECT * FROM transcripts WHERE id = ?').get(id) as
      | TranscriptDbRow
      | undefined
    if (!row) {
      return null
    }
    return this.hydrate(row)
  }

  getByTranscriptionTaskId(taskId: string): TranscriptRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM transcripts
         WHERE transcription_task_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(taskId) as TranscriptDbRow | undefined
    if (!row) {
      return null
    }
    return this.hydrate(row)
  }

  getLatestForDownload(downloadTaskId: string): TranscriptRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM transcripts
         WHERE download_task_id = ? AND superseded_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(downloadTaskId) as TranscriptDbRow | undefined
    if (!row) {
      return null
    }
    return this.hydrate(row)
  }

  listForDownload(downloadTaskId: string): TranscriptRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transcripts
         WHERE download_task_id = ?
         ORDER BY created_at DESC`
      )
      .all(downloadTaskId) as TranscriptDbRow[]
    return rows.map((row) => this.hydrate(row))
  }

  /**
   * Return every current (non-superseded) transcript, newest first.
   */
  listLatest(): TranscriptRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transcripts
         WHERE superseded_at IS NULL
         ORDER BY updated_at DESC`
      )
      .all() as TranscriptDbRow[]
    return rows.map((row) => this.hydrate(row))
  }

  /**
   * Return every transcript row without speakers, segments, or word timestamps.
   * Newest first, including superseded history needed for source selection.
   */
  listHeads(): TranscriptHead[] {
    const rows = this.db
      .prepare(`${TRANSCRIPT_HEAD_SQL} ORDER BY created_at DESC`)
      .all() as TranscriptDbRow[]
    return rows.map((row) => mapTranscriptHead(row))
  }

  /**
   * Return one download's transcript heads, newest first, without caption bodies.
   *
   * @param downloadTaskId Parent download id.
   */
  listHeadsForDownload(downloadTaskId: string): TranscriptHead[] {
    const rows = this.db
      .prepare(`${TRANSCRIPT_HEAD_SQL} WHERE download_task_id = ? ORDER BY created_at DESC`)
      .all(downloadTaskId) as TranscriptDbRow[]
    return rows.map((row) => mapTranscriptHead(row))
  }

  /**
   * True when a download already has a current transcript row.
   *
   * @param downloadTaskId Parent download id.
   */
  hasCurrent(downloadTaskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM transcripts
         WHERE download_task_id = ? AND superseded_at IS NULL
         LIMIT 1`
      )
      .get(downloadTaskId)
    return Boolean(row)
  }

  /**
   * Read cue text and times for one transcript. Word JSON is not selected.
   *
   * @param transcriptId Stored transcript id.
   */
  listPlaybackCues(transcriptId: string): TranscriptPlaybackCue[] {
    const rows = this.db.prepare(TRANSCRIPT_PLAYBACK_CUE_SQL).all(transcriptId) as Array<{
      confidence: number | null
      end_ms: number
      id: string
      sort_index: number
      speaker_id: string | null
      start_ms: number
      text: string
    }>
    return rows.map((row) => ({
      confidence: row.confidence,
      endMs: row.end_ms,
      id: row.id,
      sortIndex: row.sort_index,
      speakerId: row.speaker_id,
      startMs: row.start_ms,
      text: row.text
    }))
  }

  commit(input: {
    downloadTaskId: string
    transcriptionTaskId: string
    sourceFilePath: string | null
    result: PipelineResult
    transcriptId?: string
  }): TranscriptRecord {
    const now = this.clock()
    const transcriptId = input.transcriptId ?? randomUUID()
    const existing = this.getByTranscriptionTaskId(input.transcriptionTaskId)
    if (existing && existing.supersededAt == null) {
      return existing
    }

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE transcripts
           SET superseded_at = ?, updated_at = ?
           WHERE download_task_id = ? AND superseded_at IS NULL`
        )
        .run(now, now, input.downloadTaskId)

      this.db
        .prepare(
          `INSERT INTO transcripts (
             id, download_task_id, transcription_task_id, result_kind, model_version,
             asr_tier, language, source_file_path, source_kind, superseded_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          transcriptId,
          input.downloadTaskId,
          input.transcriptionTaskId,
          input.result.resultKind,
          input.result.modelVersion,
          input.result.asrTier,
          input.result.language,
          input.sourceFilePath,
          input.result.sourceKind ?? 'asr',
          now,
          now
        )

      const speakerIds = new Map<string, string>()
      input.result.speakers.forEach((speaker, index) => {
        const id = randomUUID()
        speakerIds.set(speaker.speakerKey, id)
        this.db
          .prepare(
            `INSERT INTO transcript_speakers (
               id, transcript_id, speaker_key, display_name, sort_index
             ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(id, transcriptId, speaker.speakerKey, speaker.displayName, index)
      })

      input.result.segments.forEach((segment, index) => {
        const speakerId = segment.speakerKey ? (speakerIds.get(segment.speakerKey) ?? null) : null
        this.db
          .prepare(
            `INSERT INTO transcript_segments (
               id, transcript_id, speaker_id, start_ms, end_ms, text, words_json, confidence, sort_index
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            transcriptId,
            speakerId,
            segment.startMs,
            segment.endMs,
            segment.text,
            JSON.stringify(segment.words ?? []),
            segment.confidence,
            index
          )
      })
    })
    write.immediate()

    const committed = this.getById(transcriptId)
    if (!committed) {
      throw new Error(`transcript commit failed for ${transcriptId}`)
    }
    return committed
  }

  /**
   * Drop every stored transcript for a download, including superseded rows.
   *
   * @param downloadTaskId Parent download id.
   */
  deleteByDownload(downloadTaskId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM transcripts WHERE download_task_id = ?')
      .all(downloadTaskId) as Array<{ id: string }>
    const wipe = this.db.transaction(() => {
      for (const row of rows) {
        this.db.prepare('DELETE FROM transcript_segments WHERE transcript_id = ?').run(row.id)
        this.db.prepare('DELETE FROM transcript_speakers WHERE transcript_id = ?').run(row.id)
        this.db.prepare('DELETE FROM transcripts WHERE id = ?').run(row.id)
      }
    })
    wipe.immediate()
  }

  /**
   * Make one stored transcript the current row for a download.
   *
   * @param downloadTaskId Parent download id.
   * @param transcriptId Row to restore.
   */
  activate(downloadTaskId: string, transcriptId: string): TranscriptRecord | null {
    const target = this.getById(transcriptId)
    if (!target || target.downloadTaskId !== downloadTaskId) {
      return null
    }
    const current = this.getLatestForDownload(downloadTaskId)
    if (current?.id === target.id) {
      return current
    }
    const now = this.clock()
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE transcripts
           SET superseded_at = ?, updated_at = ?
           WHERE download_task_id = ? AND superseded_at IS NULL AND id != ?`
        )
        .run(now, now, downloadTaskId, transcriptId)
      this.db
        .prepare(
          `UPDATE transcripts
           SET superseded_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(now, transcriptId)
    })
    write.immediate()
    return this.getById(transcriptId)
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
    const record = this.getById(transcriptId)
    if (!record) {
      return null
    }
    const segments = updateTranscriptSegmentList(record.segments, segmentId, patch)
    if (!segments) {
      return null
    }
    this.replaceSegments(record, segments)
    return this.getById(transcriptId)
  }

  /**
   * Remove one or more captions from a stored transcript.
   *
   * @param transcriptId Row that owns the captions.
   * @param segmentIds Caption ids to drop.
   */
  deleteSegments(transcriptId: string, segmentIds: string[]): TranscriptRecord | null {
    const record = this.getById(transcriptId)
    if (!record) {
      return null
    }
    const wanted = new Set(segmentIds)
    if (!record.segments.some((segment) => wanted.has(segment.id))) {
      return record
    }
    this.replaceSegments(record, deleteTranscriptSegmentsFromList(record.segments, segmentIds))
    return this.getById(transcriptId)
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
    const record = this.getById(transcriptId)
    if (!record) {
      return null
    }
    const inserted = insertTranscriptSegmentInList(record.segments, input, () => randomUUID())
    this.replaceSegments(record, inserted.segments)
    const next = this.getById(transcriptId)
    if (!next) {
      return null
    }
    return { record: next, segmentId: inserted.segmentId }
  }

  /**
   * Rewrite every caption for a transcript in one transaction.
   *
   * @param record Parent row before the write.
   * @param segments Captions after the mutation.
   */
  private replaceSegments(record: TranscriptRecord, segments: TranscriptSegment[]): void {
    const now = this.clock()
    const resultKind = segments.length > 0 ? 'transcript' : record.resultKind
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM transcript_segments WHERE transcript_id = ?').run(record.id)
      const insert = this.db.prepare(
        `INSERT INTO transcript_segments (
           id, transcript_id, speaker_id, start_ms, end_ms, text, words_json, confidence, sort_index
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const segment of segments) {
        insert.run(
          segment.id,
          record.id,
          segment.speakerId,
          segment.startMs,
          segment.endMs,
          segment.text,
          JSON.stringify(segment.words ?? []),
          segment.confidence,
          segment.sortIndex
        )
      }
      this.db
        .prepare('UPDATE transcripts SET updated_at = ?, result_kind = ? WHERE id = ?')
        .run(now, resultKind, record.id)
    })
    write.immediate()
  }

  private hydrate(row: TranscriptDbRow): TranscriptRecord {
    const speakers = (
      this.db
        .prepare(
          `SELECT id, speaker_key, display_name, sort_index
           FROM transcript_speakers
           WHERE transcript_id = ?
           ORDER BY sort_index ASC`
        )
        .all(row.id) as SpeakerDbRow[]
    ).map(
      (speaker): TranscriptSpeaker => ({
        id: speaker.id,
        speakerKey: speaker.speaker_key,
        displayName: speaker.display_name,
        sortIndex: speaker.sort_index
      })
    )
    const segments = (
      this.db
        .prepare(
          `SELECT id, speaker_id, start_ms, end_ms, text, words_json, confidence, sort_index
           FROM transcript_segments
           WHERE transcript_id = ?
           ORDER BY start_ms ASC, sort_index ASC`
        )
        .all(row.id) as SegmentDbRow[]
    ).map(
      (segment): TranscriptSegment => ({
        id: segment.id,
        speakerId: segment.speaker_id,
        startMs: segment.start_ms,
        endMs: segment.end_ms,
        text: segment.text,
        words: parseWordsJson(segment.words_json),
        confidence: segment.confidence,
        sortIndex: segment.sort_index
      })
    )
    return {
      id: row.id,
      downloadTaskId: row.download_task_id,
      transcriptionTaskId: row.transcription_task_id,
      resultKind: row.result_kind,
      modelVersion: row.model_version,
      asrTier: row.asr_tier ?? null,
      language: row.language,
      sourceFilePath: row.source_file_path,
      sourceKind: row.source_kind === 'captions' ? 'captions' : 'asr',
      supersededAt: row.superseded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      speakers,
      segments
    }
  }
}
