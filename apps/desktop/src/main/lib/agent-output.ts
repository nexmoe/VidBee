/** Narrow archived model output without publishing provider payloads. */
export function agentMessageRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Only the final successful assistant turn can supply the answer. */
export function finalAgentMessageIndex(messages: unknown[]): number {
  const index = messages.findLastIndex(
    (message) => agentMessageRecord(message).role === 'assistant'
  )
  const message = agentMessageRecord(messages[index])
  return message.stopReason === 'stop' &&
    Array.isArray(message.content) &&
    !message.content.some((part) => agentMessageRecord(part).type === 'toolCall')
    ? index
    : -1
}

/** Read one assistant text block without reasoning or tool arguments. */
function assistantText(value: unknown): string {
  const message = agentMessageRecord(value)
  return Array.isArray(message.content)
    ? message.content
        .map(agentMessageRecord)
        .flatMap((part) =>
          part.type === 'text' && typeof part.text === 'string' ? [part.text] : []
        )
        .join('')
    : ''
}

/** Stream the latest answer, retaining interrupted text while the next attempt is thinking. */
export function agentAnswer(messages: unknown[]): string {
  const message = messages.findLast((raw) => {
    const item = agentMessageRecord(raw)
    return (
      item.role === 'assistant' &&
      item.stopReason !== 'toolUse' &&
      Array.isArray(item.content) &&
      !item.content.some((part) => agentMessageRecord(part).type === 'toolCall') &&
      Boolean(assistantText(item).trim())
    )
  })
  return assistantText(message)
}

/** Read the final answer without concatenating commentary, failed drafts, or earlier turns. */
export function finalAgentAnswer(messages: unknown[]): string {
  return assistantText(messages[finalAgentMessageIndex(messages)])
}
