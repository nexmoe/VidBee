import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { chineseScriptFromText, chineseScriptOf } from './chinese-script'
import { iso6391FromTag } from './iso-639'
import type { PipelineResult, PipelineSegment, PipelineSpeaker } from './types'

const SIMPLIFIED_CHINESE_TAGS = ['zh', 'zh-Hans', 'zh-CN', 'zh-SG'] as const
const TRADITIONAL_CHINESE_TAGS = ['zh-TW', 'zh-Hant', 'zh-HK', 'zh-MO'] as const

/**
 * Normalize a BCP-47 tag for caption matching.
 */
const normalizeCaptionTag = (tag: string): string => tag.trim().toLowerCase().replaceAll('_', '-')

export const CAPTIONS_MODEL_VERSION = 'embedded-captions'
export const CAPTION_FILE_EXTENSIONS = ['.vtt', '.srt', '.ass'] as const
const AUTO_CAPTION_PREFIX = /^(?:ai|auto|automatic)(?:-|$)/i
const NON_DIALOGUE_CAPTION_TAG = /^(?:danmaku|live[_-]?chat|rechat|chat)$/i

export interface CaptionCue {
  endMs: number
  startMs: number
  text: string
  /** Speaker name from a VTT voice tag or ASS Dialogue Name field. */
  speaker?: string | null
}

export interface CaptionTrack {
  format: 'ass' | 'srt' | 'vtt'
  language: string | null
  path?: string
  text: string
  title?: string
}

/**
 * True when this tag is platform auto-captions such as Bilibili `ai-zh`.
 *
 * @param tag Language, stream title, or sidecar suffix.
 */
export const isPlatformAiCaptionTag = (tag: string | null | undefined): boolean => {
  if (!tag?.trim()) {
    return false
  }
  const compact = normalizeCaptionTag(tag)
  if (AUTO_CAPTION_PREFIX.test(compact)) {
    return true
  }
  return compact.split('-').some((part) => AUTO_CAPTION_PREFIX.test(part))
}

/**
 * True when this tag is danmaku or a live-chat dump, not dialogue captions.
 *
 * @param tag Language, stream title, or sidecar suffix.
 */
export const isChatCaptionTag = (tag: string | null | undefined): boolean => {
  if (!tag?.trim()) {
    return false
  }
  const compact = normalizeCaptionTag(tag)
  if (NON_DIALOGUE_CAPTION_TAG.test(compact)) {
    return true
  }
  return compact.split('-').some((part) => NON_DIALOGUE_CAPTION_TAG.test(part))
}

/**
 * True when this tag is platform auto-captions, danmaku, or chat.
 *
 * @param tag Language, stream title, or sidecar suffix.
 */
export const isMachineCaptionTag = (tag: string | null | undefined): boolean =>
  isPlatformAiCaptionTag(tag) || isChatCaptionTag(tag)

/**
 * True when a sidecar name is a danmaku or chat dump.
 *
 * @param path Absolute or file name.
 */
export const isMachineCaptionPath = (path: string | null | undefined): boolean => {
  if (!path) {
    return false
  }
  const name = basename(path).toLowerCase()
  return /\.(?:danmaku|live[_-]chat|rechat)\.(?:ass|srt|vtt)$/i.test(name)
}

/**
 * True when this track is dialogue captions, including platform AI subs.
 *
 * Danmaku and chat dumps stay out. Bilibili `ai-zh` / `ai-en` sidecars are
 * valid caption sources and can be switched on the transcript page.
 *
 * @param track Language tag, optional stream title, and optional sidecar path.
 */
export const isImportableCaptionTrack = (track: {
  language?: string | null
  path?: string
  title?: string
}): boolean =>
  !(
    isChatCaptionTag(track.language) ||
    isChatCaptionTag(track.title) ||
    isMachineCaptionPath(track.path)
  )

/**
 * Alias kept for existing call sites: importable dialogue captions.
 *
 * @param track Language tag, optional stream title, and optional sidecar path.
 */
export const isHumanCaptionTrack = isImportableCaptionTrack

/**
 * Drop platform auto-caption prefixes so `ai-zh` matches Chinese, then map ffmpeg 639-2 tags.
 *
 * @param language Track language tag.
 */
export const captionLanguageForMatch = (language: string): string => {
  const compact = normalizeCaptionTag(language)
  let stripped = compact
  for (const prefix of ['ai-', 'auto-', 'automatic-']) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length)
      break
    }
  }
  if (stripped.endsWith('-auto')) {
    stripped = stripped.slice(0, -5)
  }
  return iso6391FromTag(stripped)
}

