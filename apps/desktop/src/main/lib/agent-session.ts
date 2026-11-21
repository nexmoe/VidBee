import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Context, FetchFunction, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { AgentThinkingLevel, AgentThread } from '../../shared/agent-chat'
import { AgentUserError, parseAgentError, toSdkRetryMessage } from '../../shared/agent-errors'
import { VideoAgentSession } from './agent-durable-session'
import type { AgentHarnessTuning } from './agent-model-profile'
import type { AgentPermissionOptions } from './agent-permissions'
import { AgentProgressGuard } from './agent-progress'
import type { AgentWebAccessOptions } from './agent-web-access'

/** Agent-turn retries for transient Cloud/provider failures. Deeper than Pi's default 3 so worker restarts and stream drops can recover. */
export const AGENT_SESSION_MAX_RETRIES = 5
/** Official Pi exponential backoff base: 2s, 4s, 8s, 16s, 32s. */
export const AGENT_SESSION_RETRY_BASE_DELAY_MS = 2000

/**
 * Translate a Cloud transport failure into the SDK's retry vocabulary.
 *
 * The Pi SDK retries only messages containing `Connection error`. This adapter is the
 * only place that speaks that vocabulary.
 *
 * @param message Public error text from the Cloud stream.
 * @returns Reworded text, or undefined to leave the failure terminal.
 */
export const toSdkRetryMessageFromText = (message: string): string | undefined =>
  toSdkRetryMessage(parseAgentError(message))

/** Surface cancellation even if the SDK prompt wait does not reject after abort(). */
export async function runUntilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('The agent run was cancelled')
  }
  let onAbort: (() => void) | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => {
        reject(
          signal.reason instanceof Error ? signal.reason : new Error('The agent run was cancelled')
        )
      }
      signal.addEventListener('abort', onAbort, { once: true })
      work.then(resolve, reject)
    })
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

export interface VideoAgentSessionOptions {
  /** 0 disables retries so an unfinished stream can hand off instead of thinking again. */
  maxRetries?: number
  permissions?: AgentPermissionOptions & { onUsage: (message: AssistantMessage) => void }
  thread?: AgentThread
  thinkingLevel?: AgentThinkingLevel
  tuning?: AgentHarnessTuning
  history: AgentMessage[]
  model: Model<Api>
  apiKey: string
  fetch?: FetchFunction
  systemPrompt: string
  task: string
  tools: AgentTool[]
  /** Use Pi's native discovery for application tools outside the core loadout. */
  deferTools?: boolean
  /** Bundled web tools, discovered through Pi's native tool search. */
  webAccess?: AgentWebAccessOptions
  /** Profile-owned isolated tasks using the same Durable runtime. */
  durableTasks?: { directory: string; runId: string; contextKey?: () => string }
  /** Explicit UI-managed portable skill files. */
  skillPaths?: string[]
  cwd?: string
  signal: AbortSignal
  memory: () => string
  shouldStop: (context?: { message?: AssistantMessage }) => boolean
  /** Deliver completed background work before allowing a normal answer to settle. */
  onFinishTurn?: (context: {
    message: AssistantMessage
  }) => Promise<{ action: 'continue' } | undefined>
  onSummaryUsage: (message: import('@earendil-works/pi-ai').AssistantMessage) => void
  /** Live output cap so a truncated turn can retry with a larger budget. */
  outputTokens?: () => number
  /** Observed/estimated EMA factor for compaction token math. */
  calibration?: () => number
  /** Capture the request-time token estimate before the provider stream starts. */
  onBeforeStream?: (context: Context) => void
  /** Profile-owned journal for the current main run. */
  storageDirectory?: string
}

/** Create the main conversation with Durable as its only execution runtime. */
export async function createVideoAgentSession(
  options: VideoAgentSessionOptions
): Promise<VideoAgentSession> {
  return VideoAgentSession.open(options)
}

/** Flush the official journal and release all plugin services. */
export async function disposeAgentSession(session: VideoAgentSession): Promise<void> {
  await session.dispose()
}

const ONE_SHOT_RETRY = new Set([
  'TRANSPORT_LOST',
  'PROVIDER_UNAVAILABLE',
  'STREAM_INTERRUPTED',
  'RESUME_FAILED'
])

