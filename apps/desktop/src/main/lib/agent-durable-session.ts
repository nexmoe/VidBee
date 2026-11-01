import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { JsonValue } from '@earendil-works/chord'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  ImageContent,
  Message,
  ToolResultMessage
} from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import {
  type AgentEvent,
  type AgentEventStream,
  CompactionTask,
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  type EntryRecord,
  GenerationTask,
  Harness,
  hook,
  type JsonObject,
  MemoryStorage,
  type ToolExecutionApi,
  type ToolRegistration,
  ToolTask,
  watchEvents
} from '@earendil-works/pi-durable'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { createToolSearchTool } from '@earendil-works/pi-durable/tool-search'
import { type AgentThinkingLevel, selectedAgentMessages } from '../../shared/agent-chat'
import { parseAgentError, toSdkRetryMessage } from '../../shared/agent-errors'
import { summarizeAgentHistory } from './agent-compaction'
import { HistoryRepairer } from './agent-context'
import { AGENT_DURABLE_TOOL_NAMES, createAgentDurableTasks } from './agent-durable-tasks'
import { agentNativeTool, executeDurableTool } from './agent-durable-tools'
import { agentHistoryText, agentMessageId } from './agent-memory'
import { agentRuntimePolicy } from './agent-model-profile'
import { createAgentModels } from './agent-model-runtime'
import {
  AGENT_REVIEW_MODEL,
  AGENT_REVIEW_PROVIDER,
  createAgentPermissions
} from './agent-permissions'
import { streamAgentCompletionMessage, type VideoAgentSessionOptions } from './agent-session'
import type {
  AgentRuntimeTool,
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionEvents,
  ExtensionHandler,
  ExtensionToolContext,
  SessionEntry,
  Skill,
  ToolDefinition
} from './agent-session-types'
import { agentSkillCatalog, agentSkillInput, loadAgentSkills } from './agent-skill-runtime'
import { CORE_AGENT_TOOLS } from './agent-tool-loading'
import { AGENT_WEB_TOOL_NAMES, createAgentWebAccess } from './agent-web-access'

/** Keep tool metadata and stored application data within Durable's JSON contract. */
function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

/** Select the existing reply branch, including legacy snapshots without an SDK dependency. */
export function restoreVideoAgentEntries(
  options: Pick<VideoAgentSessionOptions, 'thread' | 'history'>
): SessionEntry[] {
  const selected = options.thread ? selectedAgentMessages(options.thread).at(-1) : undefined
  const saved = options.thread?.runs.find((run) => run.id === selected?.runId)?.sessionEntries as
    | SessionEntry[]
    | undefined
  const repairer = new HistoryRepairer()
  const repaired: SessionEntry[] = []
  let parentId: string | null = null
  /** Preserve imported identities while explicitly closing interrupted tool batches. */
  const append = (message: AgentMessage, original?: SessionEntry): void => {
    const base = {
      id: original?.id ?? randomUUID(),
      parentId,
      timestamp: original?.timestamp ?? new Date().toISOString()
    }
    const entry: SessionEntry =
      message.role === 'custom'
        ? {
            ...base,
            type: 'custom_message',
            customType: message.customType,
            content: message.content,
            display: message.display,
            details: message.details
          }
        : { ...base, type: 'message', message }
    repaired.push(entry)
    parentId = entry.id
  }
  for (const entry of saved?.length
    ? saved
    : options.history.map((message) => ({
        id: randomUUID(),
        parentId: null,
        timestamp: new Date().toISOString(),
        type: 'message' as const,
        message
      }))) {
    if (entry.type === 'message') {
      const ready = repairer.push(entry.message)
      for (const [index, message] of ready.entries()) {
        append(message, index === ready.length - 1 ? entry : undefined)
      }
    } else {
      for (const message of repairer.flush()) {
        append(message)
      }
      repaired.push(entry)
      parentId = entry.id
    }
  }
  for (const message of repairer.flush()) {
    append(message)
  }
  return repaired
}

