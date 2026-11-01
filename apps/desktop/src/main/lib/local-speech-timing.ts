import type { SubtitleCue } from '../../shared/subtitle-export'

/** Validate the entire timeline before inference and retain each cue's available source interval. */
export function speechCueIntervals(cues: readonly SubtitleCue[], duration: number) {
  const intervals: { start: number; end: number }[] = []
  let cursor = 0
  for (const [index, cue] of cues.entries()) {
    const start = cue.startMs / 1000
    const next = cues[index + 1]
    const end = Math.min(cue.endMs / 1000, next ? next.startMs / 1000 : duration, duration)
    if (start < cursor - 0.001 || end <= start) {
      throw new Error(`Cue ${index + 1} has overlapping or out-of-range timing`)
    }
    intervals.push({ start, end })
    cursor = end
  }
  return intervals
}

/** Reject overflow immediately after inference and use the same tempo limit during final alignment. */
export function speechCueSpeed(
  duration: number,
  available: number,
  maxSpeed: number,
  index: number
): number {
  const requiredSpeed = Math.max(1, duration / available)
  if (requiredSpeed > maxSpeed) {
    throw new Error(
      `Cue ${index + 1} needs ${requiredSpeed.toFixed(2)}x speech speed, above ${maxSpeed}x. Shorten its spoken text with speechOverrides while preserving meaning and subtitle timing; no speech was truncated.`
    )
  }
  return Math.min(maxSpeed, Math.max(1, (duration / available) * 1.02))
}
