import type { TranscriptSnapshotView } from '@renderer/store/transcripts'
import { alignSubtitleCues } from '@shared/subtitle-export'

export type CaptionSource = NonNullable<TranscriptSnapshotView['sources']>[number]

export interface BilingualCue {
  startMs: number
  endMs: number
  text: string
}

/** Compare language families independently of region and platform auto-caption markers. */
export function captionLanguageFamily(language: string | null | undefined): string {
  return (language ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-')
    .replace(/^(?:ai|auto|automatic)-/, '')
    .split('-')[0]
}

/** Offer every other subtitle source, regardless of language or origin. */
export function bilingualCaptionSources(sources: readonly CaptionSource[]): CaptionSource[] {
  const selected = sources.find((source) => source.selected) ?? sources[0]
  return sources.filter((source) => source.key !== selected?.key)
}

/** Assign each secondary cue to its strongest time overlap, preserving differing cue boundaries. */
export function alignBilingualCaptions(
  primary: readonly (BilingualCue & { id: string })[],
  secondary: readonly BilingualCue[]
): Record<string, string> {
  const aligned = alignSubtitleCues(primary, secondary)
  return Object.fromEntries(
    primary.flatMap((cue, index) => (aligned[index] ? [[cue.id, aligned[index]]] : []))
  )
}
