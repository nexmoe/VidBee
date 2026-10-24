import type { AgentActivity } from '@vidbee/ui/lib/agent-activity'

export type { AgentActivity } from '@vidbee/ui/lib/agent-activity'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AgentErrorCode } from './agent-errors'

export const AGENT_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number]

/** Effort levels a custom provider can advertise. Off is controlled separately. */
export const PROVIDER_THINKING_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ProviderThinkingEffortLevel = (typeof PROVIDER_THINKING_EFFORT_LEVELS)[number]
export type ProviderDefaultThinkingLevel = 'auto' | AgentThinkingLevel

export interface AgentThinkingOptions {
  levels: AgentThinkingLevel[]
  defaultLevel: AgentThinkingLevel
  vision: boolean
}

// Leave room for the text part in Cloud's multimodal message envelope.
export const AGENT_MAX_MESSAGE_IMAGES = 10

/** A user-selected image copied into its conversation's local media directory. */
export interface AgentImageAttachment {
  id: string
  threadId: string
  name: string
  path: string
  mimeType: 'image/png' | 'image/jpeg'
  createdAt: number
  width: number
  height: number
}

/** Durable product types shared by the renderer and desktop runtime. */
export type AgentRunStatus = 'running' | 'completed' | 'aborted' | 'error' | 'interrupted'
export type AgentToolCallStatus = 'running' | 'completed' | 'error' | 'pending-approval' | 'denied'
export type AgentApprovalAction =
  | 'task.create'
  | 'task.cancel'
  | 'task.remove'
  | 'task.rename'
  | 'task.rename_file'
  | 'subscription.add'
  | 'subscription.update'
  | 'subscription.remove'
  | 'settings.proxy'
  | 'settings.config_path'
  | 'settings.download_path'
  | 'settings.update'
  | 'ai.delete_provider'
  | 'ai.delete_prompt'
  | 'asr.delete'
  | 'ytdlp.update'
export interface AgentApprovalRequest {
  action: AgentApprovalAction
  summary: string
  risk: 'destructive' | 'config' | 'network'
}
export interface AgentArtifact {
  id: string
  threadId: string
  runId: string
  kind: 'image' | 'video'
  name: string
  path: string
  posterPath?: string
  start: number
  end?: number
  width?: number
  height?: number
}
export interface AgentChatMessage {
  id: string
  parentId: string | null
  runId: string | null
  role: 'user' | 'assistant'
  text: string
  imageIds?: string[]
  thinking: string
  thinkingMs?: number
  createdAt: number
  legacy?: boolean
}

export interface AgentContextCheckpoint {
  coveredCount: number
  digest: string
  text: string
}
export interface AgentChatRun {
  id: string
  messageId: string
  status: AgentRunStatus
  error: string | null
  errorCode?: AgentErrorCode
  model: string
  instruction: string
  createdAt: number
  updatedAt: number
  /** In-memory only for the duration of a run; the store strips this on write. */
  rawMessages: AgentMessage[]
  sessionEntries?: unknown[]
  evidenceCoverage?: Record<string, [number, number][]>
  evidenceSource?: string
  fullSourceReview?: boolean
  /** Lines of source the application supplied before the first turn, shown as a read in the activity. */
  preloadedSourceLines?: number
  articleSections?: unknown[]
  articleReview?: {
    status?: 'passed' | 'issues' | 'unavailable'
    checkedSections: number
    issues: number
    passed: boolean
  }
  activity?: AgentActivity[]
  lifecycle?: {
    id: string
    messageCount: number
    status: 'retrying' | 'compacting' | 'recovering'
  }[]
  tools: {
    id: string
    name: string
    status: AgentToolCallStatus
    detail?: string
    approval?: AgentApprovalRequest
  }[]
  usage?: {
    input: number
    output: number
    totalTokens: number
    cacheRead?: number
    cacheWrite?: number
    reasoning?: number
  }
  sourceOffset?: number
  contextSummary?: { digest: string; text: string }
  contextCheckpoint?: AgentContextCheckpoint
  workingNotes?: string
  contextStatus?: 'compacting' | 'recovering' | 'reviewing' | 'writing'
  cloudResultId?: string
}
export interface AgentThread {
  id: string
  downloadId: string
  promptId: string
  leafId: string | null
  seq: number
  /** User or Agent-chosen tab title; empty means derive from messages. */
  title?: string
  /** Effort selected for the next message; synchronized between conversation clients. */
  thinkingLevel?: AgentThinkingLevel
  messages: AgentChatMessage[]
  runs: AgentChatRun[]
  artifacts: AgentArtifact[]
  images?: AgentImageAttachment[]
  /** ApprovalAction names the user asked this thread to remember. */
  toolGrants?: string[]
}
/** Compact conversation row for the transcript history drawer. */
export interface AgentThreadSummary {
  id: string
  downloadId: string
  promptId: string
  title: string
  updatedAt: number
  running: boolean
  /** Latest run: the live one, otherwise the most recently updated. `idle` when none ran. */
  status?: AgentRunStatus | 'idle'
  /** Model id of that run; empty until the run resolves its model. `vidbee-cloud` for Cloud. */
  model?: string
}
/**
 * Entities changed by one streaming commit.
 * `downloadId` and `promptId` route the patch before the renderer has a thread.
 */