/** Project nested tool values, including native image results and blocked-call diagnostics. */
function nestedContent(
  value: JsonValue | undefined,
  diagnostics: readonly { message: string }[]
): ToolResultMessage['content'] {
  if (Array.isArray(value)) {
    return value as unknown as ToolResultMessage['content']
  }
  if (value && typeof value === 'object' && value.type === 'image') {
    return [value as unknown as ImageContent]
  }
  return [
    {
      type: 'text',
      text:
        typeof value === 'string'
          ? value
          : value === undefined
            ? diagnostics.map((item) => item.message).join('\n')
            : JSON.stringify(value)
    }
  ]
}

/** One application session over the official Durable harness; there is no second agent loop. */
export class VideoAgentSession {
  readonly sessionId = randomUUID()
  readonly skills: Skill[]
  readonly agent: {
    state: {
      messages: AgentMessage[]
      tools: AgentRuntimeTool[]
      model: VideoAgentSessionOptions['model']
      systemPrompt: string
    }
    subscribe: (listener: (event: AgentSessionEvent) => void) => () => void
    abort: () => void
  }
  readonly sessionManager
  readonly resourceLoader
  private readonly listeners = new Set<(event: AgentSessionEvent) => void>()
  private readonly handlers = new Map<string, ExtensionHandler[]>()
  private readonly bus = new EventEmitter()
  private readonly tools: (AgentRuntimeTool | ToolDefinition)[] = []
  private readonly seen = new Set<import('@earendil-works/pi-durable').EntryId>()
  private readonly endedTools = new Set<string>()
  private readonly startedTools = new Set<string>()
  private readonly entries: SessionEntry[] = []
  private readonly pendingPluginWrites: Promise<unknown>[] = []
  private readonly options: VideoAgentSessionOptions
  private activeTools: string[] = []
  private permissions?: Awaited<ReturnType<typeof createAgentPermissions>>
  private harness!: Harness
  private conversation!: Conversation
  private events?: AgentEventStream
  private partial?: AssistantMessage
  private thinkingLevel: AgentThinkingLevel
  private closed?: Promise<void>
  private readonly compactions = new Set<import('@earendil-works/pi-durable').TaskId>()

  /** Build the application projection before initializing extension lifecycles. */
  private constructor(options: VideoAgentSessionOptions, skills: Skill[]) {
    this.options = options
    this.skills = skills
    this.thinkingLevel =
      options.thinkingLevel ??
      agentRuntimePolicy(options.model, options.tuning).defaultThinkingLevel
    this.sessionManager = {
      getBranch: () => this.entries,
      getEntries: () => this.entries,
      getSessionId: () => this.sessionId,
      getSessionDir: () => options.storageDirectory ?? options.cwd ?? process.cwd(),
      getSessionFile: () => undefined,
      getSessionName: () => undefined,
      getLeafId: () => this.entries.at(-1)?.id ?? null,
      getCwd: () => options.cwd ?? process.cwd()
    }
    this.resourceLoader = { getSkills: () => ({ skills: this.skills }) }
    this.agent = {
      state: { messages: [], tools: [], model: options.model, systemPrompt: options.systemPrompt },
      subscribe: (listener) => this.subscribe(listener),
      abort: () => {
        void this.abort().catch(() => undefined)
      }
    }
  }

  /** Open storage, load plugins and register native tools before any scheduling begins. */
  static async open(options: VideoAgentSessionOptions): Promise<VideoAgentSession> {
    const session = new VideoAgentSession(options, await loadAgentSkills(options.skillPaths ?? []))
    try {
      await session.initialize()
      return session
    } catch (error) {
      await session.dispose()
      throw error
    }
  }

  /** Deliver application events synchronously so approval and activity state stay ordered. */
  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** Record the actual attempted call before approval, including calls denied before native intent. */
  private startTool(event: Extract<AgentSessionEvent, { toolCallId: string }>): void {
    if (this.startedTools.has(event.toolCallId)) {
      return
    }
    this.startedTools.add(event.toolCallId)
    this.emit({ ...event, type: 'tool_execution_start' })
  }

