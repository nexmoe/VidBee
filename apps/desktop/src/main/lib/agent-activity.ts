import type { AgentActivity, AgentChatRun } from '../../shared/agent-chat'
import { agentMessageRecord as record } from './agent-output'

/** Project reasoning and tool calls in provider order, omitting arguments and private results. */
export function agentActivity(run: AgentChatRun): AgentActivity[] {
  const activity: AgentActivity[] = []
  const lifecycle = [...(run.lifecycle ?? [])]
  const results = new Map(
    run.rawMessages
      .map(record)
      .filter((message) => message.role === 'toolResult')
      .map((message) => [message.toolCallId, record(message.details)])
  )
  const seen = new Set<string>()
  for (const [messageIndex, raw] of run.rawMessages.entries()) {
    while (lifecycle.length && lifecycle[0].messageCount <= messageIndex) {
      const event = lifecycle.shift()
      if (event) {
        activity.push({ id: event.id, kind: 'status', status: event.status })
      }
    }
    const message = record(raw)
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
