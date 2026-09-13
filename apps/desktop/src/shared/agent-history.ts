import type { AgentThread, AgentThreadSummary } from './agent-chat'
import { AI_CHAT_PROMPT_ID } from './ai-prompts'

const DAY_MS = 86_400_000
const TITLE_MAX = 80

/**
 * Collapse whitespace and cap length for a conversation tab title.
 *
 * @param value Raw title from the Agent or the user.
 */
export function sanitizeAgentConversationTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX)
}

export type AgentHistoryGroupKind = 'today' | 'yesterday' | 'weekday' | 'date'

export interface AgentHistoryGroup<T> {
  key: string
  kind: AgentHistoryGroupKind
  /** Intl weekday or date label when `kind` is weekday or date. */
  label?: string
  items: T[]
}

/**
 * Local midnight for a timestamp so history groups follow the user's calendar day.
 *
 * @param ms Epoch milliseconds.
 */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * One-line preview of the first user message on a conversation.
 *
 * @param thread Persisted agent thread.
 */
export function agentThreadUserPreview(thread: AgentThread): string {
  for (const message of thread.messages) {
    if (message.role !== 'user') {
      continue
    }
    const line = message.text.trim().split('\n')[0]?.trim() ?? ''
    if (line) {
      return line.slice(0, 80)
    }
  }
  return thread.images?.[0]?.name.slice(0, 80) ?? ''
}

/**
 * History title: freeform chats prefer the first user message, prompt chats prefer the video title.
 *
 * @param thread Persisted agent thread.
 * @param videoTitle Title of the source video, if known.
 */
export function agentConversationTitle(thread: AgentThread, videoTitle: string): string {
  const named = sanitizeAgentConversationTitle(thread.title ?? '')
  if (named) {
    return named
  }
  const userTitle = agentThreadUserPreview(thread)
  const video = videoTitle.trim()
  if (thread.promptId === AI_CHAT_PROMPT_ID) {
    return userTitle
  }
  return video || userTitle
}

/**
 * True when the conversation still has a live model run.
 *
 * @param thread Persisted agent thread.
 */
export function agentThreadIsRunning(thread: AgentThread): boolean {
  return thread.runs.some((run) => run.status === 'running')
}

/**
 * Latest product timestamp on a thread, ignoring empty conversations.
 *
 * @param thread Persisted agent thread.
 */
export function agentThreadUpdatedAt(thread: AgentThread): number {
  let latest = 0
  for (const message of thread.messages) {
    if (message.createdAt > latest) {
      latest = message.createdAt
    }
  }
  for (const run of thread.runs) {
    if (run.updatedAt > latest) {
      latest = run.updatedAt
    }
  }
  for (const image of thread.images ?? []) {
    if (image.createdAt > latest) {
      latest = image.createdAt
    }
  }
  return latest
}

/**
 * Group conversations into today, yesterday, this-week weekdays, then dates.
 *
 * @param items History rows, newest first preferred but not required.
 * @param now Epoch milliseconds used as "today".
 * @param locale BCP 47 tag for weekday and date labels.
 */
export function groupAgentHistory<T extends { id: string; updatedAt: number }>(
  items: T[],
  now: number,
  locale: string
): AgentHistoryGroup<T>[] {
  const byUpdated = (left: T, right: T): number => right.updatedAt - left.updatedAt
  const rest = [...items].sort(byUpdated)
  const today = startOfLocalDay(now)
  const groups = new Map<string, AgentHistoryGroup<T>>()
  const order: string[] = []

  const ensure = (key: string, group: AgentHistoryGroup<T>): AgentHistoryGroup<T> => {
    const existing = groups.get(key)
    if (existing) {
      return existing
    }
    groups.set(key, group)
    order.push(key)
    return group
  }

  for (const item of rest) {
    const start = startOfLocalDay(item.updatedAt)
    const diff = Math.round((today - start) / DAY_MS)
    let key: string
    let kind: AgentHistoryGroupKind
    let label: string | undefined
    if (diff <= 0) {
      key = 'today'
      kind = 'today'
    } else if (diff === 1) {
      key = 'yesterday'
      kind = 'yesterday'
    } else if (diff < 7) {
      key = `weekday:${start}`
      kind = 'weekday'
      label = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(item.updatedAt))
    } else {
      key = `date:${start}`
      kind = 'date'
      label = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
        new Date(item.updatedAt)
      )
    }
    ensure(key, { key, kind, label, items: [] }).items.push(item)
  }

  return order
    .map((key) => groups.get(key))
    .filter((group): group is AgentHistoryGroup<T> => Boolean(group))
}

/**
 * Visible title for a history row. Blank chats use the first user message; prompt threads keep the prompt name.
 *
 * @param item Row being rendered.
 * @param untitled Fallback when the video has no title.
 * @param promptLabel Translated prompt or Chat label.
 */
export function agentHistoryDisplayTitle(
  item: AgentThreadSummary,
  untitled: string,
  promptLabel: string
): string {
  const title = item.title.trim()
  if (item.promptId === AI_CHAT_PROMPT_ID) {
    return title || promptLabel || untitled
  }
  const video = title || untitled
  return promptLabel ? `${promptLabel} · ${video}` : video
}
