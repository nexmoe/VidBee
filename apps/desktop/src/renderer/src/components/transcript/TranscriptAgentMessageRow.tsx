import { MessageScrollerItem } from '@renderer/components/ui/message-scroller'
import type {
  AgentChatMessage,
  AgentChatRun,
  AgentImageAttachment,
  AgentThread
} from '@shared/agent-chat'
import { memo, useCallback, useRef } from 'react'
import { AgentChatMessageView } from './AgentChatMessageView'

/** Tool decision forwarded from the active conversation. */
interface ToolDecision {
  toolCallId: string
  approved: boolean
  remember: boolean
}

/** Shared ancestor node. Children point at the parent node instead of copying a chain string. */
export interface AgentAncestorIdentity {
  readonly id: string
  readonly runId: string | null
  readonly status: string
  readonly parent?: AgentAncestorIdentity
}

/** Inputs one row needs besides its own message. Reused across thread versions when unchanged. */
export interface AgentMessageDeps {
  readonly run?: AgentChatRun
  readonly versions: string
  readonly artifacts: AgentThread['artifacts']
  readonly images: readonly (AgentImageAttachment | undefined)[]
  readonly ancestor?: AgentAncestorIdentity
  readonly self: AgentAncestorIdentity
}

interface AgentMessageRowProps {
  message: AgentChatMessage
  thread: AgentThread
  deps: AgentMessageDeps
  busy: boolean
  overview: boolean
  currentTimeMs: number
  durationMs: number
  sourceTitle?: string | null
  sourceUrl?: string | null
  onSeek?: (seconds: number) => void
  onRetry: (id: string) => void
  onDecideTool?: (input: ToolDecision) => void
  onShare: (id: string) => void
  onBranch: (id: string) => void
}

let renderProbe: ((messageId: string) => void) | undefined

/**
 * Count row function bodies in isolated tests. Production leaves this unset.
 *
 * @param probe Called with the message id each time a row function runs.
 */
export function observeAgentMessageRenders(probe: ((messageId: string) => void) | null): void {
  renderProbe = probe ?? undefined
}

/**
 * True when two image citation lists point at the same attachment objects.
 *
 * @param previous Images resolved for the previous thread.
 * @param next Images resolved for the next thread.
 */
function sameImages(
  previous: readonly (AgentImageAttachment | undefined)[],
  next: readonly (AgentImageAttachment | undefined)[]
): boolean {
  if (previous.length !== next.length) {
    return false
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false
    }
  }
  return true
}

/**
 * Build the current row dependencies in one pass.
 * Only this map is kept. Ancestor identity is a parent pointer, not a per-row chain string.
 *
 * @param thread Conversation the list is rendering.
 * @param previous Dependencies from the last thread, reused when their inputs are unchanged.
 */
export function projectAgentMessageDeps(
  thread: AgentThread,
  previous: ReadonlyMap<string, AgentMessageDeps>
): Map<string, AgentMessageDeps> {
  const runs = new Map(thread.runs.map((run) => [run.id, run]))
  const messages = new Map(thread.messages.map((message) => [message.id, message]))
  const images = new Map((thread.images ?? []).map((image) => [image.id, image]))
  const versions = new Map<string, string>()
  for (const message of thread.messages) {
    if (message.role !== 'assistant') {
      continue
    }
    const key = message.parentId ?? ''
    const status = message.runId ? (runs.get(message.runId)?.status ?? '') : ''
    const part = `${message.id}:${status}`
    const current = versions.get(key)
    versions.set(key, current ? `${current}\n${part}` : part)
  }
  const nodes = new Map<string, AgentAncestorIdentity>()
  const visiting = new Set<string>()
  const selfOf = (id: string): AgentAncestorIdentity | undefined => {
    const cached = nodes.get(id)
    if (cached) {
      return cached
    }
    if (visiting.has(id)) {
      return undefined
    }
    const message = messages.get(id)
    if (!message) {
      return undefined
    }
    visiting.add(id)
    const parent = message.parentId ? selfOf(message.parentId) : undefined
    visiting.delete(id)
    const status = message.runId ? (runs.get(message.runId)?.status ?? '') : ''
    const prior = previous.get(id)?.self
    const node =
      prior &&
      prior.id === message.id &&
      prior.runId === (message.runId ?? null) &&
      prior.status === status &&
      prior.parent === parent
        ? prior
        : { id: message.id, runId: message.runId ?? null, status, parent }
    nodes.set(id, node)
    return node
  }
  const next = new Map<string, AgentMessageDeps>()
  for (const message of thread.messages) {
    const self = selfOf(message.id)
    if (!self) {
      continue
    }
    const run = message.runId ? runs.get(message.runId) : undefined
    const ancestor = message.parentId ? selfOf(message.parentId) : undefined
    const versionKey = versions.get(message.parentId ?? '') ?? ''
    const imageRefs = (message.imageIds ?? []).map((id) => images.get(id))
    const prior = previous.get(message.id)
    if (
      prior &&
      prior.run === run &&
      prior.versions === versionKey &&
      prior.ancestor === ancestor &&
      prior.self === self &&
      prior.artifacts === thread.artifacts &&
      sameImages(prior.images, imageRefs)
    ) {
      next.set(message.id, prior)
      continue
    }
    next.set(message.id, {
      run,
      versions: versionKey,
      artifacts: thread.artifacts,
      images: imageRefs,
      ancestor,
      self
    })
  }
  return next
}