  /** Subscribe without owning or changing the underlying Durable lifecycle. */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Run actual upstream plugin handlers in registration order, stopping on a denial. */
  private async pluginEvent<K extends keyof ExtensionEvents>(
    event: ExtensionEvents[K],
    context = this.pluginContext()
  ): Promise<unknown> {
    let result: unknown
    for (const handler of this.handlers.get(event.type) ?? []) {
      const next = await handler(event, context)
      if (next !== undefined) {
        result = next
      }
      if (next && typeof next === 'object' && 'block' in next && next.block) {
        break
      }
    }
    return result
  }

  /** Provide application context and the same selected transport to the upstream reviewer. */
  private pluginContext(
    signal = this.options.signal,
    api?: ToolExecutionApi
  ): ExtensionToolContext {
    const { options } = this
    return {
      cwd: this.sessionManager.getCwd(),
      signal,
      hasUI: true,
      mode: 'rpc',
      model: options.model,
      sessionManager: this.sessionManager,
      isProjectTrusted: () => false,
      isIdle: () => !this.partial,
      abort: () => this.abort(),
      ui: {
        select: async () => undefined,
        setStatus: () => undefined,
        notify: () => undefined,
        ...this.permissions?.ui
      },
      modelRegistry: {
        getProvider: (provider) =>
          provider === AGENT_REVIEW_PROVIDER || provider === options.model.provider
            ? { getModels: () => [options.model] }
            : undefined,
        find: (provider, id) =>
          provider === AGENT_REVIEW_PROVIDER && id === AGENT_REVIEW_MODEL
            ? { ...options.model, provider, id }
            : provider === options.model.provider && id === options.model.id
              ? options.model
              : undefined,
        getAll: () => [options.model],
        /** Keep reviewer calls on VidBee's transport and account for every attempt. */
        streamSimple: (_model, context, streamOptions) => {
          const stream = streamSimple(options.model, context, {
            ...streamOptions,
            apiKey: options.apiKey,
            fetch: options.fetch,
            signal: AbortSignal.any([
              signal,
              ...(streamOptions?.signal ? [streamOptions.signal] : [])
            ]),
            maxTokens: Math.min(options.model.maxTokens || 2048, 2048),
            maxRetries: 0
          })
          void stream
            .result()
            .then((message) => options.permissions?.onUsage(message))
            .catch(() => undefined)
          return stream
        }
      },
      tools: this.tools as AgentRuntimeTool[],
      /** Delegate nesting to Durable, including validation, permissions and replay policy. */
      executeTool: async (name, args, nestedOptions) => {
        if (!api) {
          throw new Error('Nested tools require an active Durable invocation')
        }
        const context = withAbortSignal(nestedOptions?.signal ?? signal, BACKGROUND_CONTEXT)
        const outcome = await api.executeTool(name, json(args) as JsonObject, context)
        return {
          result: {
            content: nestedContent(outcome.structuredOutput, outcome.diagnostics),
            details: outcome.details ?? {}
          },
          isError: outcome.isError
        }
      }
    }
  }

  /** Expose plugin registration only; Durable remains responsible for tool discovery and execution. */
  private pluginApi(): ExtensionAPI {
    return {
      appendEntry: (customType, data) => {
        const write = this.conversation.commit(
          (tx) =>
            tx.appendEntry(this.conversation.id, {
              kind: 'vidbee.plugin',
              data: json({ customType, data })
            }),
          BACKGROUND_CONTEXT
        )
        void write.catch(() => undefined)
        this.pendingPluginWrites.push(write)
      },
      on: (event, handler) => {
        const handlers = this.handlers.get(event) ?? []
        handlers.push(handler as ExtensionHandler)
        this.handlers.set(event, handlers)
        return () => {
          const index = handlers.indexOf(handler as ExtensionHandler)
          if (index >= 0) {
            handlers.splice(index, 1)
          }
        }
      },
      events: {
        on: (name, handler) => {
          this.bus.on(name, handler)
          return () => {
            this.bus.off(name, handler)
          }
        },
        emit: (name, value) => {
          this.bus.emit(name, value)
        }
      },
      registerTool: (tool) => {
        this.tools.push(tool as ToolDefinition)
      },
      registerCommand: () => undefined,
      registerShortcut: () => undefined,
      getAllTools: () => this.tools as AgentRuntimeTool[],
      getActiveTools: () => this.activeTools,
      setActiveTools: (names) => {
        this.activeTools = names
      }
    }
  }

