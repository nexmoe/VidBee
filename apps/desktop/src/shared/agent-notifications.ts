export const AGENT_NOTIFICATION_OPEN_CHANNEL = 'ai:open-notification-thread'

export interface AgentNotificationTarget {
  threadId: string
  downloadId: string
  promptId: string
}