/**
 * Stable key used to match caption languages across files and stored rows.
 *
 * Platform AI prefixes stay (`ai-zh` vs `zh`). ffmpeg `zho` / `eng` collapse onto `zh` / `en`.
 *
 * @param language Track language tag.
 */
export const captionLanguageKey = (language: string | null | undefined): string => {
  if (!language?.trim()) {
    return 'und'
  }
  const compact = normalizeCaptionTag(language)
  if (isPlatformAiCaptionTag(compact)) {
    return compact
  }
  return captionLanguageForMatch(compact)
}

/**
 * Canonical language tag for a track: map ffmpeg 639-2 codes and split Chinese scripts.
 *
 * @param language Declared stream or sidecar tag.
 * @param text Caption document or cue text, used to tell Simplified from Traditional.
 */
export const refineCaptionLanguage = (language: string | null, text: string): string | null => {
  const script = chineseScriptFromText(text)
  if (script === 'hant') {
    return 'zh-Hant'
  }
  if (script === 'hans') {
    return 'zh'
  }
  if (!language?.trim()) {
    return language
  }
  return captionLanguageForMatch(language)
}

const TIMESTAMP =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/g
const VTT_ARROW = /-->/
const CUE_SETTINGS = /\s+(?:align|line|position|size|vertical):[^\s]+/gi
const MARKUP = /<[^>]+>|\{[^}]+\}/g
const VTT_VOICE_TAG = /<v(?:\.[^\s>]*)?\s+([^>]+)>/i

/**
 * Stable task id used when captions are imported without an ASR child task.
 *
 * @param downloadTaskId Parent download id.
 */
export const captionsTaskId = (downloadTaskId: string, language?: string | null): string => {
  const tag = language?.trim()
  return tag
    ? `captions:${downloadTaskId}:${captionLanguageKey(tag)}`
    : `captions:${downloadTaskId}`
}

/**
 * True when this subtitle codec can be converted to text (not bitmap).
 *
 * @param codecName ffprobe codec_name, if present.
 */
export const isTextSubtitleCodec = (codecName: string | null | undefined): boolean => {
  if (!codecName) {
    return true
  }
  const codec = codecName.toLowerCase()
  return !codec.includes('pgs') && !codec.includes('dvd_subtitle') && !codec.includes('dvb_subtitle')
}

/**
 * Convert a clock timestamp to milliseconds.
 *
 * @param hours Optional hour field.
 * @param minutes Minute field.
 * @param seconds Second field.
 * @param fraction Fractional seconds (1-3 digits).
 */
const toMs = (
  hours: string | undefined,
  minutes: string,
  seconds: string,
  fraction: string
): number => {
  const millis = `${fraction}000`.slice(0, 3)
  return (
    Number(hours ?? '0') * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    Number(millis)
  )
}

/**
 * Parse one `HH:MM:SS.mmm --> HH:MM:SS.mmm` (or SRT comma) line.
 *
 * @param line Timestamp line, optionally with VTT cue settings.
 */
const parseTimestampLine = (line: string): { endMs: number; startMs: number } | null => {
  const cleaned = line.replace(CUE_SETTINGS, '').trim()
  if (!VTT_ARROW.test(cleaned)) {
    return null
  }
  TIMESTAMP.lastIndex = 0
  const start = TIMESTAMP.exec(cleaned)
  const end = TIMESTAMP.exec(cleaned)
  if (!(start && end)) {
    return null
  }
  return {
    endMs: toMs(end[1], end[2] ?? '0', end[3] ?? '0', end[4] ?? '0'),
    startMs: toMs(start[1], start[2] ?? '0', start[3] ?? '0', start[4] ?? '0')
  }
}

/**
 * Strip WebVTT / SRT / ASS markup and collapse whitespace.
 *
 * @param raw Cue text, possibly with tags.
 */
