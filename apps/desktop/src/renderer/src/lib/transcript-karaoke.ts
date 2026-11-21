export interface TimedWord {
  endMs: number
  startMs: number
  text: string
}

const TRANSCRIPT_TOKEN_PATTERN =
  /(\s+)|([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^\s\p{L}\p{N}\p{M}]*)|([\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*[^\s\p{L}\p{N}\p{M}]*)|(\S+)/gu
const CJK_LIKE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u
const PUNCT_ONLY = /^[^\s\p{L}\p{N}\p{M}]+$/u
const SENTENCE_END = /[。！？!?…]["'"」』]*$/u
/** Keep real ASR words; longer blobs are captions that wrap inside one karaoke button. */
const COARSE_WORD_CHARS = 8

interface TranscriptToken {
  start: number
  text: string
  weight: number
}

/**
 * Return the last non-whitespace character in a token, if any.
 */
const lastSpokenChar = (text: string): string => text.trimEnd().at(-1) ?? ''

/**
 * Return the first non-whitespace character in a token, if any.
 */
const firstSpokenChar = (text: string): string => text.trimStart().at(0) ?? ''

/**
 * Latin words need a visible gap; CJK characters and attached punctuation do not.
 */
const needsGapBefore = (previous: string, current: string): boolean => {
  if (!current || /^\s/.test(current) || /\s$/.test(previous)) {
    return false
  }
  if (PUNCT_ONLY.test(current.trim())) {
    return false
  }
  const prevChar = lastSpokenChar(previous)
  const nextChar = firstSpokenChar(current)
  if (!(prevChar && nextChar)) {
    return false
  }
  return !(CJK_LIKE.test(prevChar) && CJK_LIKE.test(nextChar))
}

/**
 * True when this token closes a caption sentence and the next line should break.
 */
export const endsCaptionSentence = (text: string): boolean => SENTENCE_END.test(text.trimEnd())

/**
 * Keep a leading space on Latin words so adjacent karaoke buttons stay readable.
 */
const withTranscriptWordGaps = (words: TimedWord[]): TimedWord[] =>
  words.map((word, index) => {
    if (index === 0) {
      return word
    }
    const previous = words[index - 1]?.text ?? ''
    if (!needsGapBefore(previous, word.text)) {
      return word
    }
    return { ...word, text: ` ${word.text}` }
  })

/**
 * Split transcript text into timed tokens when ASR words are missing.
 */
const tokenizeTranscript = (text: string): TranscriptToken[] => {
  TRANSCRIPT_TOKEN_PATTERN.lastIndex = 0
  const tokens: TranscriptToken[] = []
  let match = TRANSCRIPT_TOKEN_PATTERN.exec(text)
  while (match) {
    const value = match[0]
    tokens.push({
      start: match.index,
      text: !match[1] && tokens.at(-1)?.weight === 0 ? ` ${value}` : value,
      weight: match[1] ? 0 : [...value].length
    })
    match = TRANSCRIPT_TOKEN_PATTERN.exec(text)
  }
  return tokens
}

/**
 * Re-tokenize a stored "word" that is actually a whole clause or caption line.
 *
 * Speaker merge and SenseVoice often persist one timestamp per 15s chunk. Karaoke
 * then wraps that blob in a `<button>`, and the UA `text-align: center` makes the
 * last line look centered.
 */
const expandCoarseWords = (words: TimedWord[]): TimedWord[] => {
  const expanded: TimedWord[] = []
  for (const word of words) {
    const spoken = tokenizeTranscript(word.text).filter((token) => token.weight > 0)
    const charCount = [...word.text].length
    const coarse = spoken.length > 1 && (/\s/.test(word.text) || charCount >= COARSE_WORD_CHARS)
    if (!coarse) {
      expanded.push(word)
      continue
    }
    const duration = Math.max(1, word.endMs - word.startMs)
    const totalWeight = spoken.reduce((sum, token) => sum + token.weight, 0)
    let seen = 0
    for (const token of spoken) {
      const startMs = word.startMs + (seen / totalWeight) * duration
      seen += token.weight
      const endMs = word.startMs + (seen / totalWeight) * duration
      expanded.push({
        endMs: Math.max(startMs + 1, endMs),
        startMs,
        text: token.text
      })
    }
  }
  return expanded
}

/**
 * Use ASR word timings, or interpolate tokens across the segment.
 */
export const wordsForSegment = (segment: {
  endMs: number
  startMs: number
  text: string
  words?: TimedWord[]
}): TimedWord[] => {
  if (segment.words && segment.words.length > 0) {
    return withTranscriptWordGaps(expandCoarseWords(segment.words))
  }
  const tokens = tokenizeTranscript(segment.text)
  const spoken = tokens.filter((token) => token.weight > 0)
  const totalWeight = spoken.reduce((sum, token) => sum + token.weight, 0)
  if (totalWeight === 0) {
    return []
  }
  const duration = Math.max(1, segment.endMs - segment.startMs)
  let seen = 0
  const interpolated = spoken.map((token) => {
    const startMs = segment.startMs + (seen / totalWeight) * duration
    seen += token.weight
    const endMs = segment.startMs + (seen / totalWeight) * duration
    return {
      endMs: Math.max(startMs + 1, endMs),
      startMs,
      text: token.text
    }
  })
  return withTranscriptWordGaps(interpolated)
}

/**
 * Player seconds for a karaoke word, nudged inside the token.
 *
 * Seeking to `startMs / 1000` can round back onto the previous word because
 * karaoke ranges are half-open (`endMs` of N is `startMs` of N+1).
 */
export const seekSecondsForWord = (word: TimedWord): number => {
  const innerMs = word.endMs > word.startMs + 1 ? word.startMs + 1 : word.startMs
  return innerMs / 1000
}

/**
 * Pick the most recently started word at the playhead.
 *
 * Rounding avoids `ms / 1000 * 1000` landing just before a token start, which
 * would highlight the previous word after a click. Later overlapping starts win.
 */
export const activeWordIndex = (words: TimedWord[], currentMs: number): number | null => {
  const t = Math.round(currentMs)
  let last = -1
  for (const [index, word] of words.entries()) {
    if (word.startMs <= t) {
      last = index
    }
  }
  return last >= 0 ? last : null
}