  /** Install adapters, then create one Durable conversation with the selected history branch. */
  private async initialize(): Promise<void> {
    const { options } = this
    const cwd = this.sessionManager.getCwd()
    const policy = agentRuntimePolicy(options.model, options.tuning)
    this.tools.push(...options.tools)
    if (options.deferTools) {
      this.tools.push(agentNativeTool(createToolSearchTool(), cwd, options.signal))
    }
    const api = this.pluginApi()
    const web =
      options.webAccess && options.deferTools
        ? await createAgentWebAccess(options.webAccess)
        : undefined
    const durable = options.durableTasks
      ? createAgentDurableTasks({
          ...options,
          ...options.durableTasks,
          cwd,
          skills: () => this.skills,
          onUsage: options.onSummaryUsage
        })
      : undefined
    const extensionTools = [
      ...(web ? AGENT_WEB_TOOL_NAMES : []),
      ...(durable ? AGENT_DURABLE_TOOL_NAMES : [])
    ]
    this.permissions = options.permissions
      ? await createAgentPermissions(options.permissions, cwd, options.tools, extensionTools)
      : undefined
    if (this.permissions) {
      await this.permissions.extension(api)
    }
    if (web) {
      await web(api)
    }
    if (durable) {
      await durable(api)
    }
    this.activeTools = this.tools
      .filter(
        (tool) =>
          !options.deferTools || CORE_AGENT_TOOLS.has(tool.name) || tool.name === 'tool_search'
      )
      .map((tool) => tool.name)
    const registry = createRegistry()
    registry.install(
      defineExtension({
        name: 'vidbee',
        tools: this.tools.map((tool) => this.registerTool(tool)),
        hooks: [
          hook(ToolTask, {
            beforeTool: async (call, _api, context) => {
              await this.syncEntries()
              options.signal.throwIfAborted()
              this.startTool({
                type: 'tool_execution_start',
                toolCallId: call.id,
                toolName: call.name,
                args: call.arguments,
                parentToolCallId: call.parent?.callId
              })
              const result = await this.pluginEvent(
                {
                  type: 'tool_call',
                  toolCallId: call.id,
                  toolName: call.name,
                  input: call.arguments
                },
                this.pluginContext(context.abortSignal)
              )
              if (result && typeof result === 'object' && 'block' in result && result.block) {
                return { block: 'reason' in result ? String(result.reason) : 'Permission denied' }
              }
              return undefined
            },
            afterTool: async (call, result, _api, context) => {
              await this.flushPluginWrites()
              await this.pluginEvent(
                {
                  type: 'tool_result',
                  toolCallId: call.id,
                  toolName: call.name,
                  input: call.arguments,
                  content: result.output ?? [],
                  details: result.details,
                  isError: result.isError ?? false
                },
                this.pluginContext(context.abortSignal)
              )
              this.endedTools.add(call.id)
              this.emit({
                type: 'tool_execution_end',
                toolCallId: call.id,
                toolName: call.name,
                parentToolCallId: call.parent?.callId,
                isError: result.isError
              })
              return options.shouldStop()
                ? { ...result, control: { ...result.control, terminate: true } }
                : result
            }
          }),
          hook(GenerationTask, {
            beforeRequest: async () => {
              await this.syncEntries()
              await this.pluginEvent({ type: 'turn_start' })
              return undefined
            },
            afterResponse: (message) => {
              if (message.stopReason === 'error') {
                message.errorMessage =
                  toSdkRetryMessage(parseAgentError(message.errorMessage)) ?? message.errorMessage
              }
            },
            onYield: async (message) => {
              await this.syncEntries()
              const continuation = await options.onFinishTurn?.({ message })
              if (continuation) {
                return {
                  continue:
                    'Continue the original request from the background task outcomes supplied above.'
                }
              }
              options.shouldStop({ message })
              return undefined
            }
          }),
          hook(CompactionTask, {
            beforeCompact: async (preparation, _api, context) => ({
              summary: await summarizeAgentHistory({
                text: preparation.messages
                  .map(
                    (message) =>
                      `[Archived evidence ${agentMessageId(message)}]\n${agentHistoryText(message.role === 'assistant' ? { ...message, content: message.content.filter((part) => part.type !== 'thinking') } : (message as AgentMessage))}`
                  )
                  .join('\n'),
                previous: `${this.entries.findLast((entry) => entry.type === 'compaction')?.type === 'compaction' ? (this.entries.findLast((entry) => entry.type === 'compaction') as Extract<SessionEntry, { type: 'compaction' }>).summary : ''}\n${options.memory()}`,
                task: options.task,
                targetTokens: policy.summaryTargetTokens,
                contextSafetyTokens: policy.contextSafetyTokens,
                contextWindow: options.model.contextWindow,
                maxOutputTokens: policy.summaryOutputTokens,
                outputTokens: policy.summaryOutputTokens,
                calibration: options.calibration?.() ?? 1,
                complete: (request, maxTokens) =>
                  streamAgentCompletionMessage({
                    model: options.model,
                    apiKey: options.apiKey,
                    fetch: options.fetch,
                    signal: AbortSignal.any([
                      options.signal,
                      ...(context.abortSignal ? [context.abortSignal] : [])
                    ]),
                    context: request,
                    maxTokens,
                    thinkingLevel: policy.summaryThinkingLevel,
                    maxRetries: 1,
                    onUsage: options.onSummaryUsage
                  }),
                onUsage: () => undefined
              })
            })
          })
        ]
      })
    )
    const storage = options.storageDirectory
      ? await openNodeJsonlStorage(options.storageDirectory, BACKGROUND_CONTEXT, { fsync: true })
      : new MemoryStorage()
    this.harness = await Harness.open(
      storage,
      {
        registry,
        models: createAgentModels({
          ...options,
          outputTokens:
            options.outputTokens ?? (() => (options.model.maxTokens > 0 ? policy.outputTokens : 0))
        }),
        env: () => new NodeExecutionEnv({ cwd }),
        settings: {
          toolExecution: 'sequential',
          stream: { maxRetries: 0 },
          retry: {
            enabled: options.maxRetries !== 0,
            maxRetries: options.maxRetries ?? 5,
            baseDelayMs: 2000
          },
          compaction: {
            enabled: true,
            reserveTokens: policy.reserveTokens,
            keepRecentTokens: policy.keepRecentTokens,
            backgroundTokens: 0
          }
        }
      },
      BACKGROUND_CONTEXT
    )
    this.conversation = await this.harness.root(BACKGROUND_CONTEXT, {
      agent: {
        model: { provider: options.model.provider, modelId: options.model.id },
        thinkingLevel: this.thinkingLevel,
        instructions: [options.systemPrompt, agentSkillCatalog(this.skills)]
          .filter(Boolean)
          .join('\n\n'),
        cwd
      }
    })
    const existing = await this.conversation.entries(
      { order: 'ascending' },
      1,
      undefined,
      BACKGROUND_CONTEXT
    )
    if (!existing.items.length) {
      await this.importHistory(restoreVideoAgentEntries(options))
    }
    await this.syncEntries(false)
    this.events = await watchEvents(this.harness, this.conversation.id, BACKGROUND_CONTEXT)
    this.events.start(async (batch) => {
      for (const event of batch) {
        await this.onEvent(event)
      }
    })
    await this.pluginEvent({ type: 'session_start' })
    this.permissions?.assertReady()
  }

