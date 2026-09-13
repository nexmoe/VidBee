import { captionLanguageForMatch, captionLanguageKey, isPlatformAiCaptionTag } from './captions'
import type { TranscriptRecord, TranscriptSourceOption } from './types'

/**
 * Build the captions-language and ASR choices for one download.
 *
 * @param input Current row, stored history, sidecar languages, and optional viewing key.
 */
export const buildTranscriptSources = (input: {
  asrActive?: boolean
  current: TranscriptRecord | null
  preferredKey?: string | null
  stored: TranscriptRecord[]
  tracks: Array<{ language: string | null }>
}): TranscriptSourceOption[] => {
  const seen = new Set<string>()
  const captionLangs: Array<{ auto: boolean; language: string | null }> = []
  const pushCaption = (language: string | null): void => {
    const key = captionLanguageKey(language)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    captionLangs.push({ auto: isPlatformAiCaptionTag(language), language })
  }
  for (const track of input.tracks) {
    pushCaption(track.language)
  }
  for (const row of input.stored) {
    if (row.sourceKind === 'captions') {
      pushCaption(row.language)
    }
  }
  const asrActive = Boolean(input.asrActive)
  const asrRecord = input.stored.find(
    (row) => row.sourceKind === 'asr' && row.resultKind === 'transcript'
  )
  const includeAsr =
    captionLangs.length > 0 || asrRecord || input.current?.sourceKind === 'asr' || asrActive
  const preferred =
    input.preferredKey &&
    (input.preferredKey === 'asr'
      ? includeAsr
      : captionLangs.some(
          (item) => `captions:${captionLanguageKey(item.language)}` === input.preferredKey
        ))
      ? input.preferredKey
      : null
  const currentCaptionKey =
    !(preferred || asrActive) && input.current?.sourceKind === 'captions'
      ? captionLanguageKey(input.current.language)
      : null
  const sources: TranscriptSourceOption[] = captionLangs.map((item) => {
    const key = `captions:${captionLanguageKey(item.language)}`
    const code = item.language ? captionLanguageForMatch(item.language) : null
    return {
      auto: item.auto,
      key,
      kind: 'captions',
      language: item.language,
      languageCode: code || item.language,
      selected: preferred
        ? preferred === key
        : currentCaptionKey === captionLanguageKey(item.language)
    }
  })
  if (includeAsr) {
    sources.push({
      auto: false,
      key: 'asr',
      kind: 'asr',
      language: asrRecord?.language ?? null,
      languageCode: asrRecord?.language ?? null,
      selected: preferred ? preferred === 'asr' : asrActive || input.current?.sourceKind === 'asr'
    })
  }
  return sources
}

/**
 * Pick the stored row that matches the source the user is viewing.
 *
 * ASR without a finished transcript returns null so the idle empty state can
 * show. Captions still fall back to the latest row when a language is missing.
 *
 * @param selected Option marked selected in `buildTranscriptSources`.
 * @param stored History for this download, newest first.
 * @param fallback Latest row when a captions source has no finished record.
 */
export const recordForTranscriptSource = (
  selected: TranscriptSourceOption | undefined,
  stored: TranscriptRecord[],
  fallback: TranscriptRecord | null
): TranscriptRecord | null => {
  if (!selected) {
    return fallback
  }
  if (selected.kind === 'captions') {
    const want = captionLanguageKey(selected.language)
    return (
      stored.find(
        (row) =>
          row.sourceKind === 'captions' &&
          row.resultKind === 'transcript' &&
          captionLanguageKey(row.language) === want
      ) ?? fallback
    )
  }
  return stored.find((row) => row.sourceKind === 'asr' && row.resultKind === 'transcript') ?? null
}
