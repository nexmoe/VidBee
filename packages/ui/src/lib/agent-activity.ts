export type AgentActivity =
  | { id: string; kind: 'thinking' | 'commentary'; text: string }
  | { id: string; kind: 'status'; status: 'retrying' | 'compacting' | 'recovering' }
  | {
      id: string
      kind: 'tool'
      toolId: string
      name: string
      count?: number
      artifactIds: string[]
    }

/** Minimal public message fields needed by the shared reasoning rail. */
export interface AgentThinkingMessage {
  thinking: string
  thinkingMs?: number
  createdAt: number
  legacy?: boolean
}
/** Public run state needed by the shared reasoning rail. */
export interface AgentThinkingRun {
  status: string
  createdAt: number
  activity?: AgentActivity[]
  contextStatus?: string
  tools: {
    id: string
    name: string
    status: string
    detail?: string
    approval?: { summary: string }
  }[]
}
/** Media references never carry local filesystem paths into shared UI. */
export interface AgentThinkingArtifact {
  id: string
  threadId: string
  kind: 'image' | 'video'
  start: number
  end?: number
}
