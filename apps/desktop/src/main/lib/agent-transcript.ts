import {
  captionLanguageKey,
  findSidecarCaptionTracks,
  parseCaptionTrack,
  type TranscriptRecord
} from '@vidbee/transcription'
import type { AgentTranscriptLine } from './agent-tools'

/** Preserve source evidence, including speaker identity and word-level source timestamps. */
export function agentTranscriptLines(
  record: TranscriptRecord,
  sourceOffset = 0
): AgentTranscriptLine[] {
  const offset = record.sourceKind === 'asr' ? sourceOffset : 0
  const speakers = new Map(record.speakers.map((speaker) => [speaker.id, speaker.displayName]))
  return record.segments.map((line) => ({
    start: line.startMs / 1000 + offset,
    end: line.endMs / 1000 + offset,
    text: line.text,
    speakerId: line.speakerId,
    speaker: line.speakerId ? (speakers.get(line.speakerId) ?? null) : null,
    words: line.words.map((word) => ({
      start: word.startMs / 1000 + offset,
      end: word.endMs / 1000 + offset,
      text: word.text
    }))
  }))
}

/** Recover original cue timing for media tools without replacing the edited summary context. */
export function agentTimingLines(
  record: TranscriptRecord | null,
  fallback: AgentTranscriptLine[]
): AgentTranscriptLine[] {
  if (record?.sourceKind !== 'captions' || !record.sourceFilePath) {
    return fallback
  }
  try {
    const track = findSidecarCaptionTracks(record.sourceFilePath).find(
      (item) => captionLanguageKey(item.language) === captionLanguageKey(record.language)
    )
    if (!track) {
      return fallback
    }
    const cues = parseCaptionTrack(track.text, track.format)
    return cues.length
      ? cues.map((cue) => ({ start: cue.startMs / 1000, end: cue.endMs / 1000, text: cue.text }))
      : fallback
  } catch {
    return fallback
  }
}
