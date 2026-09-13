import { createHash } from 'node:crypto'
import type { AgentChatInput } from '../../shared/agent-chat'
import { AI_OVERVIEW_PROMPT_ID } from '../../shared/ai-prompts'
import { agentSourceMediaKind, agentSourceOffset } from './agent-media'
import { agentTimingLines, agentTranscriptLines } from './agent-transcript'
import { getDesktopTaskQueueRef } from './queue-ref'
import { getTranscriptSnapshot } from './transcript-host'

/** One transcript paragraph with the timestamps used to locate it in the source. */
export interface AgentSourceLine {
  start: number
  end: number
  text: string
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
    : [{ start: 0, end: (input.sourceDurationMs ?? 0) / 1000, text: input.transcriptText }]
  const timingLines = agentTimingLines(transcript.record, lines)
  const mediaKind = task ? agentSourceMediaKind(task) : 'video'
  return {
    lines,
    timingLines,
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
