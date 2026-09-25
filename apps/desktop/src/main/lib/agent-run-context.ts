import { createHash } from 'node:crypto'
import {
  captionLanguageKey,
  findSidecarCaptionTracks,
  parseCaptionTrack
} from '@vidbee/transcription'
import type { AgentChatInput } from '../../shared/agent-chat'
import { AI_OVERVIEW_PROMPT_ID } from '../../shared/ai-prompts'
import { agentSourceMediaKind, agentSourceOffset } from './agent-media'
import { agentTimingLines, agentTranscriptLines } from './agent-transcript'
import { getDesktopTaskQueueRef } from './queue-ref'
import { getTranscriptSnapshot, getTranscriptStore } from './transcript-host'

/** One transcript paragraph with the timestamps used to locate it in the source. */
export interface AgentSourceLine {
  start: number
  end: number
  text: string
}

/** A ready subtitle source scoped to the current video, without local paths. */
export interface AgentTranscriptSource {
  key: string
  language: string | null
  languageCode: string | null
  kind: 'captions' | 'asr'
  auto: boolean
  selected: boolean
  lines: number
}

/**
 * Source evidence for one run, derived once so later stages stop recomputing it.
 *
 * Line text and its hash must stay together: the hash identifies which source a
 * resumed branch already read, so recomputing lines without it silently
 * invalidates inherited coverage.
 */
export interface AgentRunSource {
  lines: AgentSourceLine[]
  timingLines: AgentSourceLine[]
  evidenceSource: string
  transcripts: AgentTranscriptSource[]
  selectTranscript: (key: string) => AgentTranscriptSource
  sourceOffset: number
  mediaEnabled: boolean
  mediaKind: ReturnType<typeof agentSourceMediaKind>
  metadata: {
    title: string
    mediaKind: ReturnType<typeof agentSourceMediaKind>
    hasVideoFrames: boolean
    durationSeconds: number
  }
}

/**
 * Resolve transcript lines, timings, and source identity for a run.
 *
 * Falls back to a single synthetic line when no transcript record exists so the
 * agent still receives the caller's raw text as evidence.
 */
export function buildAgentRunSource(input: AgentChatInput, promptId: string): AgentRunSource {
  const transcript = getTranscriptSnapshot(input.downloadId)
  const task = getDesktopTaskQueueRef().get(input.downloadId)
  const sourceOffset = agentSourceOffset(task?.input.options?.startTime)
  const lines = transcript.record
    ? agentTranscriptLines(transcript.record, sourceOffset)
    : [{ start: 0, end: (input.sourceDurationMs ?? 0) / 1000, text: input.transcriptText ?? '' }]
  const timingLines = agentTimingLines(transcript.record, lines)
  const mediaKind = task ? agentSourceMediaKind(task) : 'video'
  const stored = getTranscriptStore().listForDownload(input.downloadId)
  const tracks = transcript.sourceFilePath
    ? findSidecarCaptionTracks(transcript.sourceFilePath)
    : []
  const available = transcript.sources.flatMap((option) => {
    const record = stored.find(
      (row) =>
        row.resultKind === 'transcript' &&
        row.sourceKind === option.kind &&
        (option.kind === 'asr' ||
          captionLanguageKey(row.language) === captionLanguageKey(option.language))
    )
    const track =
      option.kind === 'captions'
        ? tracks.find(
            (item) => captionLanguageKey(item.language) === captionLanguageKey(option.language)
          )
        : undefined
    const sourceLines = record
      ? agentTranscriptLines(record, sourceOffset)
      : track
        ? parseCaptionTrack(track.text, track.format).map((cue) => ({
            start: cue.startMs / 1000,
            end: cue.endMs / 1000,
            text: cue.text
          }))
        : []
    if (!sourceLines.length) {
      return []
    }
    return [
      {
        option: { ...option, lines: sourceLines.length },
        lines: sourceLines,
        timingLines: agentTimingLines(record ?? null, sourceLines)
      }
    ]
  })
  const result: AgentRunSource = {
    lines,
    timingLines: [...timingLines],
    transcripts: available.map((item) => item.option),
    selectTranscript: (key) => {
      const selected = available.find((item) => item.option.key === key)
      if (!selected) {
        throw new Error('Transcript source is unavailable for this video')
      }
      result.lines.splice(0, result.lines.length, ...selected.lines)
      result.timingLines.splice(0, result.timingLines.length, ...selected.timingLines)
      for (const item of result.transcripts) {
        item.selected = item.key === key
      }
      result.evidenceSource = createHash('sha256')
        .update(
          JSON.stringify({
            lines: result.lines,
            timingLines: result.timingLines
          })
        )
        .digest('hex')
      return selected.option
    },
    evidenceSource: createHash('sha256')
      .update(JSON.stringify({ lines, timingLines }))
      .digest('hex'),
    sourceOffset,
    mediaEnabled: promptId !== AI_OVERVIEW_PROMPT_ID,
    mediaKind,
    metadata: {
      title: task?.input.title ?? transcript.title ?? input.sourceTitle ?? '',
      mediaKind,
      hasVideoFrames: mediaKind === 'video',
      durationSeconds:
        Number(task?.input.options?.duration) ||
        (task?.output?.durationMs ?? input.sourceDurationMs ?? 0) / 1000 + sourceOffset
    }
  }
  return result
}

/** Reject image input before a run spends tokens discovering the model cannot accept it. */
export function assertAgentImagesSupported(
  model: { input: readonly string[] },
  imageCount: number
): void {
  if (imageCount > 0 && !model.input.includes('image')) {
    throw new Error('The selected model does not support image input')
  }
}