export const cleanCaptionText = (raw: string): string =>
  raw
    .replace(MARKUP, ' ')
    .replace(/\\[nNh]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Read a WebVTT voice annotation as a speaker name, if present.
 *
 * @param raw Cue body before markup is stripped.
 */
const speakerFromCaptionMarkup = (raw: string): string | null => {
  const name = VTT_VOICE_TAG.exec(raw)?.[1]?.replace(/\s+/g, ' ').trim()
  return name || null
}

/**
 * Number speakers in first-appearance order using names from the caption file.
 *
 * @param cues Timed caption lines, some of which may name a speaker.
 */
const speakersFromCaptionCues = (
  cues: CaptionCue[]
): { speakers: PipelineSpeaker[]; keyByName: Map<string, string> } => {
  const speakers: PipelineSpeaker[] = []
  const keyByName = new Map<string, string>()
  for (const cue of cues) {
    const name = cue.speaker?.trim()
    if (!name || keyByName.has(name)) {
      continue
    }
    const speakerKey = `speaker-${speakers.length + 1}`
    keyByName.set(name, speakerKey)
    speakers.push({ speakerKey, displayName: name })
  }
  return { speakers, keyByName }
}

/**
 * Parse WebVTT or SRT cues from a subtitle document.
 *
 * @param text File or extracted track contents.
 */
export const parseCaptionCues = (text: string): CaptionCue[] => {
  const cues: CaptionCue[] = []
  const blocks = text.replace(/^\uFEFF/, '').split(/\r?\n\r?\n/)
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^WEBVTT\b/i.test(line) && !/^NOTE\b/i.test(line))
    if (lines.length === 0) {
      continue
    }
    let stampIndex = lines.findIndex((line) => VTT_ARROW.test(line))
    if (stampIndex < 0) {
      continue
    }
    const times = parseTimestampLine(lines[stampIndex] ?? '')
    if (!times || times.endMs <= times.startMs) {
      continue
    }
    const rawBody = lines.slice(stampIndex + 1).join(' ')
    const body = cleanCaptionText(rawBody)
    if (!body) {
      continue
    }
    const speaker = speakerFromCaptionMarkup(rawBody)
    cues.push(
      speaker
        ? { endMs: times.endMs, speaker, startMs: times.startMs, text: body }
        : { endMs: times.endMs, startMs: times.startMs, text: body }
    )
  }
  return cues
}

/**
 * Parse simple ASS `Dialogue:` rows when a sidecar is not VTT/SRT.
 *
 * @param text Advanced SubStation Alpha document.
 */
export const parseAssCues = (text: string): CaptionCue[] => {
  const cues: CaptionCue[] = []
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!rawLine.startsWith('Dialogue:')) {
      continue
    }
    const payload = rawLine.slice('Dialogue:'.length).trim()
    const parts = payload.split(',')
    if (parts.length < 10) {
      continue
    }
    const start = parseAssTime(parts[1] ?? '')
    const end = parseAssTime(parts[2] ?? '')
    if (start == null || end == null || end <= start) {
      continue
    }
    const body = cleanCaptionText(parts.slice(9).join(','))
    if (!body) {
      continue
    }
    const speaker = (parts[4] ?? '').trim()
    cues.push(
      speaker
        ? { endMs: end, speaker, startMs: start, text: body }
        : { endMs: end, startMs: start, text: body }
    )
  }
  return cues
}

/**
 * Parse an ASS clock like `0:00:01.00`.
 *
 * @param value ASS time field.
 */
const parseAssTime = (value: string): number | null => {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,2})$/)
  if (!match) {
    return null
  }
  const centis = `${match[4]}0`.slice(0, 2)
  return (
    Number(match[1]) * 3_600_000 +
    Number(match[2]) * 60_000 +
    Number(match[3]) * 1000 +
    Number(centis) * 10
  )
}

/**
 * Parse cues using the file format.
 *
 * @param text Subtitle document.
 * @param format Declared format.
 */
export const parseCaptionTrack = (text: string, format: CaptionTrack['format']): CaptionCue[] =>
  format === 'ass' ? parseAssCues(text) : parseCaptionCues(text)

/**
 * Read the language tag from a yt-dlp sidecar name such as `Title.en.vtt`.
 *
 * @param fileName File name only.
 * @param mediaStem Video file stem without extension.
 */
export const languageFromSidecarName = (fileName: string, mediaStem: string): string | null => {
  const ext = extname(fileName).toLowerCase()
  if (!CAPTION_FILE_EXTENSIONS.includes(ext as (typeof CAPTION_FILE_EXTENSIONS)[number])) {
    return null
  }
  const withoutExt = fileName.slice(0, -ext.length)
  if (withoutExt === mediaStem) {
    return null
  }
  if (!withoutExt.startsWith(`${mediaStem}.`)) {
    return null
  }
  const tag = withoutExt.slice(mediaStem.length + 1).trim()
  return tag || null
}

/**
 * Find yt-dlp sidecar subtitle files next to a downloaded video.
 *
 * @param sourceFilePath Absolute media path.
 */
export const findSidecarCaptionTracks = (sourceFilePath: string): CaptionTrack[] => {
  if (!existsSync(sourceFilePath)) {
    return []
  }
  const directory = dirname(sourceFilePath)
  const mediaStem = basename(sourceFilePath, extname(sourceFilePath))
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  const tracks: CaptionTrack[] = []
  for (const name of names) {
    const ext = extname(name).toLowerCase()
    if (!CAPTION_FILE_EXTENSIONS.includes(ext as (typeof CAPTION_FILE_EXTENSIONS)[number])) {
      continue
    }
    const language = languageFromSidecarName(name, mediaStem)
    if (language === null && basename(name, ext) !== mediaStem) {
      continue
    }
    const path = join(directory, name)
    if (!isHumanCaptionTrack({ language, path })) {
      continue
    }
    try {
      if (!statSync(path).isFile()) {
        continue
      }
      const text = readFileSync(path, 'utf8')
      if (!text.trim()) {
        continue
      }
      tracks.push({
        format: ext.slice(1) as CaptionTrack['format'],
        language,
        path,
        text
      })
    } catch {
      continue
    }
  }
  return tracks
}

