import type { AgentRunEvent } from '../../shared/agent-chat'

const listeners = new Set<(event: AgentRunEvent) => void>()

/** Subscribe transports to the same committed events delivered to Desktop IPC. */
export function subscribeAgentEvents(listener: (event: AgentRunEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Publish only public committed payloads, isolating disconnected transports. */
export function publishAgentEvent(event: AgentRunEvent): void {
  for (const listener of listeners) {
    listener(event)
  }
}
