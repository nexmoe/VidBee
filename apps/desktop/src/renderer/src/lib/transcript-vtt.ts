import type { TranscriptSegmentView } from '@renderer/store/transcripts'
import { buildExportUnits, type TranscriptExportUnit } from '@shared/transcript-export'

/** Two subtitle lines of Latin copy. */
const MAX_LATIN_CUE_CHARS = 84
/** Two subtitle lines of CJK copy. */
const MAX_CJK_CUE_CHARS = 36
const CJK_CHAR = /[\u4e00-\u9fff]/
const CLAUSE_SPLIT = /(?<=[,;:，、；])\s*/

/**
 * Format a millisecond offset as a WebVTT timestamp.
 */
export const formatVttTimestamp = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

/**
 * Count visible characters so CJK width wrapping does not use UTF-16 length.
 */
const graphemeCount = (text: string): number => [...text].length

/**
 * Cap a playback cue at two on-screen lines.
 */
const cueCharLimit = (text: string): number =>
  CJK_CHAR.test(text) ? MAX_CJK_CUE_CHARS : MAX_LATIN_CUE_CHARS

/**
 * Interpolate child cues across a parent cue by character weight.
 */
const timedPieces = (parent: TranscriptExportUnit, parts: string[]): TranscriptExportUnit[] => {
  const duration = Math.max(0, parent.endMs - parent.startMs)
  const total = parts.reduce((sum, part) => sum + Math.max(1, graphemeCount(part)), 0)
  let seen = 0
  return parts.map((text) => {
    const startMs = parent.startMs + Math.round((seen / total) * duration)
    seen += Math.max(1, graphemeCount(text))
    const endMs = parent.startMs + Math.round((seen / total) * duration)
    return { ...parent, endMs, startMs, text }
  })
}

/**
 * Break text into wrap atoms: clauses first, then words or CJK characters.
 */
const wrapAtoms = (text: string, limit: number): string[] => {
  const clauses = text
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean)
  if (clauses.length > 1) {
    return clauses.flatMap((clause) =>
      graphemeCount(clause) <= limit ? [clause] : wrapAtoms(clause, limit)
    )
  }
  if (CJK_CHAR.test(text)) {
    return [...text]
  }
  const words = text.split(/\s+/).filter(Boolean)
  return words.length > 0 ? words : [text]
}

/**
 * Pack wrap atoms into lines that stay within the overlay character limit.
 */
const packAtoms = (atoms: string[], limit: number, joinWith: string): string[] => {
  const extra = joinWith.length
  const parts: string[] = []
  let current: string[] = []
  let currentLen = 0
  for (const atom of atoms) {
    const add = graphemeCount(atom) + (current.length > 0 ? extra : 0)
    if (current.length > 0 && currentLen + add > limit) {
      parts.push(current.join(joinWith))
      current = [atom]
      currentLen = graphemeCount(atom)
    } else {
      current.push(atom)
      currentLen += add
    }
  }
  if (current.length > 0) {
    parts.push(current.join(joinWith))
  }
  return parts
}

/**
 * Split a long sentence cue so the overlay stays within two readable lines.
 */
const splitLongPlaybackCue = (unit: TranscriptExportUnit): TranscriptExportUnit[] => {
  const limit = cueCharLimit(unit.text)
  if (graphemeCount(unit.text) <= limit) {
    return [unit]
  }
  const cjk = CJK_CHAR.test(unit.text)
  const parts = packAtoms(wrapAtoms(unit.text, limit), limit, cjk ? '' : ' ')
  if (parts.length <= 1) {
    return [unit]
  }
  return timedPieces(unit, parts)
}

/**
 * Build a WebVTT document from transcript segments, one cue per sentence.
 *
 * Playback captions use the export dialog's sentence grouping, then wrap leftover
 * long sentences so a chunk does not stay on screen as one wall of text.
 */
export const buildVttText = (segments: TranscriptSegmentView[]): string | null => {
  const units = buildExportUnits(segments, 'sentences').flatMap(splitLongPlaybackCue)
  if (units.length === 0) {
    return null
  }
  return [
    'WEBVTT',
    '',
    ...units.map(
      (unit, index) =>
        `${index + 1}\n${formatVttTimestamp(unit.startMs)} --> ${formatVttTimestamp(unit.endMs)}\n${unit.text}\n`
    )
  ].join('\n')
}