  /** Adapt application tools while running native file and shell tools without a compatibility executor. */
  private registerTool(tool: AgentRuntimeTool | ToolDefinition): ToolRegistration {
    const native = 'durableTool' in tool ? tool.durableTool : undefined
    return defineTool({
      ...native,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      deferred:
        this.options.deferTools && !CORE_AGENT_TOOLS.has(tool.name) && tool.name !== 'tool_search'
          ? true
          : undefined,
      executionMode: 'sequential',
      replay:
        native?.replay ??
        ([
          'read_transcript',
          'search_transcript',
          'list_transcripts',
          'get_video_info',
          'get_task',
          'list_tasks',
          'wait_for_task',
          'read_task_result',
          'delegate_task',
          'resume_task'
        ].includes(tool.name)
          ? 'safe'
          : 'unsafe'),
      execute: async (args, api, context) => {
        if (native) {
          return native.execute(args, api, context)
        }
        const legacy = tool as ToolDefinition
        const outcome = await legacy.execute(
          api.callId,
          args,
          context.abortSignal,
          (update) => {
            const text = update.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('\n')
            if (text) {
              api.output(text)
            }
            if (update.details !== undefined) {
              void api.details(json(update.details), context).catch(() => undefined)
            }
          },
          this.pluginContext(context.abortSignal, api)
        )
        return {
          output: outcome.content,
          details: json(outcome.details),
          usage: outcome.usage,
          isError: 'isError' in outcome ? Boolean(outcome.isError) : false
        }
      }
    })
  }

