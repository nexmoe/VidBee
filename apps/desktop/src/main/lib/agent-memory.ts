import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { type AgentThread, selectedAgentMessages } from '../../shared/agent-chat'

export const AGENT_NOTES_BYTES = 8192
export const AGENT_TOOL_BYTES = 32_768
/** Typical JSON wrapper around a text page (cursors, message ids). */
export const AGENT_PAGE_OVERHEAD_BYTES = 256

/** Reserve wrapper bytes without reducing a page to nothing. */
export function pageContentBudget(maxBytes: number, overhead = AGENT_PAGE_OVERHEAD_BYTES): number {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return 0
  }
  return maxBytes - Math.min(Math.max(0, overhead), maxBytes - 1)
}

/** Identify original messages independently of their position in a compacted request. */
export function agentMessageId(message: AgentMessage): string {
  if (message.role === 'toolResult') {
    return `tool:${message.toolCallId}`
  }
  return `message:${createHash('sha256').update(agentHistoryText(message)).digest('hex').slice(0, 24)}`
}

/** Serialize authoritative text once, without image pixels or duplicated tool metadata. */
export function agentHistoryText(message: AgentMessage): string {
  if (message.role === 'toolResult') {
    const details = message.details as { archivedText?: string } | undefined
    return JSON.stringify({
      ...message,
      details: undefined,
      content: details?.archivedText
        ? [{ type: 'text', text: details.archivedText }]
        : message.content.map((part) =>
            part.type === 'text'
              ? part
              : { type: 'text', text: '[Stored image; use read_artifact with its artifact ID]' }
          )
    })
  }
  return JSON.stringify(message, (key, value) => (key === 'data' ? '[Stored image]' : value))
}

/** Advance one UTF-16 code point without splitting a surrogate pair. */
function nextCodePoint(text: string, index: number): number {
  return Math.min(text.length, index + (/[\uD800-\uDBFF]/.test(text[index] ?? '') ? 2 : 1))
}

/** Return a UTF-8 and JSON bounded page without splitting a surrogate pair. */
export function agentTextPage(
  text: string,
  offset = 0,
  maxBytes = AGENT_TOOL_BYTES,
  overhead = AGENT_PAGE_OVERHEAD_BYTES
): {
  text: string
  nextOffset: number | null
  total: number
} {
  const start = Math.min(Math.max(0, offset), text.length)
  if (start >= text.length) {
    return { text: '', nextOffset: null, total: text.length }
  }
  const limit = Math.max(1, pageContentBudget(maxBytes, overhead))
  let low = start
  let high = Math.min(text.length, start + Math.max(limit, 1))
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(JSON.stringify(text.slice(start, middle))) <= limit) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  if (low < text.length && /[\uD800-\uDBFF]/.test(text[low - 1] ?? '')) {
    low -= 1
  }
  if (low <= start) {
    low = nextCodePoint(text, start)
  }
  return {
    text: text.slice(start, low),
    nextOffset: low < text.length ? low : null,
    total: text.length
  }
}

/** Inherit memory only from ancestors in the selected conversation branch. */
export function selectedAgentMemory(thread: AgentThread): {
  notes: string
  checkpoint: AgentThread['runs'][number]['contextCheckpoint']
  coverage: AgentThread['runs'][number]['evidenceCoverage']
  source: string | undefined
} {
  const runs = selectedAgentMessages(thread)
    .flatMap((message) => {
      const run = message.runId ? thread.runs.find((item) => item.id === message.runId) : undefined
      return run ? [run] : []
    })
    .reverse()
  return {
    coverage: runs.find((run) => run.evidenceCoverage)?.evidenceCoverage,
    source: runs.find((run) => run.evidenceCoverage)?.evidenceSource,
    notes: runs.find((run) => run.workingNotes !== undefined)?.workingNotes ?? '',
    checkpoint: runs.find((run) => run.contextCheckpoint)?.contextCheckpoint
  }
}
