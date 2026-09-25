import { parseAssCues, parseCaptionCues } from '@vidbee/transcription'

export type ExtensionTranscriptStatus = 'running' | 'completed' | 'error'
export type ExtensionTranscriptErrorCode = 'noCaptions' | 'unavailable' | 'blocked' | 'network'

/** Start a Desktop caption extract for the current watch URL. */
export interface ExtensionTranscriptInput {
  requestId: string
  sourceUrl: string
  language?: string
  refresh?: boolean
}

export interface ExtensionTranscriptSegment {
  start: number
  end: number
  text: string
}

export interface ExtensionTranscriptTrack {
  id: string
  language: string
  label: string
  auto: boolean
}

/** Public caption result; local file paths stay in Desktop. */
export interface ExtensionTranscriptSnapshot {
  status: ExtensionTranscriptStatus
  error: string | null
  errorCode: ExtensionTranscriptErrorCode | null
  title: string
  author: string
  duration: number
  tracks: ExtensionTranscriptTrack[]
  selectedTrackId: string
  segments: ExtensionTranscriptSegment[]
  updatedAt: number
}

/** A short-lived capability grants access to only this caption extract. */
export interface ExtensionTranscriptJob {
  id: string
  token: string
  snapshot: ExtensionTranscriptSnapshot
}

export type CaptionSidecarFormat = 'ass' | 'json3' | 'srt' | 'vtt'

/** Read the language tag and format from a yt-dlp caption sidecar name. */
export function parseCaptionSidecarName(
  fileName: string
): { auto: boolean; format: CaptionSidecarFormat; language: string } | null {
  const match = fileName.match(/^[^/\\]+?\.([A-Za-z0-9][A-Za-z0-9-]*)\.(vtt|srt|ass|json3)$/i)
  if (!(match?.[1] && match[2])) {
    return null
  }
  const language = match[1]
  const format = match[2].toLowerCase() as CaptionSidecarFormat
  const auto = /(?:^|-)(?:ai|auto|orig)(?:-|$)/i.test(language)
  return { auto, format, language }
}

/** Parse JSON3, WebVTT, SRT, or ASS caption text into timed cues. */
export function captionCuesFromPayload(
  text: string,
  format: CaptionSidecarFormat
): Array<{ endMs: number; startMs: number; text: string }> {
  if (format === 'json3') {
    return readJson3Cues(text)
  }
  const cues = format === 'ass' ? parseAssCues(text) : parseCaptionCues(text)
  return cues.map((cue) => ({ endMs: cue.endMs, startMs: cue.startMs, text: cue.text }))
}

/** Pick the requested track, otherwise a human track, otherwise the first. */
export function pickExtensionCaptionTrack<
  T extends { auto: boolean; id: string; language: string }
>(tracks: T[], requested?: string): T | undefined {
  if (requested) {
    return (
      tracks.find((track) => track.id === requested) ??
      tracks.find((track) => track.language === requested)
    )
  }
  return tracks.find((track) => !track.auto) ?? tracks[0]
}

/** Map yt-dlp caption-extract stderr onto the extension's transcript error codes. */
export function classifyCaptionExtractError(stderr: string): ExtensionTranscriptErrorCode {
  if (
    /no subtitles|doesn't have subtitles|does not have subtitles|subtitles for the requested languages/i.test(
      stderr
    )
  ) {
    return 'noCaptions'
  }
  if (
    /private video|sign in|login required|unavailable|not available|has been removed/i.test(stderr)
  ) {
    return 'unavailable'
  }
  if (
    /http error 403|blocked|po token|confirm you’re not a bot|confirm you're not a bot/i.test(
      stderr
    )
  ) {
    return 'blocked'
  }
  return 'network'
}

/** Parse YouTube JSON3 caption events without speaker metadata. */
function readJson3Cues(text: string): Array<{ endMs: number; startMs: number; text: string }> {
  try {
    const payload = JSON.parse(text) as {
      events?: Array<{ dDurationMs?: number; segs?: Array<{ utf8?: string }>; tStartMs?: number }>
    }
    if (!Array.isArray(payload.events)) {
      return []
    }
    const cues: Array<{ endMs: number; startMs: number; text: string }> = []
    for (const event of payload.events) {
      if (!Array.isArray(event.segs)) {
        continue
      }
      const caption = event.segs
        .map((segment) => segment.utf8 ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      const startMs = Number(event.tStartMs)
      if (!(caption && Number.isFinite(startMs))) {
        continue
      }
      cues.push({
        endMs: startMs + Number(event.dDurationMs || 2000),
        startMs,
        text: caption
      })
    }
    return cues
  } catch {
    return []
  }
}