  /** Import legacy entries through official append APIs, remapping compacted context heads. */
  private async importHistory(entries: SessionEntry[]): Promise<void> {
    const ids = new Map<string, import('@earendil-works/pi-durable').EntryId>()
    await this.conversation.commit(async (tx) => {
      for (const entry of entries) {
        let draft: import('@earendil-works/pi-durable').EntryDraft | undefined
        if (entry.type === 'message' && entry.message.role !== 'custom') {
          draft = {
            kind:
              entry.message.role === 'assistant'
                ? 'pi.assistant'
                : entry.message.role === 'toolResult'
                  ? 'pi.tool-result'
                  : 'pi.user',
            model: [entry.message as Message]
          }
        } else if (
          entry.type === 'custom_message' ||
          (entry.type === 'message' && entry.message.role === 'custom')
        ) {
          const custom =
            entry.type === 'custom_message'
              ? entry
              : (entry.message as Extract<AgentMessage, { role: 'custom' }>)
          draft = {
            kind: 'vidbee.custom',
            model: [
              {
                role: 'user',
                content: custom.content,
                timestamp: Date.parse(entry.timestamp) || Date.now()
              }
            ],
            data: json({
              customType: custom.customType,
              display: custom.display,
              details: custom.details
            })
          }
        } else if (entry.type === 'custom') {
          draft = {
            kind: 'vidbee.plugin',
            data: json({ customType: entry.customType, data: entry.data })
          }
        } else if (entry.type === 'compaction') {
          const head = ids.get(entry.firstKeptEntryId)
          if (head) {
            draft = {
              kind: 'pi.compaction',
              head,
              model: [{ role: 'user', content: entry.summary, timestamp: Date.now() }],
              data: { reason: 'manual' }
            }
          }
        }
        if (draft) {
          ids.set(entry.id, (await tx.appendEntry(this.conversation.id, draft)).id)
        }
      }
    }, BACKGROUND_CONTEXT)
  }

  /** Append each committed entry to the application archive once, independently of event delivery pace. */
  private projectEntry(entry: EntryRecord, notify = true): void {
    if (this.seen.has(entry.id)) {
      return
    }
    this.seen.add(entry.id)
    const message = entry.model?.[0]
    const base = {
      id: String(entry.id),
      parentId: this.entries.at(-1)?.id ?? null,
      timestamp: new Date(
        message && 'timestamp' in message ? message.timestamp : Date.now()
      ).toISOString()
    }
    let projected: SessionEntry | undefined
    if (entry.kind === 'pi.compaction') {
      projected = {
        ...base,
        type: 'compaction',
        summary:
          typeof message?.content === 'string'
            ? message.content
            : JSON.stringify(message?.content ?? ''),
        firstKeptEntryId: String(entry.head ?? entry.id),
        tokensBefore: 0
      }
    } else if (entry.kind === 'vidbee.plugin') {
      const data = entry.data as { customType: string; data?: unknown }
      projected = { ...base, type: 'custom', ...data }
    } else if (entry.kind === 'vidbee.custom') {
      const data = entry.data as { customType: string; display: boolean; details?: unknown }
      projected = {
        ...base,
        type: 'custom_message',
        ...data,
        content: message?.role === 'user' ? message.content : ''
      }
    } else if (message && message.role !== 'system') {
      projected = { ...base, type: 'message', message }
    }
    if (!projected) {
      return
    }
    this.entries.push(projected)
    if (notify) {
      this.emit({ type: 'entry_appended' })
      if (projected.type === 'message') {
        this.emit({ type: 'message_end', message: projected.message })
      }
    }
  }

