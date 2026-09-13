/** i18n lookup used by thinking-duration labels. */
type Translate = (key: string, options?: Record<string, unknown>) => string

function unitLabel(t: Translate, unit: 'second' | 'minute', count: number): string {
  const plural = count === 1 ? '' : 's'
  const key =
    unit === 'second' ? `transcript.thinkingSecond${plural}` : `transcript.thinkingMinute${plural}`
  return t(key, { count })
}

function thinkingDuration(t: Translate, totalSeconds: number): string {
  if (totalSeconds < 60) {
    return unitLabel(t, 'second', totalSeconds)
  }
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  const minutesLabel = unitLabel(t, 'minute', minutes)
  if (rest === 0) {
    return minutesLabel
  }
  return `${minutesLabel} ${unitLabel(t, 'second', rest)}`
}

/**
 * Spoken thinking duration, e.g. "Thinking for 6 seconds" / "Thought for 6 seconds".
 */
export function thinkingDurationHeader(t: Translate, running: boolean, elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000))
  return t(running ? 'transcript.promptThinkingFor' : 'transcript.promptThoughtFor', {
    duration: thinkingDuration(t, seconds)
  })
}