/**
 * True when this row's visible inputs are unchanged. A new thread object alone does not repaint it.
 *
 * @param previous Previous row props.
 * @param next Next row props.
 */
export function sameAgentMessageRow(
  previous: AgentMessageRowProps,
  next: AgentMessageRowProps
): boolean {
  if (previous.message !== next.message || previous.busy !== next.busy) {
    return false
  }
  if (previous.overview !== next.overview || previous.durationMs !== next.durationMs) {
    return false
  }
  if (previous.sourceTitle !== next.sourceTitle || previous.sourceUrl !== next.sourceUrl) {
    return false
  }
  if (previous.onSeek !== next.onSeek || previous.onRetry !== next.onRetry) {
    return false
  }
  if (previous.onDecideTool !== next.onDecideTool || previous.onShare !== next.onShare) {
    return false
  }
  if (previous.onBranch !== next.onBranch || previous.deps !== next.deps) {
    return false
  }
  if ((previous.overview || next.overview) && previous.currentTimeMs !== next.currentTimeMs) {
    return false
  }
  return true
}

/**
 * One transcript reply. Skips rendering when only a different message changed.
 * `deps` stays on the memo props and is not forwarded into the message view.
 */
function AgentMessageRow({
  message,
  thread,
  busy,
  overview,
  currentTimeMs,
  durationMs,
  sourceTitle,
  sourceUrl,
  onSeek,
  onRetry,
  onDecideTool,
  onShare,
  onBranch
}: AgentMessageRowProps) {
  renderProbe?.(message.id)
  return (
    <AgentChatMessageView
      busy={busy}
      currentTimeMs={currentTimeMs}
      durationMs={durationMs}
      message={message}
      onBranch={onBranch}
      onDecideTool={onDecideTool}
      onRetry={onRetry}
      onSeek={onSeek}
      onShare={onShare}
      overview={overview}
      sourceTitle={sourceTitle}
      sourceUrl={sourceUrl}
      thread={thread}
    />
  )
}

/** Memoized reply row. The comparator covers every prop that changes what the row shows. */
export const TranscriptAgentMessageRow = memo(AgentMessageRow, sameAgentMessageRow)

interface TranscriptAgentMessagesProps {
  thread: AgentThread
  messages: AgentChatMessage[]
  busy: boolean
  overviewPrompt: boolean
  currentTimeMs: number
  durationMs: number
  sourceTitle?: string | null
  sourceUrl?: string | null
  onSeek?: (seconds: number) => void
  onRetry: (id: string) => void
  onDecideTool?: (input: ToolDecision) => void
  onShare: (id: string) => void
  onBranch: (id: string) => void
}

/**
 * Render the selected branch. Callbacks stay stable and always read the latest parent handlers.
 *
 * @param props Selected messages and the actions those rows can invoke.
 */
export function TranscriptAgentMessages({
  thread,
  messages,
  busy,
  overviewPrompt,
  currentTimeMs,
  durationMs,
  sourceTitle,
  sourceUrl,
  onSeek,
  onRetry,
  onDecideTool,
  onShare,
  onBranch
}: TranscriptAgentMessagesProps) {
  const actions = useRef({ onSeek, onRetry, onDecideTool, onShare, onBranch })
  actions.current = { onSeek, onRetry, onDecideTool, onShare, onBranch }
  const projection = useRef<{ thread: AgentThread; deps: Map<string, AgentMessageDeps> } | null>(
    null
  )
  const deps =
    projection.current?.thread === thread
      ? projection.current.deps
      : projectAgentMessageDeps(thread, projection.current?.deps ?? new Map())
  if (projection.current?.thread !== thread) {
    projection.current = { thread, deps }
  }
  const seek = useCallback((seconds: number) => {
    actions.current.onSeek?.(seconds)
  }, [])
  const retry = useCallback((id: string) => {
    actions.current.onRetry(id)
  }, [])
  const decide = useCallback((input: ToolDecision) => {
    actions.current.onDecideTool?.(input)
  }, [])
  const share = useCallback((id: string) => {
    actions.current.onShare(id)
  }, [])
  const branch = useCallback((id: string) => {
    actions.current.onBranch(id)
  }, [])
  return messages.map((message) => {
    const rowDeps = deps.get(message.id)
    if (!rowDeps) {
      return null
    }
    return (
      <MessageScrollerItem key={message.id} messageId={message.id}>
        <TranscriptAgentMessageRow
          busy={busy}
          currentTimeMs={currentTimeMs}
          deps={rowDeps}
          durationMs={durationMs}
          message={message}
          onBranch={branch}
          onDecideTool={onDecideTool ? decide : undefined}
          onRetry={retry}
          onSeek={onSeek ? seek : undefined}
          onShare={share}
          overview={overviewPrompt}
          sourceTitle={sourceTitle}
          sourceUrl={sourceUrl}
          thread={thread}
        />
      </MessageScrollerItem>
    )
  })
}
