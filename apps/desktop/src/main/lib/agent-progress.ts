import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

/**
 * Structural view of one assistant turn.
 *
 * Loose on purpose so SDK messages, custom messages whose content is a plain
 * string, and test fixtures all satisfy it without a cast at each call site.
 */
export interface AgentTurnLike {
  role?: string
  stopReason?: string
  errorMessage?: string
  content?: string | { type: string; text?: string }[]
}

/** Structured content parts, skipping the plain-string form custom messages use. */
const turnParts = (message: AgentTurnLike): { type: string; text?: string }[] =>
  Array.isArray(message.content) ? message.content : []

/** A finished assistant turn with article text should settle instead of starting another writing phase. */
export function assistantDeliveredArticle(message: AgentTurnLike): boolean {
  const parts = turnParts(message)
  return (
    message.role === 'assistant' &&
    message.stopReason === 'stop' &&
    Boolean(
      parts.some((part) => part.type === 'text' && part.text?.trim()) &&
        !parts.some((part) => part.type === 'toolCall')
    )
  )
}

/** True when the model spent the output budget before delivering an answer. */
export function assistantTurnTruncated(message: AgentTurnLike): boolean {
  return message.role === 'assistant' && message.stopReason === 'length'
}

/** True when the stream died or was cut off before a finished answer. */
export function assistantTurnIncomplete(message: AgentTurnLike): boolean {
  if (assistantDeliveredArticle(message) || message.role !== 'assistant') {
    return false
  }
  if (message.stopReason === 'length' || message.stopReason === 'pending') {
    return true
  }
  return (
    (message.stopReason === 'error' || message.stopReason === 'aborted') &&
    /terminated|connection stopped|before the response finished|output limit/i.test(
      message.errorMessage ?? ''
    )
  )
}

/** Latest unfinished assistant turn, including a half-written reply before a retry. */
export function lastIncompleteAssistant<T extends AgentTurnLike>(messages: T[]): T | undefined {
  return messages.findLast((item) => assistantTurnIncomplete(item))
}

/**
 * After a truncated one-shot, keep writing instead of settling as a failed skill.
 *
 * Skill runs with the full source already in context hand off to section writers.
 * Chat follow-ups ask the model to deliver the answer on a second turn.
 */
export function truncatedAgentRecovery(input: {
  last?: AgentTurnLike
  allowSectionedWrite: boolean
}): 'sectioned' | 'continue' | null {
  const last = input.last ?? {}
  if (assistantDeliveredArticle(last) || !assistantTurnIncomplete(last)) {
    return null
  }
  return input.allowSectionedWrite ? 'sectioned' : 'continue'
}

/** Prefer the provider stop over the generic incomplete-run fallback. */
export function agentIncompleteRunError(last?: AgentTurnLike): string | undefined {
  if (last?.role === 'assistant' && last.stopReason === 'length') {
    return 'The AI response reached its output limit before completion.'
  }
  return last?.role === 'assistant' ? last.errorMessage : undefined
}

/** Ask a truncated turn to spend the next completion on the answer, not more reasoning. */
export const AGENT_TRUNCATED_CONTINUATION =
  'Your previous response was cut off before the answer. Deliver the complete answer now from the supplied source. If one reply cannot hold it, call write_article. Do not spend this turn only on reasoning.'

/** Stop repeated identical tool work, while allowing long tasks that keep making progress. */
export class AgentProgressGuard {
  private readonly seen = new Set<string>()
  private cursor = 0
  private stalled = 0

  /** Scope duplicate detection to work performed by this run, allowing source reuse in follow-ups. */
  constructor(historyLength = 0) {
    this.cursor = historyLength
  }

  /** Measure source novelty independently of response cursors and cumulative metadata. */
  observe(messages: AgentMessage[]): boolean {
    const recent = messages.slice(this.cursor)
    this.cursor = messages.length
    let progressed = false
    let called = false
    for (const message of recent) {
      if (message.role !== 'toolResult') {
        continue
      }
      called = true
      const details = message.details as { newCharacters?: number } | undefined
      if (typeof details?.newCharacters === 'number') {
        progressed ||= details.newCharacters > 0
        continue
      }
      const semantic = message.content.map((part) => {
        if (part.type !== 'text') {
          return part
        }
        try {
          return JSON.parse(part.text)
        } catch {
          return part.text
        }
      })
      const signature = createHash('sha256')
        .update(
          JSON.stringify({ name: message.toolName, content: semantic }, (key, value) =>
            [
              'nextOffset',
              'nextTextOffset',
              'total',
              'coverage',
              'requestedRange',
              'messageId'
            ].includes(key)
              ? undefined
              : value
          )
        )
        .digest('hex')
      if (!this.seen.has(signature)) {
        this.seen.add(signature)
        progressed = true
      }
    }
    if (!called) {
      return false
    }
    this.stalled = progressed ? 0 : this.stalled + 1
    return this.stalled >= 6
  }
}
