import {
  captionLanguageForMatch,
  captionLanguageKey,
  pipelineResultFromCues
} from '@vidbee/transcription'
import {
  AGENT_SUBTITLE_MODEL_VERSION,
  agentSubtitleInputSchema
} from '../../shared/agent-subtitles'
import { getDesktopTaskQueueRef } from './queue-ref'
import { broadcastTranscript, getTranscriptStore, readTranscriptDetail } from './transcript-host'

const MAX_TRACK_CUES = 50_000
const MAX_TRACK_CHARACTERS = 2_000_000
const MAX_REQUEST_BYTES = 100_000

/** Save user-requested, timed Agent subtitles as an additive automatic-caption source on this video only. */
export function addAgentSubtitles(downloadId: string, raw: unknown) {
  const input = agentSubtitleInputSchema.parse(raw)
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_REQUEST_BYTES) {
    throw new Error('Subtitle batch exceeds 100000 bytes; send smaller batches with append=true')
  }
  const locale = new Intl.Locale(input.language)
  if (!locale.language || ['und', 'mul', 'zxx'].includes(locale.language)) {
    throw new Error('Provide a known subtitle language such as en, zh, or ja')
  }
  const language = `ai-${captionLanguageForMatch(locale.toString())}`
  const key = `captions:${captionLanguageKey(language)}`
  if (!getDesktopTaskQueueRef().get(downloadId)) {
    throw new Error('The current video is unavailable')
  }
  const snapshot = readTranscriptDetail(downloadId)
  const store = getTranscriptStore()
  const existing = store
    .listForDownload(downloadId)
    .find(
      (record) =>
        record.sourceKind === 'captions' &&
        captionLanguageKey(record.language) === captionLanguageKey(language)
    )
  if (existing && existing.modelVersion !== AGENT_SUBTITLE_MODEL_VERSION) {
    throw new Error(
      'This subtitle source already exists; use list_transcripts and select_transcript to read it'
    )
  }
  if (!existing && snapshot.sources.some((source) => source.key === key)) {
    throw new Error('This subtitle source already exists as a local subtitle file')
  }
  const cues = input.cues.map((cue) => ({
    startMs: Math.round(cue.start * 1000),
    endMs: Math.round(cue.end * 1000),
    text: cue.text
  }))
  const all = new Map(
    (existing?.segments ?? []).map((cue) => [`${cue.startMs}:${cue.endMs}`, cue.text])
  )
  const added: typeof cues = []
  let lastStart = existing?.segments.at(-1)?.startMs ?? -1
  for (const cue of cues) {
    if (cue.endMs <= cue.startMs) {
      throw new Error(
        'Every subtitle must end after it starts with at least one millisecond duration'
      )
    }
    const range = `${cue.startMs}:${cue.endMs}`
    const text = all.get(range)
    if (text !== undefined) {
      if (text !== cue.text) {
        throw new Error(
          'A different subtitle already occupies this time range; existing subtitles were preserved'
        )
      }
      continue
    }
    if (cue.startMs < lastStart) {
      throw new Error('Send subtitles in chronological order, appending after the last saved cue')
    }
    if (existing && !input.append) {
      throw new Error(
        'Agent subtitles already exist; set append=true to add later cues without replacing them'
      )
    }
    added.push(cue)
    all.set(range, cue.text)
    lastStart = cue.startMs
  }
  const count = (existing?.segments.length ?? 0) + added.length
  const characters =
    (existing?.segments ?? []).reduce((sum, cue) => sum + cue.text.length, 0) +
    added.reduce((sum, cue) => sum + cue.text.length, 0)
  if (count > MAX_TRACK_CUES || characters > MAX_TRACK_CHARACTERS) {
    throw new Error('Subtitle track exceeds 50000 cues or 2000000 characters')
  }
  if (existing) {
    const record = added.length > 0 ? store.appendCaptionCues(existing.id, added) : existing
    broadcastTranscript(readTranscriptDetail(downloadId))
    return { key, record, added: added.length }
  }
  const result = pipelineResultFromCues(added, language)
  if (!result) {
    throw new Error('No usable subtitles were provided')
  }
  const record = store.commit({
    downloadTaskId: downloadId,
    transcriptionTaskId: `agent-subtitles:${downloadId}:${language}`,
    sourceFilePath: snapshot.sourceFilePath,
    activate: !store.hasCurrent(downloadId),
    result: { ...result, modelVersion: AGENT_SUBTITLE_MODEL_VERSION }
  })
  broadcastTranscript(readTranscriptDetail(downloadId))
  return { key, record, added: added.length }
}
