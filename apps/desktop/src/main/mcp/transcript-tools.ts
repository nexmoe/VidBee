import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ASR_TIER_IDS } from '@vidbee/transcription/asr'
import { z } from 'zod'
import { buildAssDocument, buildSrtDocument, formatSrtClock } from '../../shared/subtitle-export'
import {
  buildExportUnits,
  buildTranscriptExportText,
  type TranscriptExportGrouping,
  type TranscriptExportStyle
} from '../../shared/transcript-export'
import { manageAgentAsr, updateAgentSettings } from '../lib/agent-capability-host'
import { createAgentTask } from '../lib/agent-management-host'
import { exportVideoWithSubtitles } from '../lib/export-video-subtitles'
import { libraryExportPath } from '../lib/library-export'
import {
  cancelTranscription,
  deleteTranscriptSegments,
  getTranscriptionModelStatus,
  getTranscriptStatusMap,
  importLocalMediaForTranscription,
  insertTranscriptSegment,
  readTranscriptDetail,
  rediarizeTranscription,
  retryTranscription,
  selectTranscriptSource,
  startTranscriptionForDownload,
  type TranscriptSnapshot,
  updateTranscriptSegment,
  upgradeAndRetranscribe
} from '../lib/transcript-host'
import { defineMcpTool, mcpId, mcpLimit, mcpOffset, mcpPage } from './tool'

const downloadIdSchema = z.object({ downloadId: mcpId })
const speakerCount = z.union([
  z.literal('auto'),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8)
])
const exportFormat = z.enum(['txt', 'md', 'srt', 'vtt', 'json'])

/** Keep lifecycle responses small even when a complete transcript is already stored. */
function transcriptStatus(snapshot: TranscriptSnapshot) {
  const { record, ...status } = snapshot
  return {
    ...status,
    segmentCount: record?.segments.length ?? 0,
    language: record?.language ?? null,
    resultKind: record?.resultKind ?? null
  }
}

/** Read an existing selected transcript without starting imports or model work. */
function requireTranscript(downloadId: string) {
  const snapshot = readTranscriptDetail(downloadId)
  if (!snapshot.record) {
    throw new Error(
      'No transcript is available. Start transcription and wait for completion, or select an available caption source.'
    )
  }
  return snapshot.record
}

/** Format bounded transcript content using the same SubRip clock as Desktop exports. */
function exportText(
  record: ReturnType<typeof requireTranscript>,
  format: z.infer<typeof exportFormat>,
  offset: number,
  limit: number,
  options: {
    style: TranscriptExportStyle
    grouping: TranscriptExportGrouping
    showTimestamp: boolean
  }
) {
  const segments = record.segments.slice(offset, offset + limit)
  if (format === 'json') {
    return JSON.stringify({ ...record, segments }, null, 2)
  }
  if (format === 'srt') {
    return buildSrtDocument(buildExportUnits(segments, options.grouping))
  }
  if (format === 'vtt') {
    return `WEBVTT\n\n${buildExportUnits(segments, options.grouping)
      .map(
        (segment) =>
          `${formatSrtClock(segment.startMs).replace(',', '.')} --> ${formatSrtClock(segment.endMs).replace(',', '.')}\n${segment.text}`
      )
      .join('\n\n')}`
  }
  return buildTranscriptExportText({
    ...options,
    format,
    segments,
    resolveSpeaker: (speakerId) =>
      record.speakers.find((speaker) => speaker.id === speakerId)?.displayName ?? 'Speaker'
  })
}