/**
 * Language tags used to pick a caption track. Simplified and Traditional stay in separate buckets.
 *
 * @param language UI language tag.
 */
export const preferredCaptionLanguages = (language: string): string[] => {
  const tags: string[] = []
  const push = (tag: string): void => {
    const trimmed = tag.trim()
    if (!trimmed) {
      return
    }
    if (tags.some((item) => normalizeCaptionTag(item) === normalizeCaptionTag(trimmed))) {
      return
    }
    tags.push(trimmed)
  }
  push(language)
  const script = chineseScriptOf(language)
  if (script === 'hant') {
    for (const tag of TRADITIONAL_CHINESE_TAGS) {
      push(tag)
    }
  } else if (script === 'hans') {
    for (const tag of SIMPLIFIED_CHINESE_TAGS) {
      push(tag)
    }
  }
  const lower = normalizeCaptionTag(language)
  if (lower !== 'en' && !lower.startsWith('en-')) {
    push('en')
  }
  return tags
}

/**
 * Score a caption track against the user's language preference.
 *
 * @param language Track language tag.
 * @param preferred Preferred tags, highest first.
 */
export const captionLanguageScore = (
  language: string | null,
  preferred: string[]
): number => {
  const withAiPenalty = (score: number): number =>
    isPlatformAiCaptionTag(language) ? score - 40 : score
  if (!language) {
    return 1
  }
  const compact = captionLanguageForMatch(language)
  for (const [index, item] of preferred.entries()) {
    const want = normalizeCaptionTag(item)
    if (!want) {
      continue
    }
    const rank = 1000 - index * 10
    if (compact === want) {
      return withAiPenalty(rank)
    }
    const wantScript = chineseScriptOf(want)
    const haveScript = chineseScriptOf(compact)
    if (wantScript && haveScript) {
      if (wantScript === haveScript) {
        return withAiPenalty(rank - 2)
      }
      continue
    }
    if (compact.startsWith(`${want}-`) || want.startsWith(`${compact}-`)) {
      return withAiPenalty(rank)
    }
    const wantBase = want.split('-')[0]
    const haveBase = compact.split('-')[0]
    if (wantBase && haveBase === wantBase) {
      return withAiPenalty(rank - 5)
    }
  }
  if (compact === 'en' || compact.startsWith('en-')) {
    return withAiPenalty(20)
  }
  return withAiPenalty(2)
}

/**
 * Pick the caption track that best matches the UI language.
 *
 * Platform auto captions score below official tracks. A negative score still
 * wins when it is the only usable file, so Bilibili `ai-zh` is imported
 * instead of starting a local transcription.
 *
 * @param tracks Candidate tracks.
 * @param preferred Preferred language tags.
 */
export const pickCaptionTrack = <
  T extends { language: string | null; path?: string; text: string; title?: string }
>(
  tracks: T[],
  preferred: string[]
): T | null => {
  let best: T | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const track of tracks) {
    if (!(track.text.trim() && isImportableCaptionTrack(track))) {
      continue
    }
    const score = captionLanguageScore(track.language, preferred)
    if (score > bestScore) {
      best = track
      bestScore = score
    }
  }
  return best
}

/**
 * Turn parsed cues into a captions-sourced pipeline result.
 *
 * @param cues Timed caption lines.
 * @param language Chosen track language.
 */
export const pipelineResultFromCues = (
  cues: CaptionCue[],
  language: string | null
): PipelineResult | null => {
  const usable = cues.filter((cue) => cue.text && cue.endMs > cue.startMs)
  if (usable.length === 0) {
    return null
  }
  const { speakers, keyByName } = speakersFromCaptionCues(usable)
  const segments: PipelineSegment[] = usable.map((cue) => ({
    confidence: null,
    endMs: cue.endMs,
    speakerKey: cue.speaker ? (keyByName.get(cue.speaker.trim()) ?? null) : null,
    startMs: cue.startMs,
    text: cue.text,
    words: []
  }))
  return {
    asrTier: null,
    language,
    modelVersion: CAPTIONS_MODEL_VERSION,
    resultKind: 'transcript',
    segments,
    sourceKind: 'captions',
    speakers
  }
}
