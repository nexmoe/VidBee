export const AGENT_PERMISSION_MODES = ['ask', 'auto', 'full'] as const

export type AgentPermissionMode = (typeof AGENT_PERMISSION_MODES)[number]

export const DEFAULT_AGENT_PERMISSION_MODE: AgentPermissionMode = 'auto'

/** Default missing settings to review while keeping legacy and invalid values manual. */
export function parseAgentPermissionMode(value: unknown): AgentPermissionMode {
  if (value === undefined) {
    return DEFAULT_AGENT_PERMISSION_MODE
  }
  return value === 'auto' || value === 'full' ? value : 'ask'
}