export interface AgentThreadPatch {
  downloadId: string
  promptId: string
  threadId: string
  leafId?: string | null
  title?: string
  toolGrants?: string[]
  images?: AgentImageAttachment[]
  messages?: AgentChatMessage[]
  runs?: AgentChatRun[]
  artifacts?: AgentArtifact[]
}
/**
 * Directory change that is ordered by `revision`, not by the thread seq.
 * Upserts that do not write a new seq still carry a newer revision.
 */
export type AgentCatalogNotice =
  | {
      kind: 'upsert'
      summary: AgentThreadSummary
      history: boolean
      runStatus: AgentRunStatus | 'idle'
      statusUpdatedAt: number
      revision: number
    }
  | {
      kind: 'remove'
      id: string
      downloadId: string
      revision: number
    }
export interface AgentRunEvent {
  threadId: string
  runId: string | null
  messageId: string | null
  seq: number
  type: string
  createdAt: number
  /** Full public thread for the first load, admission, terminal, and gap repair. */
  snapshot?: AgentThread
  /** Hot-path entity update. Mutually exclusive with `snapshot`. */
  patch?: AgentThreadPatch
  /** Title, membership, or selected-run status. Independent of snapshot seq. */
  catalog?: AgentCatalogNotice
}
export interface AgentChatInput {
  thinkingLevel?: AgentThinkingLevel
  downloadId: string
  promptId: string
  /** When set, send to this conversation instead of the prompt's get-or-create thread. */
  threadId?: string
  /** Optional; omitted when Desktop already has a stored transcript record. */
  transcriptText?: string
  text?: string
  imageIds?: string[]
  retryMessageId?: string
  uiLanguage?: string
  sourceTitle?: string
  sourceDurationMs?: number
}

/** Keep selected images in the draft until a user message durably references them. */
export function draftAgentImages(thread: AgentThread): AgentImageAttachment[] {
  const sent = new Set(thread.messages.flatMap((message) => message.imageIds ?? []))
  return (thread.images ?? []).filter((image) => !sent.has(image.id))
}
/**
 * Wall-clock duration of an agent reply.
 *
 * Tool calls, compaction and other events all count; the clock only stops when
 * the run settles with a final result.
 */
export function agentThinkingElapsedMs(startedAt: number, now: number): number {
  return Math.max(0, now - startedAt)
}

/** Walk only the selected branch, rejecting corrupt cycles. */
export function selectedAgentMessages(thread: AgentThread): AgentChatMessage[] {
  const map = new Map(thread.messages.map((message) => [message.id, message]))
  const messages: AgentChatMessage[] = []
  const seen = new Set<string>()
  let id = thread.leafId
  while (id && !seen.has(id)) {
    seen.add(id)
    const message = map.get(id)
    if (!message) {
      break
    }
    messages.unshift(message)
    id = message.parentId
  }
  return messages
}
