import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import type { Static, TSchema } from 'typebox'

declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    vidbeeCustom: {
      role: 'custom'
      customType: string
      content: import('@earendil-works/pi-ai').UserMessage['content']
      display: boolean
      details?: unknown
      timestamp: number
    }
  }
}

/** Persisted application projection, also accepted when importing older chat histories. */
export type SessionEntry = {
  id: string
  parentId: string | null
  timestamp: string
} & (
  | { type: 'message'; message: AgentMessage }
  | {
      type: 'compaction'
      summary: string
      firstKeptEntryId: string
      tokensBefore: number
      details?: unknown
      fromHook?: boolean
      usage?: AssistantMessage['usage']
    }
  | {
      type: 'custom_message'
      customType: string
      content: string | import('@earendil-works/pi-ai').UserMessage['content']
      display: boolean
      details?: unknown
    }
  | { type: 'custom'; customType: string; data?: unknown }
)

export interface Skill {
  name: string
  description: string
  filePath: string
  baseDir: string
  disableModelInvocation?: boolean
}

/** Application tools may use Durable's native file and shell implementations directly. */
export type AgentRuntimeTool = AgentTool & { durableTool?: ToolRegistration }

export interface ExtensionUIContext {
  select: (
    title: string,
    choices: string[],
    dialog?: { signal?: AbortSignal }
  ) => Promise<string | undefined>
  setStatus: (key: string, value: string | undefined) => void
  notify: (message: string, level?: string) => void
}

export interface ExtensionContext {
  cwd: string
  signal: AbortSignal
  hasUI: boolean
  mode: 'rpc'
  model: Model<Api>
  sessionManager: {
    getBranch: () => SessionEntry[]
    getEntries: () => SessionEntry[]
    getSessionId: () => string
    getSessionDir: () => string
    getSessionFile: () => undefined
    getSessionName: () => undefined
    getLeafId: () => string | null
    getCwd: () => string
  }
  modelRegistry: {
    getProvider: (provider: string) => unknown
    find: (provider: string, id: string) => Model<Api> | undefined
    getAll: () => Model<Api>[]
    streamSimple: typeof import('@earendil-works/pi-ai/compat').streamSimple
  }
  ui: ExtensionUIContext
  isProjectTrusted: () => boolean
  isIdle: () => boolean
  abort: () => Promise<void>
}

export interface ExtensionToolContext extends ExtensionContext {
  tools: AgentRuntimeTool[]
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    options?: {
      signal?: AbortSignal
      onUpdate?: import('@earendil-works/pi-agent-core').AgentToolUpdateCallback
    }
  ) => Promise<{
    result: import('@earendil-works/pi-agent-core').AgentToolResult<unknown>
    isError: boolean
  }>
}

export interface ExtensionEvents {
  session_start: { type: 'session_start' }
  session_shutdown: { type: 'session_shutdown'; reason: string }
  before_agent_start: { type: 'before_agent_start'; systemPrompt: string; prompt: string }
  input: { type: 'input'; text: string; source: 'rpc' }
  turn_start: { type: 'turn_start' }
  tool_call: {
    type: 'tool_call'
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
  }
  tool_result: {
    type: 'tool_result'
    toolCallId: string
    toolName: string
    input: Record<string, unknown>
    content: import('@earendil-works/pi-ai').ToolResultMessage['content']
    details: unknown
    isError: boolean
  }
}
export type SessionStartEvent = ExtensionEvents['session_start']
export type ExtensionHandler<E = unknown> = (
  event: E,
  context: ExtensionContext
) => unknown | Promise<unknown>

export interface ToolDefinition<T extends TSchema = TSchema> extends Omit<AgentTool<T>, 'execute'> {
  exposure?: 'direct' | 'deferred'
  execute: (
    id: string,
    params: Static<T>,
    signal: AbortSignal | undefined,
    onUpdate: import('@earendil-works/pi-agent-core').AgentToolUpdateCallback | undefined,
    context: ExtensionToolContext
  ) => Promise<import('@earendil-works/pi-agent-core').AgentToolResult<unknown>>
}

/** Only the plugin host surface is adapted; scheduling and execution belong to Durable. */
export interface ExtensionAPI {
  appendEntry: (customType: string, data: unknown) => void
  on: <K extends keyof ExtensionEvents>(
    event: K,
    handler: ExtensionHandler<ExtensionEvents[K]>
  ) => () => void
  events: {
    on: (name: string, handler: (value: unknown) => void) => () => void
    emit: (name: string, value: unknown) => void
  }
  registerTool: <T extends TSchema>(tool: ToolDefinition<T>) => void
  registerCommand: (...args: unknown[]) => void
  registerShortcut: (...args: unknown[]) => void
  getAllTools: () => AgentRuntimeTool[]
  getActiveTools: () => string[]
  setActiveTools: (names: string[]) => void
}
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>

/** Stable application events projected from Durable's committed entries and live state. */
export type AgentSessionEvent =
  | { type: 'message_end' | 'message_update'; message: AgentMessage }
  | { type: 'entry_appended' }
  | { type: 'compaction_start'; reason: string }
  | {
      type: 'compaction_end'
      reason: string
      errorMessage?: string
      result?: { usage?: AssistantMessage['usage'] }
    }
  | {
      type:
        | 'auto_retry_start'
        | 'auto_retry_end'
        | 'turn_start'
        | 'turn_end'
        | 'agent_start'
        | 'agent_end'
    }
  | {
      type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end'
      toolCallId: string
      toolName: string
      args?: unknown
      parentToolCallId?: string
      isError?: boolean
    }
