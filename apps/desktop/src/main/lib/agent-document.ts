import { documentResultBudget } from './agent-budget'
import type { AgentTranscriptLine, AgentTranscriptPageLine } from './agent-tools'

export { documentResultBudget }

/** JSON wrapper around a document page (coverage, cursors, references). */
export const DOCUMENT_RESULT_OVERHEAD_BYTES = 1024
/** Smallest page that can still include a speaker label and a text slice. */
export const MIN_DOCUMENT_PAGE_BYTES = 2048
/** Smallest serialized document result, including wrapper overhead. */
export const MIN_DOCUMENT_RESULT_BYTES = MIN_DOCUMENT_PAGE_BYTES + DOCUMENT_RESULT_OVERHEAD_BYTES

/** Size a document page so wrapper overhead cannot reduce it to zero. */
export function documentPageBudget(resultMaxBytes: number): number {
  return Math.max(MIN_DOCUMENT_PAGE_BYTES, resultMaxBytes - DOCUMENT_RESULT_OVERHEAD_BYTES)
}

/** Count a string as it would appear inside JSON, excluding the surrounding quotes. */
function jsonStringBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text)) - 2
}

/** Slice source text to a JSON-string byte budget without splitting a surrogate pair. */
function sliceJsonString(text: string, offset: number, maxBytes: number): string {
  let low = Math.min(offset, text.length)
  let high = Math.min(text.length, low + Math.max(0, maxBytes))
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (jsonStringBytes(text.slice(offset, middle)) <= maxBytes) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  if (low < text.length && /[\uD800-\uDBFF]/.test(text[low - 1] ?? '')) {
    low -= 1
  }
  return text.slice(offset, low)
}

/** Prepare complete evidence only when it fits, without marking a partial page as supplied. */
export function prepareAgentDocument(lines: AgentTranscriptLine[], maxBytes: number) {
  if (
    !lines.length ||
    maxBytes < 1024 ||
    lines.reduce((bytes, line) => bytes + Buffer.byteLength(line.text), 0) > maxBytes
  ) {
    return undefined
  }
  const page = readAgentDocument({
    lines,
    globalIndices: new Map(lines.map((line, index) => [line, index])),
    offset: 0,
    textOffset: 0,
    maxBytes,
    timestamps: true
  })
  return page.nextOffset === lines.length ? page : undefined
}

/** Read prose with stable source references, keeping media alignment out of the writing context. */
export function readAgentDocument(input: {
  lines: AgentTranscriptLine[]
  globalIndices: Map<AgentTranscriptLine, number>
  offset: number
  textOffset: number
  maxBytes: number
  timestamps?: boolean
  wholeLines?: boolean
}) {
  const selected: AgentTranscriptPageLine[] = []
  const parts: string[] = []
  let usedBytes = 0
  let nextOffset = input.offset
  let nextTextOffset = input.textOffset
  let previousSpeaker: string | null | undefined
  while (nextOffset < input.lines.length) {
    const line = input.lines[nextOffset]
    if (nextTextOffset > line.text.length) {
      throw new Error('textOffset exceeds this line length')
    }
    const globalLineOffset = input.globalIndices.get(line) ?? nextOffset
    const speaker = line.speaker ?? line.speakerId
    const label = `${speaker && speaker !== previousSpeaker ? `[Speaker: ${speaker}]\n` : ''}[L${globalLineOffset}${nextTextOffset ? `:${nextTextOffset}` : ''}] ${input.timestamps ? `[@${line.start.toFixed(2)}s] ` : ''}`
    const overhead = jsonStringBytes(`${label}\n`)
    const remaining = input.maxBytes - usedBytes - overhead
    const remainingText = line.text.slice(nextTextOffset)
    if (input.wholeLines && selected.length && jsonStringBytes(remainingText) > remaining) {
      break
    }
    const text =
      jsonStringBytes(remainingText) <= remaining
        ? remainingText
        : sliceJsonString(line.text, nextTextOffset, Math.max(0, remaining))
    if (!text && remainingText) {
      break
    }
    const part = `${label}${text}\n`
    if (usedBytes + jsonStringBytes(part) > input.maxBytes) {
      break
    }
    usedBytes += jsonStringBytes(part)
    parts.push(part)
    selected.push({
      ...line,
      text,
      words: undefined,
      lineOffset: nextOffset,
      globalLineOffset,
      textOffset: nextTextOffset
    })
    previousSpeaker = speaker
    nextTextOffset += text.length
    if (nextTextOffset < line.text.length) {
      break
    }
    nextOffset += 1
    nextTextOffset = 0
  }
  if (!selected.length && nextOffset < input.lines.length) {
    throw new Error(
      'The document page cannot fit in the available context. Do not retry with a smaller range or limit; continue from firstUnread or answer with evidence already read.'
    )
  }
  return { selected, document: parts.join(''), nextOffset, nextTextOffset }
}
