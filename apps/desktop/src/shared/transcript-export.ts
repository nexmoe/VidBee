import { applyViaVidBeeFilename } from '@vidbee/downloader-core/filename-style'
import { buildSrtDocument, formatSrtClock } from './subtitle-export'

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
