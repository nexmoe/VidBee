import { applyViaVidBeeFilename } from '@vidbee/downloader-core/filename-style'

export type TranscriptExportStyle = 'transcript' | 'subtitles' | 'segments' | 'whisper' | 'video'
export type TranscriptExportFormat = 'txt' | 'md'
export type TranscriptVideoEncode = 'soft' | 'hard'
export type TranscriptExportGrouping = 'none' | 'words' | 'sentences'
export type TranscriptExportFileExtension = TranscriptExportFormat | 'mkv' | 'mp4'

export interface TranscriptExportSegment {
  endMs: number
  speakerId: string | null
  startMs: number
  text: string
}

export interface TranscriptExportUnit {
  endMs: number
  speakerId: string | null
  startMs: number
  text: string
}

export interface BuildTranscriptExportInput {
  format: TranscriptExportFormat
  grouping: TranscriptExportGrouping
  resolveSpeaker: (speakerId: string | null) => string
  segments: TranscriptExportSegment[]
  showTimestamp: boolean
  style: TranscriptExportStyle
}

interface TextPiece {
  end: number
  start: number
  text: string
}

const SENTENCE_SPLIT = /(?<=[.!?。！？…])\s*/

/**
 * Format a clock as `MM:SS.mmm`, matching the export preview.
 */
export const formatExportClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

/**
 * Format a cue timestamp as `HH:MM:SS,mmm` for subtitle files.
 */
export const formatSrtClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

/**
 * Format a cue timestamp as `H:MM:SS.cc` for ASS dialogue lines.
 */
export const formatAssClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const centis = Math.floor((total % 1000) / 10)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

/**
 * Escape cue text so libass does not treat it as override tags.
 */
export const escapeAssText = (text: string): string =>
  text
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll(/\r?\n/g, '\\N')

/**
 * Split text with Intl.Segmenter when available, then fall back to regex.
 */
const splitWithSegmenter = (text: string, granularity: 'word' | 'sentence'): TextPiece[] | null => {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    return null
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity })
  const pieces: TextPiece[] = []
  for (const part of segmenter.segment(text)) {
    const value = part.segment.trim()
    if (!value) {
      continue
    }
    if (granularity === 'word' && part.isWordLike === false) {
      continue
    }
    pieces.push({
      end: part.index + part.segment.length,
      start: part.index,
      text: value
    })
  }
  return pieces.length > 0 ? pieces : null
}

/**
 * Split a segment into word or sentence pieces and interpolate timestamps.
 */
const splitSegment = (
  segment: TranscriptExportSegment,
  grouping: Exclude<TranscriptExportGrouping, 'none'>
): TranscriptExportUnit[] => {
  const text = segment.text.trim()
  if (!text) {
    return []
  }

  const pieces =
    grouping === 'words'
      ? (splitWithSegmenter(text, 'word') ??
        text
          .split(/\s+/)
          .filter(Boolean)
          .map((value, index) => ({
            end: index + 1,
            start: index,
            text: value
          })))
      : (splitWithSegmenter(text, 'sentence') ??
        text
          .split(SENTENCE_SPLIT)
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value, index) => ({
            end: index + 1,
            start: index,
            text: value
          })))

  if (pieces.length === 0) {
    return [
      {
        endMs: segment.endMs,
        speakerId: segment.speakerId,
        startMs: segment.startMs,
        text
      }
    ]
  }

  const duration = Math.max(0, segment.endMs - segment.startMs)
  const lastEnd = pieces.at(-1)?.end ?? 1
  const span = Math.max(1, lastEnd)

  return pieces.map((piece) => ({
    endMs: segment.startMs + Math.round((piece.end / span) * duration),
    speakerId: segment.speakerId,
    startMs: segment.startMs + Math.round((piece.start / span) * duration),
    text: piece.text
  }))
}

/**
 * Expand source segments according to the selected grouping.
 */
export const buildExportUnits = (
  segments: TranscriptExportSegment[],
  grouping: TranscriptExportGrouping
): TranscriptExportUnit[] => {
  if (grouping === 'none') {
    return segments
      .map((segment) => ({
        endMs: segment.endMs,
        speakerId: segment.speakerId,
        startMs: segment.startMs,
        text: segment.text.trim()
      }))
      .filter((unit) => unit.text.length > 0)
  }

  return segments.flatMap((segment) => splitSegment(segment, grouping))
}

