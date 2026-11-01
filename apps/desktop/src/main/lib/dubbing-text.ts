import type { SubtitleCue } from '../../shared/subtitle-export'
import type { DubbingInput } from '../../shared/video-localization'

export interface IndexedSubtitleCue extends SubtitleCue {
  /** One-based position in the complete saved source, retained when clip filtering removes cues. */
  cueIndex: number
}

/** Bind sparse spoken variants to exact saved cue text without modifying display captions or timing. */
export function resolveSpokenCues(
  cues: readonly IndexedSubtitleCue[],
  overrides: DubbingInput['speechOverrides']
): IndexedSubtitleCue[] {
  const originals = new Map(cues.map((cue) => [cue.cueIndex, cue]))
  const spoken = new Map<number, string>()
  for (const override of overrides ?? []) {
    if (spoken.has(override.cueIndex)) {
      throw new Error(`Duplicate speech override for cue ${override.cueIndex}`)
    }
    const cue = originals.get(override.cueIndex)
    if (!cue) {
      throw new Error(`Speech override cue ${override.cueIndex} is outside the selected media`)
    }
    if (cue.text !== override.originalText) {
      throw new Error(
        `Speech override cue ${override.cueIndex} does not match the saved subtitle; read the source again`
      )
    }
    spoken.set(override.cueIndex, override.text)
  }
  return cues.map((cue) => ({ ...cue, text: spoken.get(cue.cueIndex) ?? cue.text }))
}