/** Expose local import, full transcript reading/editing, subtitle export and model management. */
export function createMcpTranscriptTools() {
  return [
    defineMcpTool(
      'list_transcripts',
      'List transcript states and available caption/ASR sources. Query matches source ID or title; follow nextOffset.',
      z.object({ query: z.string().max(200).optional(), offset: mcpOffset, limit: mcpLimit }),
      ({ query, offset, limit }) => {
        const needle = query?.toLocaleLowerCase() ?? ''
        const items = Object.values(getTranscriptStatusMap()).filter((item) =>
          `${item.downloadTaskId}\n${item.title ?? ''}`.toLocaleLowerCase().includes(needle)
        )
        return mcpPage(items, offset, limit)
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_transcript',
      'Read paginated selected caption/ASR segments, speakers, source choices and timestamps. Optional query/time range filters and word timestamps. Follow nextOffset to read all text.',
      downloadIdSchema.extend({
        offset: mcpOffset,
        limit: mcpLimit,
        query: z.string().max(200).optional(),
        startMs: z.number().nonnegative().optional(),
        endMs: z.number().nonnegative().optional(),
        includeWords: z.boolean().default(false)
      }),
      ({ downloadId, query, startMs, endMs, offset, limit, includeWords }) => {
        const snapshot = readTranscriptDetail(downloadId)
        const needle = query?.toLocaleLowerCase() ?? ''
        const segments = (snapshot.record?.segments ?? []).filter(
          (segment) =>
            segment.text.toLocaleLowerCase().includes(needle) &&
            (startMs === undefined || segment.endMs >= startMs) &&
            (endMs === undefined || segment.startMs <= endMs)
        )
        const page = mcpPage(segments, offset, limit)
        return {
          ...transcriptStatus(snapshot),
          speakers: snapshot.record?.speakers ?? [],
          ...page,
          items: page.items.map(({ words, ...segment }) =>
            includeWords ? { ...segment, words } : segment
          )
        }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'import_media',
      'Import existing local audio/video files into the library for transcription. Paths must be absolute. Returns accepted items and explicit rejections; no file dialog is opened.',
      z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(50) }),
      ({ paths }) => {
        if (paths.some((file) => !path.isAbsolute(file))) {
          throw new Error('All media paths must be absolute')
        }
        return importLocalMediaForTranscription(paths)
      }
    ),
    defineMcpTool(
      'start_transcription',
      'Queue local transcription for a completed media download/import. force regenerates existing ASR; speakerCount can pin diarization. Returns admission; poll get_transcript for state.',
      downloadIdSchema.extend({
        force: z.boolean().default(false),
        speakerCount: speakerCount.optional()
      }),
      async ({ downloadId, force, speakerCount: count }) =>
        transcriptStatus(
          await startTranscriptionForDownload(downloadId, force, undefined, count, {
            origin: 'agent'
          })
        )
    ),
    defineMcpTool(
      'manage_transcription',
      'Retry/cancel transcription, rediarize speakers, switch caption/ASR source, or upgrade the ASR tier and retranscribe. key, speakerCount or tier is required for the respective action.',
      downloadIdSchema.extend({
        action: z.enum(['retry', 'cancel', 'rediarize', 'select_source', 'upgrade']),
        key: mcpId.optional(),
        speakerCount: speakerCount.optional(),
        tier: z.enum(ASR_TIER_IDS).optional()
      }),
      async (input) => {
        switch (input.action) {
          case 'retry':
            return transcriptStatus(await retryTranscription(input.downloadId))
          case 'cancel':
            return transcriptStatus(await cancelTranscription(input.downloadId))
          case 'rediarize':
            if (input.speakerCount === undefined) {
              throw new Error('speakerCount is required')
            }
            return transcriptStatus(
              await rediarizeTranscription(input.downloadId, input.speakerCount)
            )
          case 'select_source':
            if (!input.key) {
              throw new Error('key is required')
            }
            return transcriptStatus(await selectTranscriptSource(input.downloadId, input.key))
          case 'upgrade':
            if (!input.tier) {
              throw new Error('tier is required')
            }
            return transcriptStatus(await upgradeAndRetranscribe(input.downloadId, input.tier))
          default:
            throw new Error('Unknown transcription action')
        }
      }
    ),
    defineMcpTool(
      'update_transcript_segment',
      'Edit a selected transcript segment text, timing or speaker. Reads and edits use the same selected source as Desktop.',
      downloadIdSchema.extend({
        segmentId: mcpId,
        text: z.string().max(50_000).optional(),
        startMs: z.number().nonnegative().optional(),
        endMs: z.number().nonnegative().optional(),
        speakerId: mcpId.nullable().optional()
      }),
      ({ downloadId, segmentId, ...patch }) =>
        transcriptStatus(updateTranscriptSegment(downloadId, segmentId, patch)),
      { idempotentHint: true }
    ),
    defineMcpTool(
      'insert_transcript_segment',
      'Insert a caption before/after an existing segment or at a timestamp. Returns the new segment ID.',
      downloadIdSchema.extend({
        afterId: mcpId.nullable().optional(),
        beforeId: mcpId.nullable().optional(),
        atMs: z.number().nonnegative().optional(),
        text: z.string().max(50_000).optional(),
        speakerId: mcpId.nullable().optional()
      }),
      ({ downloadId, ...input }) => {
        const result = insertTranscriptSegment(downloadId, input)
        return { segmentId: result.segmentId, snapshot: transcriptStatus(result.snapshot) }
      }
    ),
    defineMcpTool(
      'delete_transcript_segments',
      'Delete explicitly identified captions from the selected source.',
      downloadIdSchema.extend({ segmentIds: z.array(mcpId).min(1).max(500) }),
      ({ downloadId, segmentIds }) =>
        transcriptStatus(deleteTranscriptSegments(downloadId, segmentIds)),
      { destructiveHint: true }
    ),
    defineMcpTool(
      'export_transcript',
      'Export the selected transcript using the detail page styles (transcript, subtitles, speaker segments, whisper), word/sentence grouping and timestamp option. Return paginated TXT/Markdown/SRT/VTT/JSON, or save the complete output to library/Exports with saveToFile=true. No dialogs or overwrites.',
      downloadIdSchema.extend({
        format: exportFormat.default('txt'),
        offset: mcpOffset,
        limit: mcpLimit,
        saveToFile: z.boolean().default(false),
        style: z.enum(['transcript', 'subtitles', 'segments', 'whisper']).default('transcript'),
        grouping: z.enum(['none', 'words', 'sentences']).default('none'),
        showTimestamp: z.boolean().default(true)
      }),
      async ({ downloadId, format, offset, limit, saveToFile, ...options }) => {
        const record = requireTranscript(downloadId)
        if (saveToFile) {
          const file = await libraryExportPath(
            readTranscriptDetail(downloadId).title ?? 'transcript',
            format
          )
          const content = exportText(record, format, 0, record.segments.length, options)
          await writeFile(file, content, { encoding: 'utf8', flag: 'wx' })
          return {
            path: file,
            bytes: Buffer.byteLength(content),
            segmentCount: record.segments.length
          }
        }
        return {
          content: exportText(record, format, offset, limit, options),
          ...mcpPage(
            record.segments.map((segment) => segment.id),
            offset,
            limit
          ),
          format
        }
      }
    ),
    defineMcpTool(
      'export_subtitled_video',
      'Export a completed local video with the selected transcript: soft muxes selectable subtitles into MKV; hard burns captions into MP4. Writes a unique file in the library Exports folder without dialogs. Wait for the result; concurrent exports are rejected.',
      downloadIdSchema.extend({ mode: z.enum(['soft', 'hard']).default('soft') }),
      async ({ downloadId, mode }, signal) => {
        const record = requireTranscript(downloadId)
        if (!record.sourceFilePath) {
          throw new Error('A local source video is required')
        }
        const outputPath = await libraryExportPath('subtitled', mode === 'soft' ? 'mkv' : 'mp4')
        const result = await exportVideoWithSubtitles(
          {
            defaultFileName: path.basename(outputPath),
            mode,
            sourcePath: record.sourceFilePath,
            subtitleText:
              mode === 'soft'
                ? buildSrtDocument(record.segments)
                : buildAssDocument(record.segments)
          },
          { outputPath, signal }
        )
        if (result.status === 'failed') {
          throw new Error(result.message)
        }
        if (result.status === 'unavailable') {
          throw new Error(result.reason)
        }
        return result
      }
    ),
    defineMcpTool(
      'manage_asr_model',
      'Inspect installed tiers; queue a model download; select a ready tier; or delete an inactive tier. Monitor model downloads with task tools.',
      z.object({
        action: z.enum(['status', 'download', 'select', 'delete']),
        tier: z.enum(ASR_TIER_IDS).optional()
      }),
      async ({ action, tier }, signal) => {
        if (action === 'status') {
          return getTranscriptionModelStatus()
        }
        if (!tier) {
          throw new Error('tier is required')
        }
        if (action === 'download') {
          return createAgentTask({ kind: 'model-download', asrTier: tier }, signal)
        }
        if (action === 'select') {
          return updateAgentSettings({ asrTier: tier })
        }
        return manageAgentAsr({ action: 'delete', tier })
      },
      { destructiveHint: true, openWorldHint: true }
    )
  ]
}