/**
 * Render one export unit in the selected style and file format.
 */
const renderUnit = (
  unit: TranscriptExportUnit,
  index: number,
  input: BuildTranscriptExportInput
): string => {
  const { format, resolveSpeaker, showTimestamp, style } = input
  const isMarkdown = format === 'md'
  const start = formatExportClock(unit.startMs)
  const range = `${start} --> ${formatExportClock(unit.endMs)}`
  const srtRange = `${formatSrtClock(unit.startMs)} --> ${formatSrtClock(unit.endMs)}`

  switch (style) {
    case 'subtitles': {
      if (isMarkdown) {
        const heading = showTimestamp ? `${index + 1}. \`${srtRange}\`` : `${index + 1}.`
        return `${heading}\n\n${unit.text}`
      }
      const lines = [String(index + 1)]
      if (showTimestamp) {
        lines.push(srtRange)
      }
      lines.push(unit.text)
      return lines.join('\n')
    }
    case 'segments': {
      const speaker = resolveSpeaker(unit.speakerId)
      if (isMarkdown) {
        const heading = showTimestamp ? `### ${speaker}\n\n\`${start}\`` : `### ${speaker}`
        return `${heading}\n\n${unit.text}`
      }
      const heading = showTimestamp ? `${speaker}  ${start}` : speaker
      return `${heading}\n${unit.text}`
    }
    case 'whisper':
      if (isMarkdown) {
        return showTimestamp ? `\`${range}\` ${unit.text}` : unit.text
      }
      return showTimestamp ? `[${range}]  ${unit.text}` : unit.text
    default:
      if (isMarkdown) {
        return showTimestamp ? `**${start}**\n\n${unit.text}` : unit.text
      }
      return showTimestamp ? `${start}\n${unit.text}` : unit.text
  }
}

/**
 * Build a SubRip document from export units.
 */
export const buildSrtDocument = (units: TranscriptExportUnit[]): string =>
  units
    .map((unit, index) => {
      const range = `${formatSrtClock(unit.startMs)} --> ${formatSrtClock(unit.endMs)}`
      return `${index + 1}\n${range}\n${unit.text}`
    })
    .join('\n\n')

/**
 * Build an ASS document used when burning captions into video.
 */
export const buildAssDocument = (units: TranscriptExportUnit[]): string => {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'PlayResX: 1920',
    'PlayResY: 1080',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,56,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,80,80,64,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const events = units.map((unit) => {
    const start = formatAssClock(unit.startMs)
    const end = formatAssClock(Math.max(unit.endMs, unit.startMs + 400))
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${escapeAssText(unit.text)}`
  })
  return [...header, ...events].join('\n')
}

/**
 * Build the plain-text export preview for the selected style and options.
 */
export const buildTranscriptExportText = (input: BuildTranscriptExportInput): string => {
  const units = buildExportUnits(input.segments, input.grouping)
  if (input.style === 'video') {
    return buildSrtDocument(units)
  }
  return units.map((unit, index) => renderUnit(unit, index, input)).join('\n\n')
}

/**
 * Pick the container extension for a video-and-subtitle export.
 */
export const videoEncodeExtension = (mode: TranscriptVideoEncode): 'mkv' | 'mp4' =>
  mode === 'soft' ? 'mkv' : 'mp4'

/**
 * Turn a media title into a safe export file name.
 *
 * @param title Media title.
 * @param format File extension without a leading dot.
 * @param viaVidBee Append `via VidBee` before the extension. Used for subtitle exports.
 */
export const buildTranscriptExportFileName = (
  title: string,
  format: TranscriptExportFileExtension = 'txt',
  viaVidBee = false
): string => {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  const name = `${base || 'transcript'}.${format}`
  return viaVidBee ? applyViaVidBeeFilename(name) : name
}

/**
 * Default file name for muxing or burning captions into a video.
 *
 * @param title Media title.
 * @param mode Soft mux or hard burn.
 */
export const buildVideoSubtitleExportFileName = (
  title: string,
  mode: TranscriptVideoEncode
): string => {
  const suffix = mode === 'soft' ? 'subs' : 'burned'
  return buildTranscriptExportFileName(`${title} ${suffix}`, videoEncodeExtension(mode), true)
}
