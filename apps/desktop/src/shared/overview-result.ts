import { parsePromptClock } from './ai-prompt-text'

const LIST_ITEM = /^(?:[-*]|\d+[.)])\s+(?:\*\*)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\*\*)?\s+(.*)$/u
const HEADING = /^(#{1,3})\s+(.+?)\s*$/u
const FENCE = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/u

export interface OverviewChapter {
  clock: string
  seconds: number
  summary: string
  title: string
}

export interface OverviewQuote {
  clock: string
  seconds: number
  quote: string
}

export interface ParsedOverview {
  chapters: OverviewChapter[]
  quotes: OverviewQuote[]
  takeaway: string
}

/**
 * True when the model returned at least one Overview field we can lay out.
 *
 * @param parsed Structured Overview.
 */
export const hasOverviewStructure = (parsed: ParsedOverview): boolean =>
  parsed.chapters.length > 0 || parsed.quotes.length > 0

export interface OverviewPlayhead {
  /** Chapter index that contains playback, or -1 before the first chapter. */
  index: number
  /** 0-1 progress through that chapter. */
  progress: number
}

/**
 * Locate the chapter that contains playback and how far that chapter has run.
 *
 * @param chapters Parsed Overview chapters in timeline order.
 * @param currentSeconds Player current time.
 * @param durationSeconds Media duration when known; ends the last chapter.
 */
export const overviewPlayhead = (
  chapters: readonly OverviewChapter[],
  currentSeconds: number,
  durationSeconds = 0
): OverviewPlayhead => {
  if (chapters.length === 0) {
    return { index: -1, progress: 0 }
  }
  let index = -1
  for (const [i, chapter] of chapters.entries()) {
    if (currentSeconds >= chapter.seconds) {
      index = i
      continue
    }
    break
  }
  if (index < 0) {
    return { index: -1, progress: 0 }
  }
  const start = chapters[index]?.seconds ?? 0
  const next = chapters[index + 1]?.seconds
  if (next === undefined && durationSeconds <= start) {
    return { index, progress: 0 }
  }
  const end = next ?? durationSeconds
  const span = end - start
  if (span <= 0) {
    return { index, progress: currentSeconds >= start ? 1 : 0 }
  }
  return {
    index,
    progress: Math.min(1, Math.max(0, (currentSeconds - start) / span))
  }
}

/**
 * Map a section heading onto chapters, quotes, or neither.
 *
 * @param heading Markdown heading text.
 */
const classifyOverviewHeading = (heading: string): 'chapters' | 'quotes' | 'other' => {
  const text = heading.trim()
  if (/quote|金句|引言|引用|名言|zitat|citation|cita/i.test(text)) {
    return 'quotes'
  }
  if (/chapter|章节|章節|チャプター|챕터|chapitre|kapitel|capítulo|capitolo/i.test(text)) {
    return 'chapters'
  }
  return 'other'
}

/**
 * Split a chapter line into title and optional summary after an em/en dash.
 *
 * @param rest Text after the clock token.
 */
const splitChapterCopy = (rest: string): { summary: string; title: string } => {
  const parts = rest.split(/\s+[—–]\s+/)
  const title = (parts[0] ?? '').trim()
  const summary = parts.slice(1).join(' — ').trim()
  return { summary, title }
}

/**
 * Strip wrapping quotation marks from a key quote.
 *
 * @param value Quote body from the model.
 */
const unwrapQuote = (value: string): string =>
  value
    .trim()
    .replace(/^(?:["“«「『]|'{2})/, '')
    .replace(/(?:["”»」』]|'{2})$/, '')
    .trim()

/**
 * True when the remainder of a list item looks like a spoken quote.
 *
 * @param rest Text after the clock token.
 */
const looksLikeQuote = (rest: string): boolean => /^\s*["“«「『]/.test(rest)

/**
 * Parse Overview markdown into a takeaway, chapters, and key quotes.
 *
 * @param markdown Raw prompt result, possibly still streaming.
 */
export const parseOverviewMarkdown = (markdown: string): ParsedOverview => {
  const source = markdown.trim().replace(FENCE, '$1')
  const parsed: ParsedOverview = { chapters: [], quotes: [], takeaway: '' }
  let section: 'lead' | 'chapters' | 'quotes' = 'lead'
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      const depth = heading[1]?.length ?? 0
      const title = heading[2]?.trim() ?? ''
      if (depth === 1 && !parsed.takeaway && classifyOverviewHeading(title) === 'other') {
        parsed.takeaway = title
      }
      const kind = classifyOverviewHeading(title)
      if (kind === 'chapters' || kind === 'quotes') {
        section = kind
      }
      continue
    }
    const item = line.match(LIST_ITEM)
    if (!item) {
      continue
    }
    const clock = item[1] ?? ''
    const seconds = parsePromptClock(clock)
    if (seconds === null) {
      continue
    }
    const rest = (item[2] ?? '').trim()
    if (!rest) {
      continue
    }
    const asQuote = section === 'quotes' || (section === 'lead' && looksLikeQuote(rest))
    if (asQuote) {
      parsed.quotes.push({ clock, quote: unwrapQuote(rest), seconds })
      continue
    }
    const { summary, title } = splitChapterCopy(rest)
    if (!title) {
      continue
    }
    parsed.chapters.push({ clock, seconds, summary, title })
    if (section === 'lead') {
      section = 'chapters'
    }
  }
  return parsed
}
