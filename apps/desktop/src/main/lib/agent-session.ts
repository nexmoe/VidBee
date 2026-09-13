import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core'
import {
  type Api,
  type AssistantMessage,
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
import { isRecoverableAiFailure } from '../../shared/ai-run'
import { summarizeAgentHistory } from './agent-compaction'
import { repairAgentHistory } from './agent-context'
import { agentHistoryText, agentMessageId } from './agent-memory'
import { type AgentHarnessTuning, agentRuntimePolicy } from './agent-model-profile'

/** Agent-turn retries for transient Cloud/provider failures. Deeper than Pi's default 3 so worker restarts and stream drops can recover. */
export const AGENT_SESSION_MAX_RETRIES = 5
/** Official Pi exponential backoff base: 2s, 4s, 8s, 16s, 32s. */
export const AGENT_SESSION_RETRY_BASE_DELAY_MS = 2000

/**
 * Translate a Cloud transport failure into the SDK's retry vocabulary.
 *
 * The Pi SDK decides retry eligibility by looking for `Connection error` in the
 * assistant error text, so a recoverable Cloud failure has to be re-worded before the
 * session will retry it. Recovery itself is classified by the shared
 * `isRecoverableAiFailure`, so this path stays aligned with the prompt runner instead of
 * carrying its own list of message strings.
 *
 * @param message Public error text from the Cloud stream.
 * @returns Reworded text, or undefined to leave the failure terminal.
 */
export const cloudRetryErrorMessage = (message: string): string | undefined => {
  const text = message.trim()
  if (!text || /^connection error/i.test(text)) {
    return undefined
  }
  return isRecoverableAiFailure({ message: text }) ? `Connection error: ${text}` : undefined
}

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
  const pending = new Map<string, string>()
  /** Persist explicit interrupted results before a later user turn can cross an unfinished tool batch. */
  const finishPending = (): void => {
    for (const [toolCallId, toolName] of pending) {
      manager.appendMessage({
        role: 'toolResult',
        toolCallId,
        toolName,
        content: [
          {
            type: 'text',
            text: 'This tool call was interrupted before a result was saved. Do not assume it succeeded.'
          }
        ],
        isError: true,
        timestamp: Date.now()
      })
    }
    pending.clear()
  }
  /** Repair stored failures while preserving the original archive outside the SDK request context. */
  const append = (message: AgentMessage): string | undefined => {
    if (message.role === 'custom') {
      finishPending()
      return manager.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details
      )
    }
    if (message.role === 'toolResult') {
      return pending.delete(message.toolCallId) ? manager.appendMessage(message) : undefined
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      return undefined
    }
    finishPending()
    const repaired =
      message.role === 'assistant' && ['error', 'aborted'].includes(message.stopReason)
        ? repairAgentHistory([message])[0]
        : message
    if (repaired.role !== 'user' && repaired.role !== 'assistant') {
      return undefined
    }
    if (repaired.role === 'assistant') {
      for (const part of repaired.content) {
        if (part.type === 'toolCall') {
          pending.set(part.id, part.name)
        }
      }
    }
    return manager.appendMessage(repaired)
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
      finishPending()
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
  finishPending()
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
  signal: AbortSignal
  memory: () => string
  shouldStop: (context?: { message?: AssistantMessage }) => boolean
  onSummaryUsage: (message: import('@earendil-works/pi-ai').AssistantMessage) => void
  /** Live output cap so a truncated turn can retry with a larger budget. */
  outputTokens?: () => number
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
          const errorMessage = cloudRetryErrorMessage(message.errorMessage ?? '')
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
            complete: (context, maxTokens) =>
              streamSimple(model, context, {
                apiKey: options.apiKey,
                fetch: options.fetch,
                signal: AbortSignal.any([options.signal, event.signal]),
                maxTokens,
                reasoning:
                  policy.summaryThinkingLevel === 'off' ? undefined : policy.summaryThinkingLevel,
                maxRetries: 1
              }).result(),
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
      tools: options.tools
    },
    toolExecution: 'sequential',
    getApiKey: () => options.apiKey,
    convertToLlm,
    streamFn: (currentModel, context, streamOptions) => {
      const memory = options.memory()
      return streamSimple(
        currentModel,
        {
          ...context,
          messages: memory
            ? [...context.messages, { role: 'user', content: memory, timestamp: Date.now() }]
            : context.messages
        },
        {
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
        }
      )
    },
    shouldStopAfterTurn: (context) => options.shouldStop(context)
  })
  return new AgentSession({
    agent,
    cwd: process.cwd(),
    sessionManager,
    settingsManager,
    resourceLoader,
    modelRuntime,
    baseToolsOverride: Object.fromEntries(options.tools.map((tool) => [tool.name, tool])),
    initialActiveToolNames: options.tools.map((tool) => tool.name),
    allowedToolNames: options.tools.map((tool) => tool.name)
  })
}

/** Run a bounded evidence check through the same SDK recovery and Cloud transport as the writer. */
export async function completeAgentTask(options: {
  maxRetries?: number
  model: Model<Api>
  tuning?: AgentHarnessTuning
  thinkingLevel: AgentThinkingLevel
  apiKey: string
  fetch?: FetchFunction
  signal: AbortSignal
  systemPrompt: string
  content: string
  onUsage: (message: AssistantMessage) => void
}): Promise<string> {
  const session = await createVideoAgentSession({
    ...options,
    thread: {
      id: 'source-review',
      downloadId: '',
      promptId: '',
      leafId: null,
      seq: 0,
      messages: [],
      runs: [],
      artifacts: []
    },
    history: [],
    task: 'Check source fidelity and completeness.',
    tools: [],
    memory: () => '',
    shouldStop: () => false,
    onSummaryUsage: options.onUsage
  })
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      options.onUsage(event.message)
    }
  })
  const abort = (): void => {
    session.agent.abort()
    session.abortCompaction()
  }
  options.signal.addEventListener('abort', abort, { once: true })
  try {
    await runUntilAborted(
      options.signal,
      session.prompt(options.content, { expandPromptTemplates: false })
    )
    const last = session.agent.state.messages.at(-1)
    if (last?.role !== 'assistant' || last.stopReason !== 'stop') {
      throw new Error(
        last?.role === 'assistant'
          ? last.errorMessage || 'The source review did not finish'
          : 'The source review returned no result'
      )
    }
    return last.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
  } finally {
    options.signal.removeEventListener('abort', abort)
    unsubscribe()
    session.dispose()
  }
}
