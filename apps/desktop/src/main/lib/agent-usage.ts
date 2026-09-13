import type { Usage } from '@earendil-works/pi-ai'
import type { AgentChatRun } from '../../shared/agent-chat'

/** Count cached prompt tokens as input while retaining their separate provider counters. */
export function addAgentUsage(
  previous: AgentChatRun['usage'],
  usage: Usage
): NonNullable<AgentChatRun['usage']> {
  return {
    input: (previous?.input ?? 0) + usage.input + usage.cacheRead + usage.cacheWrite,
    output: (previous?.output ?? 0) + usage.output,
    totalTokens: (previous?.totalTokens ?? 0) + usage.totalTokens,
    cacheRead: (previous?.cacheRead ?? 0) + usage.cacheRead,
    cacheWrite: (previous?.cacheWrite ?? 0) + usage.cacheWrite,
    reasoning: (previous?.reasoning ?? 0) + (usage.reasoning ?? 0)
  }
}
