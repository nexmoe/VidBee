import type { AgentActivity, AgentChatRun } from '../../shared/agent-chat'
import { agentMessageRecord as record } from './agent-output'

/** Restore this run's display archive without including inherited conversation turns. */
function activityMessages(run: AgentChatRun): Record<string, unknown>[] {
  if (run.rawMessages.length) {
    return run.rawMessages.map(record)
  }
  const entries = (run.sessionEntries ?? []).map(record)
  // Entry timestamps change when a branch is restored; message timestamps retain their origin.
  let start = entries.findIndex((entry) => {
    const message = record(entry.message)
    return (
      entry.type === 'message' &&
      typeof message.timestamp === 'number' &&
      message.timestamp >= run.createdAt
    )
  })
  if (start < 0) {
    return []
  }
  // Leading app-state/source messages also occupy positions in the live lifecycle timeline.
  while (start > 0 && entries[start - 1].type === 'custom_message') {
    start -= 1
  }
  return entries.slice(start).flatMap((entry) => {
    if (entry.type === 'message') {
      return [record(entry.message)]
    }
    return entry.type === 'custom_message' ? [{ role: 'custom' }] : []
  })
}

/** Project reasoning and tool calls in provider order, omitting arguments and private results. */
export function agentActivity(run: AgentChatRun): AgentActivity[] {
  const activity: AgentActivity[] = []
  const messages = activityMessages(run)
  const lifecycle = [...(run.lifecycle ?? [])]
  const results = new Map(
    messages
      .filter((message) => message.role === 'toolResult')
      .map((message) => [message.toolCallId, record(message.details)])
  )
  const seen = new Set<string>()
  if (run.preloadedSourceLines) {
    activity.push({
      id: 'source:preloaded',
      kind: 'tool',
      toolId: 'source:preloaded',
      name: 'read_transcript',
      count: run.preloadedSourceLines,
      artifactIds: []
    })
  }
  for (const [messageIndex, message] of messages.entries()) {
    while (lifecycle.length && lifecycle[0].messageCount <= messageIndex) {
      const event = lifecycle.shift()
      if (event) {
        activity.push({ id: event.id, kind: 'status', status: event.status })
      }
    }
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue
    }
    const toolTurn =
      message.stopReason === 'toolUse' ||
      message.content.some((block) => record(block).type === 'toolCall')
    for (const [blockIndex, rawBlock] of message.content.entries()) {
      const block = record(rawBlock)
      if (
        block.type === 'thinking' &&
        typeof block.thinking === 'string' &&
        block.thinking.trim()
      ) {
        activity.push({
          id: `${messageIndex}:${blockIndex}`,
          kind: 'thinking',
          text: block.thinking
        })
      } else if (
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.trim() &&
        toolTurn
      ) {
        activity.push({ id: `${messageIndex}:${blockIndex}`, kind: 'commentary', text: block.text })
      } else if (
        block.type === 'toolCall' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        if (seen.has(block.id)) {
          continue
        }
        seen.add(block.id)
        const details = results.get(block.id) ?? {}
        const artifacts = Array.isArray(details.artifacts)
          ? details.artifacts
          : details.artifact
            ? [details.artifact]
            : []
        const count = Array.isArray(details.lines)
          ? details.lines.length
          : Array.isArray(details.matches)
            ? details.matches.length
            : artifacts.length || undefined
        activity.push({
          id: block.id,
          kind: 'tool',
          toolId: block.id,
          name: block.name,
          count,
          artifactIds: artifacts
            .map(record)
            .flatMap((artifact) => (typeof artifact.id === 'string' ? [artifact.id] : []))
        })
      }
    }
  }
  for (const event of lifecycle) {
    activity.push({ id: event.id, kind: 'status', status: event.status })
  }
  for (const [sectionIndex, rawSection] of (run.articleSections ?? []).entries()) {
    const attempts = record(rawSection).attempts
    if (!Array.isArray(attempts)) {
      continue
    }
    for (const [attemptIndex, rawAttempt] of attempts.entries()) {
      const attempt = record(rawAttempt)
      const messages = Array.isArray(attempt.messages) ? [...attempt.messages] : []
      if (attempt.liveMessage) {
        messages.push(attempt.liveMessage)
      }
      for (const [messageIndex, rawMessage] of messages.entries()) {
        const message = record(rawMessage)
        if (message.role !== 'assistant' || !Array.isArray(message.content)) {
          continue
        }
        for (const [blockIndex, rawBlock] of message.content.entries()) {
          const block = record(rawBlock)
          if (
            block.type === 'thinking' &&
            typeof block.thinking === 'string' &&
            block.thinking.trim()
          ) {
            activity.push({
              id: `article:${sectionIndex}:${attemptIndex}:${messageIndex}:${blockIndex}`,
              kind: 'thinking',
              text: block.thinking
            })
          }
        }
      }
    }
  }
  for (const tool of run.tools) {
    if (!seen.has(tool.id)) {
      activity.push({
        id: tool.id,
        kind: 'tool',
        toolId: tool.id,
        name: tool.name,
        artifactIds: []
      })
    }
  }
  return activity
}
