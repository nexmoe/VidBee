import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import {
  type Api,
  type AssistantMessage,
  type Context,
  type FetchFunction,
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Model
} from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import type { AgentSession, SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'
import {
  type AgentThinkingLevel,
  type AgentThread,
  selectedAgentMessages
} from '../../shared/agent-chat'
import { AgentUserError, parseAgentError, toSdkRetryMessage } from '../../shared/agent-errors'
import { summarizeAgentHistory } from './agent-compaction'
import { HistoryRepairer, repairAgentHistory } from './agent-context'
import { agentHistoryText, agentMessageId } from './agent-memory'
import { type AgentHarnessTuning, agentRuntimePolicy } from './agent-model-profile'

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

/** Restore the selected SDK branch through public append APIs, remapping compaction boundaries. */
export function restoreVideoAgentSession(
  manager: SessionManager,
  thread: AgentThread,
  history: AgentMessage[]
): SessionManager {
  const selected = selectedAgentMessages(thread).at(-1)
  const entries = thread.runs.find((run) => run.id === selected?.runId)?.sessionEntries as
    | SessionEntry[]
    | undefined
  const ids = new Map<string, string>()
  const repairer = new HistoryRepairer()
  /** Repair stored failures while preserving the original archive outside the SDK request context. */
  const append = (message: AgentMessage): string | undefined => {
    const ready = repairer.push(message)
    let last: string | undefined
    for (const item of ready) {
      if (item.role === 'custom') {
        last = manager.appendCustomMessageEntry(
          item.customType,
          item.content,
          item.display,
          item.details
        )
        continue
      }
      if (item.role === 'user' || item.role === 'assistant' || item.role === 'toolResult') {
        last = manager.appendMessage(item)
      }
    }
    return last
  }
  const flush = (): void => {
    for (const item of repairer.flush()) {
      if (item.role === 'toolResult') {
        manager.appendMessage(item)
      }
    }
  }
  for (const entry of entries ?? []) {
    let id: string | undefined
    if (
      entry.type === 'message' &&
      (entry.message.role === 'user' ||
        entry.message.role === 'assistant' ||
        entry.message.role === 'toolResult')
    ) {
      id = append(entry.message)
    } else if (entry.type === 'compaction') {
      flush()
      const kept = ids.get(entry.firstKeptEntryId)
      if (kept) {
        id = manager.appendCompaction(
          entry.summary,
          kept,
          entry.tokensBefore,
          entry.details,
          entry.fromHook,
          entry.usage
        )
      }
    } else if (entry.type === 'custom_message') {
      flush()
      id = manager.appendCustomMessageEntry(
        entry.customType,
        entry.content,
        entry.display,
        entry.details
      )
    }
    if (id) {
      ids.set(entry.id, id)
    }
  }
  if (!entries?.length) {
    for (const message of history) {
      append(message)
    }
  }
  flush()
  return manager
}

/** Let the official desktop session own compaction and retries while preserving the application transport. */
export async function createVideoAgentSession(options: {
  /** 0 disables retries so an unfinished stream can hand off instead of thinking again. */
  maxRetries?: number
  thread: AgentThread
  thinkingLevel?: AgentThinkingLevel
  tuning?: AgentHarnessTuning
  history: AgentMessage[]
  model: Model<Api>
  apiKey: string
  fetch?: FetchFunction
  systemPrompt: string
  task: string
  tools: AgentTool[]
  /** Registered tools may stay hidden until the current request needs them. */
  initialActiveToolNames?: string[]
  signal: AbortSignal
  memory: () => string
  shouldStop: (context?: { message?: AssistantMessage }) => boolean
  onSummaryUsage: (message: import('@earendil-works/pi-ai').AssistantMessage) => void
  /** Live output cap so a truncated turn can retry with a larger budget. */
  outputTokens?: () => number
  /** Observed/estimated EMA factor for compaction token math. */
  calibration?: () => number
  /** Capture the request-time token estimate before the provider stream starts. */
  onBeforeStream?: (context: Context) => void
}): Promise<AgentSession> {
  const {
    AgentSession,
    convertToLlm,
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager
  } = await import('@earendil-works/pi-coding-agent')
  const { model } = options
  const policy = agentRuntimePolicy(model, options.tuning)
  const { summaryOutputTokens } = policy
  const outputLimit = (): number =>
    options.outputTokens?.() ?? (model.maxTokens > 0 ? policy.outputTokens : 0)
  const settingsManager = SettingsManager.inMemory({
    compaction: {
      enabled: true,
      reserveTokens: policy.reserveTokens,
      keepRecentTokens: policy.keepRecentTokens
    },
    retry: {
      enabled: options.maxRetries !== 0,
      maxRetries: options.maxRetries ?? AGENT_SESSION_MAX_RETRIES,
      baseDelayMs: AGENT_SESSION_RETRY_BASE_DELAY_MS
    },
    images: { autoResize: false },
    enableAnalytics: false,
    enableInstallTelemetry: false
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    settingsManager,
    noExtensions: true,
    extensionFactories: [
      (pi) => {
        /** Translate the Cloud transport's public error into the SDK retry vocabulary. */
        pi.on('message_end', (event) => {
          const message = event.message
          if (message.role !== 'assistant' || message.stopReason !== 'error') {
            return undefined
          }
          const errorMessage = toSdkRetryMessage(parseAgentError(message.errorMessage))
          return errorMessage ? { message: { ...message, errorMessage } } : undefined
        })
        /** Preserve full video evidence while delegating boundaries and recovery to the SDK. */
        pi.on('session_before_compact', async (event) => {
          const preparation = event.preparation
          const source = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages]
          const summary = await summarizeAgentHistory({
            text: source
              .map(
                (message) =>
                  `[Archived evidence ${agentMessageId(message)}]\n${agentHistoryText(message.role === 'assistant' ? { ...message, content: message.content.filter((part) => part.type !== 'thinking') } : message)}`
              )
              .join('\n'),
            previous: `${preparation.previousSummary ?? ''}\n${options.memory()}`,
            task: options.task,
            targetTokens: policy.summaryTargetTokens,
            contextSafetyTokens: policy.contextSafetyTokens,
            contextWindow: model.contextWindow,
            maxOutputTokens: summaryOutputTokens,
            outputTokens: summaryOutputTokens,
            calibration: options.calibration?.() ?? 1,
            complete: (context, maxTokens) =>
              streamAgentCompletionMessage({
                model,
                apiKey: options.apiKey,
                fetch: options.fetch,
                signal: AbortSignal.any([options.signal, event.signal]),
                context,
                maxTokens,
                thinkingLevel: policy.summaryThinkingLevel,
                maxRetries: 1,
                onUsage: options.onSummaryUsage
              }),
            onUsage: options.onSummaryUsage
          })
          return {
            compaction: {
              summary,
              firstKeptEntryId: preparation.firstKeptEntryId,
              tokensBefore: preparation.tokensBefore
            }
          }
        })
      }
    ],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => []
  })
  await resourceLoader.reload()
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false
  })
  modelRuntime.registerProvider(model.provider, {
    api: model.api,
    baseUrl: model.baseUrl,
    apiKey: options.apiKey,
    models: [model]
  })
  const sessionManager = restoreVideoAgentSession(
    SessionManager.inMemory(process.cwd()),
    options.thread,
    options.history
  )
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: options.thinkingLevel ?? policy.defaultThinkingLevel,
      systemPrompt: options.systemPrompt,
      messages: repairAgentHistory(sessionManager.buildSessionContext().messages),
      tools: options.initialActiveToolNames
        ? options.tools.filter((tool) => options.initialActiveToolNames?.includes(tool.name))
        : options.tools
    },
    toolExecution: 'sequential',
    getApiKey: () => options.apiKey,
    convertToLlm,
    streamFn: (currentModel, context, streamOptions) => {
      options.onBeforeStream?.(context)
      return streamSimple(currentModel, context, {
        ...streamOptions,
        apiKey: options.apiKey,
        fetch: options.fetch,
        signal: AbortSignal.any([
          options.signal,
          ...(streamOptions?.signal ? [streamOptions.signal] : [])
        ]),
        maxTokens:
          outputLimit() > 0
            ? Math.min(streamOptions?.maxTokens ?? outputLimit(), outputLimit())
            : 0,
        maxRetries: 0
      })
    },
    shouldStopAfterTurn: (context) => options.shouldStop(context)
  })
  const session = new AgentSession({
    agent,
    cwd: process.cwd(),
    sessionManager,
    settingsManager,
    resourceLoader,
    modelRuntime,
    baseToolsOverride: Object.fromEntries(options.tools.map((tool) => [tool.name, tool])),
    initialActiveToolNames:
      options.initialActiveToolNames ?? options.tools.map((tool) => tool.name),
    allowedToolNames: options.tools.map((tool) => tool.name)
  })
  // The SDK also activates allowedToolNames during registry construction; apply visibility last.
  if (options.initialActiveToolNames) {
    session.setActiveToolsByName(options.initialActiveToolNames)
  }
  return session
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

/** Run a bounded one-shot completion with shared retry, without constructing a full session. */
export async function streamAgentCompletion(
  options: Parameters<typeof streamAgentCompletionMessage>[0]
): Promise<string> {
  const result = await streamAgentCompletionMessage(options)
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
