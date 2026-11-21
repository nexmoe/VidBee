/** Clock tokens written as `m:ss` or `h:mm:ss`. */
export const PROMPT_CLOCK_PATTERN = String.raw`\b(?:\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})\b`

/**
 * Format a millisecond offset as `m:ss` or `h:mm:ss` for prompt timestamps.
 *
 * @param ms Offset from the start of the media.
 */
export const formatPromptClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

/**
 * Parse a prompt clock token into seconds, or null when the token is not a clock.
 *
 * @param value `m:ss` or `h:mm:ss` text.
 */
export const parsePromptClock = (value: string): number | null => {
  const parts = value.split(':').map((part) => Number.parseInt(part, 10))
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null
  }
  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts
    if (seconds > 59) {
      return null
    }
    return minutes * 60 + seconds
  }
  const [hours = 0, minutes = 0, seconds = 0] = parts
  if (minutes > 59 || seconds > 59) {
    return null
  }
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * Join speaker-labeled transcript lines for an LLM prompt.
 *
 * @param segments Transcript rows with speaker labels and text.
 * @param resolveSpeaker Display name for a speaker id.
 */
export const buildPromptTranscriptText = (
  segments: ReadonlyArray<{ speakerId: string | null; text: string }>,
  resolveSpeaker: (speakerId: string | null) => string
): string =>
  segments
    .map((segment) => {
      const speaker = segment.speakerId ? resolveSpeaker(segment.speakerId).trim() : ''
      const text = segment.text.trim()
      if (!text) {
        return ''
      }
      return speaker ? `${speaker}: ${text}` : text
    })
    .filter((line) => line.length > 0)
    .join('\n')

interface OverviewPromptTranscriptInput {
  durationMs?: number
  title?: string | null
}

/**
 * Join timestamped transcript lines for the Overview prompt.
 *
 * @param segments Transcript rows with speaker labels, text, and start times.
 * @param resolveSpeaker Display name for a speaker id.
 * @param input Optional title and duration shown above the lines.
 */
export const buildOverviewPromptTranscriptText = (
  segments: ReadonlyArray<{ speakerId: string | null; startMs: number; text: string }>,
  resolveSpeaker: (speakerId: string | null) => string,
  input: OverviewPromptTranscriptInput = {}
): string => {
  const lines = segments
    .map((segment) => {
      const speaker = segment.speakerId ? resolveSpeaker(segment.speakerId).trim() : ''
      const text = segment.text.trim()
      if (!text) {
        return ''
      }
      const body = speaker ? `${speaker}: ${text}` : text
      return `[${formatPromptClock(segment.startMs)}] ${body}`
    })
    .filter((line) => line.length > 0)
  const header: string[] = []
  const title = input.title?.trim()
  if (title) {
    header.push(`Title: ${title}`)
  }
  if ((input.durationMs ?? 0) > 0) {
    header.push(`Duration: ${formatPromptClock(input.durationMs ?? 0)}`)
  }
  if (header.length === 0) {
    return lines.join('\n')
  }
  return `${header.join('\n')}\n\n${lines.join('\n')}`
}