/** Run a bounded one-shot completion and return the provider message. */
export async function streamAgentCompletionMessage(options: {
  maxRetries?: number
  model: Model<Api>
  thinkingLevel?: AgentThinkingLevel
  apiKey: string
  fetch?: FetchFunction
  signal: AbortSignal
  systemPrompt?: string
  content?: string
  context?: Context
  maxTokens?: number
  onUsage: (message: AssistantMessage) => void
  onMessageUpdate?: (message: AssistantMessage) => void
}): Promise<AssistantMessage> {
  const retries = options.maxRetries ?? AGENT_SESSION_MAX_RETRIES
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    options.signal.throwIfAborted()
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, AGENT_SESSION_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
      )
    }
    try {
      const context: Context = options.context ?? {
        systemPrompt: options.systemPrompt ?? '',
        messages: [{ role: 'user', content: options.content ?? '', timestamp: Date.now() }]
      }
      const stream = streamSimple(options.model, context, {
        apiKey: options.apiKey,
        fetch: options.fetch,
        signal: options.signal,
        maxTokens: options.maxTokens,
        reasoning:
          !options.thinkingLevel || options.thinkingLevel === 'off'
            ? undefined
            : options.thinkingLevel,
        maxRetries: 0
      })
      const consume = (async () => {
        for await (const event of stream) {
          if ('partial' in event && event.partial?.role === 'assistant') {
            options.onMessageUpdate?.(event.partial)
          }
        }
      })()
      const result = await stream.result()
      await consume
      options.onUsage(result)
      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        const failure = parseAgentError(result.errorMessage)
        if (ONE_SHOT_RETRY.has(failure.code) && attempt < retries) {
          lastError = new Error(result.errorMessage || 'The source review did not finish')
          continue
        }
      }
      return result
    } catch (error) {
      if (options.signal.aborted) {
        throw error
      }
      if (error instanceof AgentUserError && !error.retryable) {
        throw error
      }
      const failure = parseAgentError(error instanceof Error ? error.message : String(error))
      if (failure.retryable && attempt < retries) {
        lastError = error instanceof Error ? error : new Error(String(error))
        continue
      }
      throw error
    }
  }
  throw lastError ?? new Error('The source review returned no result')
}

type AgentCompletionOptions = Parameters<typeof streamAgentCompletionMessage>[0] & {
  tools?: AgentTool[]
  tuning?: AgentHarnessTuning
  onMessage?: (message: AgentMessage) => void
}

/** Same STALLED copy as the main agent loop when repeated tool work makes no progress. */
const SECTION_STALLED_MESSAGE =
  'The assistant was stopped after repeating the same action without new progress. Your progress is saved.'

/**
 * Run one section with the parent agent's tool loop, retries, compaction, and stall stop.
 *
 * These sessions start from an empty history, so duplicate detection begins at the first tool result.
 */
async function streamAgentToolCompletion(
  options: AgentCompletionOptions & { tools: AgentTool[] }
): Promise<AssistantMessage> {
  const archived: AgentMessage[] = []
  const progressGuard = new AgentProgressGuard(0)
  let stalled = false
  const session = await createVideoAgentSession({
    maxRetries: options.maxRetries,
    tuning: options.tuning,
    thinkingLevel: options.thinkingLevel,
    history: [],
    model: options.model,
    apiKey: options.apiKey,
    fetch: options.fetch,
    signal: options.signal,
    systemPrompt: options.systemPrompt ?? '',
    task: options.content ?? '',
    tools: options.tools,
    memory: () => options.content ?? '',
    shouldStop: () => {
      if (!progressGuard.observe(archived)) {
        return false
      }
      stalled = true
      return true
    },
    onSummaryUsage: options.onUsage,
    outputTokens: () => options.maxTokens ?? options.model.maxTokens
  })
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update' && event.message.role === 'assistant') {
      options.onMessageUpdate?.(event.message)
    } else if (event.type === 'message_end') {
      // Listeners run before finishTurn, matching the main loop's archive.
      archived.push(structuredClone(event.message))
      if (event.message.role === 'assistant') {
        options.onUsage(event.message)
      }
      if (event.message.role === 'assistant' || event.message.role === 'toolResult') {
        options.onMessage?.(structuredClone(event.message))
      }
    }
  })
  try {
    await runUntilAborted(
      options.signal,
      session.prompt(options.content ?? '', { expandPromptTemplates: false })
    )
    if (stalled) {
      throw new AgentUserError(SECTION_STALLED_MESSAGE, 'STALLED', false)
    }
    const result = session.agent.state.messages.findLast((message) => message.role === 'assistant')
    if (result?.role !== 'assistant') {
      throw new AgentUserError('The source section returned no result', 'INTERNAL')
    }
    return result
  } finally {
    await session.abort()
    unsubscribe()
    await disposeAgentSession(session)
  }
}

/** Complete one task, retaining a full agent loop whenever tools are available. */
export async function streamAgentCompletion(options: AgentCompletionOptions): Promise<string> {
  const result = options.tools?.length
    ? await streamAgentToolCompletion({ ...options, tools: options.tools })
    : await streamAgentCompletionMessage(options)
  if (!options.tools?.length) {
    options.onMessage?.(result)
  }
  if (result.stopReason === 'error' || result.stopReason === 'aborted') {
    const failure = parseAgentError(result.errorMessage)
    throw new AgentUserError(
      result.errorMessage || 'The source review did not finish',
      failure.code,
      failure.retryable
    )
  }
  return result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}
