import type {
  AgentRunEvent,
  AgentRunStatus,
  AgentThinkingLevel,
  AgentThinkingOptions,
  AgentThread,
  AgentThreadSummary
} from './agent-chat'
import type { AiPrompt } from './ai-types'

/** Browser evidence imported once into Desktop's persistent transcript library. */
export interface ExtensionChatSource {
  sourceUrl: string
  title: string
  duration: number
  language?: string
  auto: boolean
  segments: { start: number; end: number; text: string }[]
}

/** Short-lived, origin-bound access to Desktop conversations, never provider credentials. */
export interface ExtensionChatSession {
  id: string
  token: string
}

/** One authoritative directory for the skills and conversations shown by both clients. */
export interface ExtensionChatCatalog {
  downloadId: string
  prompts: AiPrompt[]
  threads: AgentThreadSummary[]
  history: AgentThreadSummary[]
  sources: Record<string, ExtensionChatVideo>
  statuses: Record<string, { status: AgentRunStatus | 'idle'; updatedAt: number }>
}

/** Mutations have caller-generated identities so retrying a lost reply cannot send twice. */
export type ExtensionChatCommand =
  | { type: 'open'; promptId: string; threadId?: string; followSource?: boolean }
  | { type: 'create'; requestId: string }
  | {
      type: 'send'
      requestId: string
      threadId: string
      text?: string
      retryMessageId?: string
      thinkingLevel?: AgentThinkingLevel
      imageIds?: string[]
    }
  | { type: 'thinking'; threadId: string; level: AgentThinkingLevel }
  | { type: 'remove-image'; threadId: string; imageId: string }
  | { type: 'stop'; threadId: string }
  | { type: 'branch'; threadId: string; messageId: string }
  | { type: 'rename'; threadId: string; title: string }
  | { type: 'delete'; threadId: string }
  | { type: 'approve'; threadId: string; toolCallId: string; approved: boolean; remember: boolean }

/** Every response refreshes the directory together with the selected conversation. */
export interface ExtensionChatState {
  revision: number
  catalog: ExtensionChatCatalog
  thread: AgentThread | null
}

/** Public source context for history navigation; never includes local media paths. */
export interface ExtensionChatVideo {
  downloadId: string
  url: string
  title: string
  duration: number
}

/** Credential-free Composer options shared by native and browser clients. */
export interface AgentComposerOptions {
  models: {
    value: string
    label: string
    description?: string
    presetId?: string
    modelId?: string
  }[]
  selected: string
  thinking: AgentThinkingOptions
}

/** Replay starts with a snapshot, then uses Desktop's ordered entity patches. */
export type ExtensionChatEvent =
  | { type: 'snapshot'; state: ExtensionChatState }
  | { type: 'agent'; event: AgentRunEvent; source?: ExtensionChatVideo }
  | { type: 'settings' }

/** Only persisted assistant replies can be exported or receive feedback. */
export interface ExtensionChatExport {
  threadId: string
  messageId: string
  format: 'md' | 'pdf' | 'png'
  split?: boolean
  imageCount?: number
}

/** Export bytes are delivered to the browser without opening Desktop dialogs. */
export interface ExtensionChatFile {
  name: string
  dataUrl: string
}