  /** Reconcile committed history before permissions, continuation and final persistence inspect it. */
  private async syncEntries(notify = true): Promise<void> {
    if (!this.conversation) {
      return
    }
    let cursor: import('@earendil-works/pi-durable').Cursor | undefined
    do {
      const page = await this.conversation.entries(
        { order: 'ascending' },
        1000,
        cursor,
        BACKGROUND_CONTEXT
      )
      for (const entry of page.items) {
        this.projectEntry(entry, notify)
      }
      cursor = page.next
    } while (cursor)
    const view = await this.conversation.context(BACKGROUND_CONTEXT)
    this.agent.state.messages = [...view.messages] as AgentMessage[]
    const agent = await this.conversation.agent(BACKGROUND_CONTEXT)
    const byName = new Map(this.tools.map((tool) => [tool.name, tool]))
    this.agent.state.tools = agent.tools.map((tool) => ({
      ...byName.get(tool.name),
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (id, args, signal) => {
        const message = await executeDurableTool(
          this.harness,
          this.conversation,
          tool.name,
          id,
          json(args) as JsonObject,
          signal ?? this.options.signal
        )
        await this.syncEntries()
        return { content: message.content, details: message.details ?? {} }
      }
    }))
    this.activeTools = agent.tools.map((tool) => tool.name)
  }

  /** Commit plugin bookkeeping before completing the tool that produced it. */
  private async flushPluginWrites(): Promise<void> {
    await Promise.all(this.pendingPluginWrites.splice(0))
  }

