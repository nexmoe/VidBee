import {
  AgentChat,
  type AgentChatProps,
  resetArmedPromptIdentities as resetAgentArmedPrompts
} from '@renderer/components/agent/AgentChat'

/** Embed the shared Agent chat in a video's prompt tab. */
export function TranscriptPromptPane(props: AgentChatProps) {
  return <AgentChat {...props} />
}

/** Reset the shared waiting state for callers of the original prompt pane. */
export function resetArmedPromptIdentities(): void {
  resetAgentArmedPrompts()
}
