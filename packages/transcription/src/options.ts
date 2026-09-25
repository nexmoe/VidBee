import type { TaskCreationMetadata, TaskInput } from '@vidbee/task-queue'
import { DEFAULT_ASR_TIER, parseAsrTier } from './asr-tiers'
import { DEFAULT_SPEAKER_COUNT, parseSpeakerCount } from './speaker-count'
import type { TranscriptionTaskOptions, TranscriptionTrigger } from './types'

/**
 * Keep a short BCP-47 tag so diarization can pick a language-matched embedding.
 */
const readOptionalLanguage = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 32) {
    return undefined
  }
  return trimmed
}

export const isTranscriptionTrigger = (value: unknown): value is TranscriptionTrigger =>
  value === 'manual' || value === 'auto' || value === 'force'

export function readTranscriptionOptions(input: TaskInput): TranscriptionTaskOptions | null {
  const raw = (input.options ?? {}) as Record<string, unknown>
  const downloadTaskId = typeof raw.downloadTaskId === 'string' ? raw.downloadTaskId : null
  const sourceFilePath =
    typeof raw.sourceFilePath === 'string'
      ? raw.sourceFilePath
      : input.url.startsWith('file:')
        ? input.url.slice('file://'.length)
        : input.url
  if (!(downloadTaskId && sourceFilePath)) {
    return null
  }
  return {
    downloadTaskId,
    sourceFilePath,
    trigger: isTranscriptionTrigger(raw.trigger) ? raw.trigger : 'manual',
    skipVad: raw.skipVad === true,
    asrTier: parseAsrTier(raw.asrTier, DEFAULT_ASR_TIER),
    language: readOptionalLanguage(raw.language),
    speakerCount: parseSpeakerCount(raw.speakerCount, DEFAULT_SPEAKER_COUNT),
    rediarize: raw.rediarize === true
  }
}

/** Build executor options and preserve the trusted caller's task provenance. */
export function buildTranscriptionInput(
  opts: TranscriptionTaskOptions & { title?: string; creation?: TaskCreationMetadata }
): TaskInput {
  return {
    url: `vidbee://download/${opts.downloadTaskId}`,
    kind: 'transcription',
    title: opts.title,
    options: {
      origin: 'manual',
      ...opts.creation,
      downloadTaskId: opts.downloadTaskId,
      sourceFilePath: opts.sourceFilePath,
      trigger: opts.trigger,
      skipVad: opts.skipVad === true,
      asrTier: parseAsrTier(opts.asrTier, DEFAULT_ASR_TIER),
      language: readOptionalLanguage(opts.language),
      speakerCount: parseSpeakerCount(opts.speakerCount, DEFAULT_SPEAKER_COUNT),
      rediarize: opts.rediarize === true
    }
  }
}
