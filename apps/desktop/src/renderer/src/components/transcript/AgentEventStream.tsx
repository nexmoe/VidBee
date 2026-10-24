import type { AgentArtifact, AgentChatMessage, AgentChatRun } from '@shared/agent-chat'
import {
  AgentEventStream as EventStream,
  eventRows
} from '@vidbee/ui/components/agent-event-stream'
import { useTranslation } from 'react-i18next'

export { eventRows }

/** Bind the common reasoning and tool rail to Desktop's locale. */
export function AgentEventStream(props: {
  message: AgentChatMessage
  run?: AgentChatRun
  artifacts: AgentArtifact[]
  onSeek?: (seconds: number) => void
  onDecideTool?: (input: { toolCallId: string; approved: boolean; remember: boolean }) => void
}) {
  const { t } = useTranslation()
  return <EventStream {...props} translate={t} />
}
