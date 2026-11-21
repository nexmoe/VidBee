import { captionLanguageForMatch, captionLanguageKey, isPlatformAiCaptionTag } from './captions'
import type { TranscriptResultKind, TranscriptSourceKind, TranscriptSourceOption } from './types'

/** Fields source selection reads. Full records and SQL heads both satisfy this. */
export interface TranscriptSourceMeta {
  language: string | null
  resultKind: TranscriptResultKind
  sourceKind: TranscriptSourceKind
}

/** One transcript row without speakers, caption text, or word timestamps. */
export interface TranscriptHead extends TranscriptSourceMeta {
  asrTier: string | null
  createdAt: number
  downloadTaskId: string
  id: string
  modelVersion: string
  sourceFilePath: string | null
  supersededAt: number | null
  transcriptionTaskId: string
  updatedAt: number
}

/**
 * Build the captions-language and ASR choices for one download.
 *
 * @param input Current row, stored history, sidecar languages, and optional viewing key.
 */
export const buildTranscriptSources = (input: {
  asrActive?: boolean
  current: TranscriptSourceMeta | null
  preferredKey?: string | null
  stored: readonly TranscriptSourceMeta[]
  tracks: ReadonlyArray<{ language: string | null }>
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
 * History may be superseded; callers must pass every row, newest first.
 *
 * @param selected Option marked selected in `buildTranscriptSources`.
 * @param stored History for this download, newest first.
 * @param fallback Latest row when a captions source has no finished record.
 */
export const recordForTranscriptSource = <T extends TranscriptSourceMeta>(
  selected: TranscriptSourceOption | undefined,
  stored: readonly T[],
  fallback: T | null
): T | null => {
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

/**
 * Latest current row, or the newest row for the latest task when nothing is current.
 *
 * @param heads Rows for one download, newest first.
 * @param latestTaskId Newest transcription child, if any.
 */
export const latestTranscriptHead = <T extends TranscriptHead>(
  heads: readonly T[],
  latestTaskId: string | null
): T | null => {
  const current = heads.find((head) => head.supersededAt == null)
  if (current) {
    return current
  }
  if (!latestTaskId) {
    return null
  }
  return heads.find((head) => head.transcriptionTaskId === latestTaskId) ?? null
}

/**
 * Resolve the transcript row `getTranscriptSnapshot` would select, using heads only.
 *
 * @param input Newest-first heads, sidecar languages, and the viewing key.
 */
export const resolveTranscriptHeads = <T extends TranscriptHead>(input: {
  asrActive: boolean
  heads: readonly T[]
  latestTaskId: string | null
  preferredKey?: string | null
  tracks: ReadonlyArray<{ language: string | null }>
}): { latest: T | null; selected: T | null; sources: TranscriptSourceOption[] } => {
  const latest = latestTranscriptHead(input.heads, input.latestTaskId)
  const sources = buildTranscriptSources({
    asrActive: input.asrActive,
    current: latest,
    preferredKey: input.preferredKey,
    stored: input.heads,
    tracks: input.tracks
  })
  const selected = recordForTranscriptSource(
    sources.find((item) => item.selected),
    input.heads,
    latest
  )
  return { latest, selected, sources }
}

/**
 * Group newest-first heads by download without copying row objects.
 *
 * @param heads Library heads, newest first.
 */
export const groupTranscriptHeads = (
  heads: readonly TranscriptHead[]
): Map<string, TranscriptHead[]> => {
  const grouped = new Map<string, TranscriptHead[]>()
  for (const head of heads) {
    const rows = grouped.get(head.downloadTaskId)
    if (rows) {
      rows.push(head)
    } else {
      grouped.set(head.downloadTaskId, [head])
    }
  }
  return grouped
}
