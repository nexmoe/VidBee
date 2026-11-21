import type { AgentThreadSummary } from '../../shared/agent-chat'
import { getAgentChatStore } from './agent-chat-store'
import { agentDirectorySummary } from './agent-run-event'

/** List persistent conversation headers identically for IPC and browser clients. */
export function listAgentConversations(downloadId?: string): AgentThreadSummary[] {
  const store = getAgentChatStore()
  const threads = downloadId ? store.listVideoThreads(downloadId) : store.listHistory()
  return threads.map(agentDirectorySummary).sort((left, right) => right.updatedAt - left.updatedAt)
}