  /** Project Durable deltas and lifecycle events into the existing desktop event contract. */
  private async onEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'snapshot') {
      await this.syncEntries()
      this.partial = event.generation?.message
        ? structuredClone(event.generation.message)
        : undefined
      if (this.partial) {
        this.emit({ type: 'message_update', message: this.partial })
      }
    } else if (event.type === 'entry_appended' || event.type === 'message_end') {
      this.projectEntry(event.entry)
    } else if (event.type === 'message_start' && event.message.role === 'assistant') {
      this.partial = structuredClone(event.message)
    } else if (event.type === 'message_update') {
      for (const change of event.changes) {
        if (change.type === 'message') {
          this.partial = structuredClone(change.message)
        } else if (this.partial && 'block' in change) {
          this.partial.content[change.contentIndex] = structuredClone(change.block)
        } else if (
          this.partial &&
          (change.type === 'text_delta' || change.type === 'thinking_delta')
        ) {
          const block = this.partial.content[change.contentIndex]
          if (block?.type === 'text' && change.type === 'text_delta') {
            block.text += change.delta
          }
          if (block?.type === 'thinking' && change.type === 'thinking_delta') {
            block.thinking += change.delta
          }
        }
      }
      if (this.partial) {
        this.emit({ type: 'message_update', message: structuredClone(this.partial) })
      }
    } else if (
      event.type === 'tool_execution_start' ||
      event.type === 'tool_execution_update' ||
      event.type === 'tool_execution_end'
    ) {
      this.startTool({
        type: 'tool_execution_start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        parentToolCallId: event.parentToolCallId,
        args: 'args' in event ? event.args : undefined
      })
      if (event.type === 'tool_execution_start') {
        return
      }
      if (event.type === 'tool_execution_end' && this.endedTools.delete(event.toolCallId)) {
        return
      }
      this.emit({
        type: event.type,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        parentToolCallId: event.parentToolCallId,
        args: 'args' in event ? event.args : undefined,
        isError:
          event.type === 'tool_execution_end'
            ? (event.result?.isError ??
              (event.entry?.model?.[0] as ToolResultMessage | undefined)?.isError)
            : undefined
      })
    } else if (event.type === 'compaction_start') {
      this.compactions.add(event.taskId)
      this.emit({ type: 'compaction_start', reason: event.reason })
    } else if (event.type === 'compaction_end') {
      this.compactions.delete(event.taskId)
      this.emit({ type: 'compaction_end', reason: event.reason, errorMessage: event.error })
    } else if (
      event.type === 'auto_retry_start' ||
      event.type === 'auto_retry_end' ||
      event.type === 'turn_start' ||
      event.type === 'turn_end'
    ) {
      this.emit({ type: event.type })
    } else if (event.type === 'run_start' || event.type === 'run_end') {
      this.emit({ type: event.type === 'run_start' ? 'agent_start' : 'agent_end' })
    }
  }

  /** Submit one input with explicit skill expansion and await its durable admission outcome. */
  async prompt(
    text: string,
    options?: { expandPromptTemplates?: boolean; images?: ImageContent[] }
  ): Promise<void> {
    this.options.signal.throwIfAborted()
    const transformed = await this.pluginEvent({ type: 'input', text, source: 'rpc' })
    if (
      transformed &&
      typeof transformed === 'object' &&
      'action' in transformed &&
      transformed.action === 'handled'
    ) {
      return
    }
    const supplied =
      transformed &&
      typeof transformed === 'object' &&
      'action' in transformed &&
      transformed.action === 'transform' &&
      'text' in transformed &&
      typeof transformed.text === 'string'
        ? transformed.text
        : text
    const input = await agentSkillInput(supplied, this.skills)
    await this.pluginEvent({
      type: 'before_agent_start',
      systemPrompt: this.options.systemPrompt,
      prompt: input
    })
    await this.conversation.configure({ thinkingLevel: this.thinkingLevel }, BACKGROUND_CONTEXT)
    const submission = await this.conversation.submit(
      {
        type: 'input',
        content: options?.images?.length
          ? [{ type: 'text', text: input }, ...options.images]
          : input
      },
      BACKGROUND_CONTEXT
    )
    await submission.wait(withAbortSignal(this.options.signal, BACKGROUND_CONTEXT))
    await this.syncEntries()
    this.partial = undefined
  }

  /** Append application observations as passive context without starting an independent run. */
  async sendCustomMessage(
    message: { customType: string; content: string; display: boolean; details?: unknown },
    _options?: { triggerTurn?: boolean }
  ): Promise<void> {
    await this.conversation.submit(
      {
        type: 'write',
        entry: {
          kind: 'vidbee.custom',
          model: [{ role: 'user', content: message.content, timestamp: Date.now() }],
          data: json(message)
        }
      },
      BACKGROUND_CONTEXT
    )
    await this.syncEntries()
  }

  /** Apply the next explicit thinking setting through Durable's conversation configuration. */
  setThinkingLevel(level: AgentThinkingLevel): void {
    this.thinkingLevel = level
  }

  /** Read the current native model loadout without loading deferred schemas. */
  getActiveToolNames(): string[] {
    return [...this.activeTools]
  }

  /** Return the plugin and application catalog for inspection. */
  getAllTools(): Array<AgentRuntimeTool & { deferred?: true }> {
    return this.tools.map((tool) => ({
      ...tool,
      deferred:
        this.options.deferTools && !CORE_AGENT_TOOLS.has(tool.name) && tool.name !== 'tool_search'
          ? true
          : undefined
    })) as Array<AgentRuntimeTool & { deferred?: true }>
  }

  /** Abort only this session's active compactions. */
  abortCompaction(): void {
    for (const id of this.compactions) {
      void this.harness.abortTask(id, BACKGROUND_CONTEXT).catch(() => undefined)
    }
  }

  /** Cancel this conversation and all ordinary work owned by it. */
  async abort(): Promise<void> {
    if (this.conversation && !this.closed) {
      await this.conversation.abort(BACKGROUND_CONTEXT)
    }
  }

  /** Flush storage and release actual upstream services exactly once. */
  dispose(): Promise<void> {
    this.closed ??= (async () => {
      try {
        if (this.harness) {
          await this.harness.close(BACKGROUND_CONTEXT)
        }
      } finally {
        if (this.events) {
          await this.events.stop()
        }
        await this.pluginEvent({ type: 'session_shutdown', reason: 'quit' })
        this.bus.removeAllListeners()
        this.listeners.clear()
      }
    })()
    return this.closed
  }
}
