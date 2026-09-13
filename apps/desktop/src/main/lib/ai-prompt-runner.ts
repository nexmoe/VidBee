import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core'
import {
  type Api,
  clampThinkingLevel,
  contentText,
  type FetchFunction,
  type Model,
  type ModelThinkingLevel
} from '@earendil-works/pi-ai'
import { stream, streamSimple } from '@earendil-works/pi-ai/compat'
import { BrowserWindow } from 'electron'
import { aiProviderNeedsApiKey } from '../../shared/ai-presets'
import { resolveAiPromptContent } from '../../shared/ai-prompts'
import {
  AI_PROMPT_RECOVERY_DELAYS_MS,
  classifyAiPromptError,
  flattenErrorMessage,
  formatAiPromptError,
  idlePromptRunSnapshot,
  isRecoverableAiPromptError
} from '../../shared/ai-run'
import type {
  AiPromptErrorCode,
  AiPromptRunInput,
  AiPromptRunSnapshot
} from '../../shared/ai-types'
import { scopedLoggers } from '../utils/logger'
import { createVidbeeCloudModel, resolvePiModel } from './ai-model'
import { loadPersistedPromptRun, savePersistedPromptRun } from './ai-prompt-store'
import { aiStore } from './ai-store'

const log = scopedLoggers.ai
const PROMPT_RUN_CHANNEL = 'ai:prompt-run'
const STREAM_FLUSH_MS = 50
/** OpenAI SDK needs a base URL; Cookie-authenticated Cloud HTTP still uses getDesktopAuthApiUrl(). */
const VIDBEE_CLOUD_MODEL_ORIGIN = 'https://api.vidbee.org'
const SYSTEM_PROMPT = [
  "You are VidBee's transcript assistant. Follow the instruction exactly.",
  'Reply in Markdown. Use the same language as the transcript unless the instruction says otherwise.',
  'Keep each list marker on the same line as the item text.',
  'Do not wrap the whole reply in a code fence unless the instruction asks for a mermaid diagram. Do not add a preamble or closing remarks.'
].join(' ')

/**
 * True when a fetch or SDK throw is an abort, not a Cloud outage.
 *
 * @param error Thrown value from fetch or pi-agent.
 */
const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }
  const name = 'name' in error ? String(error.name) : ''
  return name === 'AbortError'
}

export interface PromptAgentCreateInput {
  apiKey: string
  fetch?: FetchFunction
  model: Model<Api>
  systemPrompt: string
  thinkingLevel?: ModelThinkingLevel
}

export interface PromptAgentLike {
  abort: () => void
  prompt: (text: string) => Promise<void>
  recover?: (transcript: string, partialText: string) => Promise<void>
  subscribe: (listener: (event: AgentEvent) => void) => () => void
}

export interface PromptRunDeps {
  createAgent: (input: PromptAgentCreateInput) => PromptAgentLike
  getActiveProvider: () => ReturnType<typeof aiStore.getActiveProviderSecret>
  getPrompt: (id: string) => ReturnType<typeof aiStore.getPrompt>
  managedCancel?: (input: { requestId: string; signal: AbortSignal }) => Promise<void>
  managedRequest?: (input: {
    downloadId?: string
    forceRegenerate?: boolean
    instruction: string
    messages?: unknown
    generation?: unknown
    requestId: string
    signal: AbortSignal
    sourceUrl?: string
    transcriptLanguage?: string
    transcriptOrigin?: 'ai' | 'human'
    transcriptText: string
    uiLanguage: string
  }) => Promise<Response>
  now: () => number
  broadcast: (snapshot: AiPromptRunSnapshot) => void
}

interface ActiveRun {
  agent: PromptAgentLike
  abortCompletion?: () => Promise<void>
  snapshot: AiPromptRunSnapshot
  unsubscribe: () => void
  lastBroadcastAt: number
  broadcast: (snapshot: AiPromptRunSnapshot) => void
  discarded: boolean
  viaCloud?: boolean
}

const runs = new Map<string, ActiveRun>()

/**
 * Build the map key for a prompt run so leaving a page does not lose the stream.
 *
 * @param downloadId Download or settings-test id.
 * @param promptId Prompt id.
 */
export const promptRunKey = (downloadId: string, promptId: string): string =>
  `${downloadId}::${promptId}`

export { idlePromptRunSnapshot }

const noopAgent: PromptAgentLike = {
  abort: () => undefined,
  prompt: async () => undefined,
  subscribe: () => () => undefined
}

const SUCCESS_STOP_REASONS = new Set(['stop', 'end_turn', 'toolUse', 'tool_use'])

/**
 * Pull visible answer text out of an assistant message. Thinking is separate.
 *
 * @param message Agent message from a stream event.
 */
export const assistantTextFromMessage = (message: AgentMessage, trim = true): string => {
  if (message.role !== 'assistant') {
    return ''
  }
  const content = message.content as unknown
  if (typeof content === 'string') {
    return trim ? content.trim() : content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const text = contentText(content)
  return trim ? text.trim() : text
}

/**
 * Pull reasoning blocks out of an assistant message for ThinkingSteps.
 *
 * @param message Agent message from a stream event.
 */
export const assistantThinkingFromMessage = (message: AgentMessage): string => {
  if (message.role !== 'assistant') {
    return ''
  }
  const content = message.content
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((block) => {
      const record = block as { type?: string; thinking?: string }
      if (record.type === 'thinking' && record.thinking) {
        return record.thinking
      }
      return ''
    })
    .filter((part) => part.length > 0)
    .join('\n')
    .trim()
}

/**
 * Advance the reasoning clock, which stops once visible answer text arrives.
 *
 * A model that streams nothing before its final message reports no reasoning
 * window at all, so that case falls back to the whole run duration.
 *
 * @param previous Milliseconds recorded so far.
 * @param elapsed Milliseconds since the run started.
 * @param thinking Reasoning text received so far.
 * @param text Visible answer text received so far.
 */
export const thinkingElapsedMs = (
  previous: number,
  elapsed: number,
  thinking: string,
  text: string
): number => {
  if (!thinking.trim()) {
    return previous
  }
  if (previous === 0 || !text.trim()) {
    return elapsed
  }
  return previous
}

/**
 * Read a real provider failure from an assistant message.
 *
 * Normal completions use stopReason "stop". That is not an error.
 *
 * @param message Agent message from a stream event.
 */
export const assistantErrorFromMessage = (message: AgentMessage): string | null => {
  if (message.role !== 'assistant') {
    return null
  }
  const record = message as {
    diagnostics?: Array<{
      error?: { message?: string; code?: string | number }
      details?: Record<string, unknown>
    }>
    errorMessage?: unknown
    rawStopReason?: unknown
    stopReason?: unknown
  }
  const stopReason = typeof record.stopReason === 'string' ? record.stopReason : ''
  const rawStopReason = typeof record.rawStopReason === 'string' ? record.rawStopReason.trim() : ''
  const parts: string[] = []
  if (typeof record.errorMessage === 'string' && record.errorMessage.trim()) {
    parts.push(record.errorMessage.trim())
  }
  if (Array.isArray(record.diagnostics)) {
    for (const item of record.diagnostics) {
      if (item.error?.message) {
        parts.push(item.error.message)
      }
      const status = item.details?.status ?? item.details?.statusCode
      if (status !== undefined) {
        parts.push(`HTTP ${String(status)}`)
      }
      const body = item.details?.body ?? item.details?.response ?? item.details?.data
      if (typeof body === 'string' && body.trim()) {
        parts.push(body.trim().slice(0, 500))
      } else if (body && typeof body === 'object') {
        parts.push(JSON.stringify(body).slice(0, 500))
      }
    }
  }
  if (parts.length > 0) {
    return [...new Set(parts)].join('\n')
  }
  if (stopReason === 'length' || rawStopReason === 'length') {
    return 'The AI response reached its output limit before completion.'
  }
  if (SUCCESS_STOP_REASONS.has(stopReason) || SUCCESS_STOP_REASONS.has(rawStopReason)) {
    return null
  }
  if (stopReason === 'error' || stopReason === 'aborted') {
    return rawStopReason && !SUCCESS_STOP_REASONS.has(rawStopReason)
      ? rawStopReason
      : 'The model request failed'
  }
  return null
}

/**
 * Build a failed run snapshot and remember it so remounts keep the guidance.
 *
 * @param input Download and prompt ids.
 * @param error Human-readable failure.
 * @param errorCode Guidance code.
 * @param now Timestamp.
 * @param broadcast Renderer fan-out.
 */
const failRun = (
  input: { downloadId: string; promptId: string },
  error: string,
  errorCode: AiPromptErrorCode,
  now: number,
  broadcast: (snapshot: AiPromptRunSnapshot) => void
): AiPromptRunSnapshot => {
  const snapshot: AiPromptRunSnapshot = {
    downloadId: input.downloadId,
    promptId: input.promptId,
    status: 'error',
    text: '',
    thinking: '',
    thinkingMs: 0,
    error,
    errorCode,
    updatedAt: now
  }
  const previous = runs.get(promptRunKey(input.downloadId, input.promptId))
  previous?.unsubscribe()
  runs.set(promptRunKey(input.downloadId, input.promptId), {
    agent: noopAgent,
    snapshot,
    unsubscribe: () => undefined,
    lastBroadcastAt: now,
    broadcast,
    discarded: false
  })
  savePersistedPromptRun(snapshot)
  broadcast(snapshot)
  log.warn('ai prompt run failed', {
    downloadId: input.downloadId,
    promptId: input.promptId,
    error,
    errorCode
  })
  return snapshot
}

/**
 * Send a run snapshot to every renderer window.
 *
 * @param snapshot Latest run state.
 */
const broadcastPromptRun = (snapshot: AiPromptRunSnapshot): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(PROMPT_RUN_CHANNEL, snapshot)
    }
  }
}

/**
 * Create a pi-agent bound to one model, used for both local providers and Cloud.
 *
 * @param input Model, API key, and optional Cloud fetch interceptor.
 */
export const createPiPromptAgent = (input: PromptAgentCreateInput): PromptAgentLike => {
  const agent = new Agent({
    streamFn: (model, context, options) =>
      (model.id === 'vidbee-cloud' ? stream : streamSimple)(model, context, {
        ...options,
        maxRetries: 0,
        fetch: input.fetch
      }),
    getApiKey: () => input.apiKey || undefined,
    initialState: {
      systemPrompt: input.systemPrompt,
      model: input.model,
      thinkingLevel: input.thinkingLevel ?? 'off',
      tools: [],
      messages: []
    }
  })
  return {
    abort: () => agent.abort(),
    prompt: (text) => agent.prompt(text),
    /** Rebuild a text-only context so failed provider messages cannot be dropped or replayed. */
    recover: (transcript, partialText) => {
      agent.state.messages = []
      return agent.prompt(
        partialText
          ? [
              transcript,
              'The previous response was interrupted. The JSON string below contains the exact answer already delivered:',
              JSON.stringify(partialText),
              'Continue exactly after its final character. Output only the missing continuation; do not repeat any delivered text, add an introduction, or restart the answer. Preserve unfinished sentences, lists, and code fences. Follow the original instruction.'
            ].join('\n\n')
          : transcript
      )
    },
    subscribe: (listener) => agent.subscribe(listener)
  }
}

const defaultDeps: PromptRunDeps = {
  createAgent: createPiPromptAgent,
  getActiveProvider: () => aiStore.getActiveProviderSecret(),
  getPrompt: (id) => aiStore.getPrompt(id),
  managedCancel: async (input) => {
    const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
    const response = await fetch(`${getDesktopAuthApiUrl()}/api/ai/prompt/cancel`, {
      body: JSON.stringify({ requestId: input.requestId }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: authClient.getCookie()
      },
      method: 'POST',
      signal: input.signal
    })
    if (!response.ok) {
      throw new Error(`VidBee Cloud cancellation failed with HTTP ${response.status}`)
    }
  },
  managedRequest: async (input) => {
    const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
    const url = `${getDesktopAuthApiUrl()}/api/ai/chat/completions`
    try {
      const { signCloudRequest } = await import('./cloud-device')
      const { buildCloudSubtitleEvidence } = await import('./cloud-subtitle-evidence')
      const body: Record<string, unknown> = {
        forceRegenerate: input.forceRegenerate === true,
        instruction: input.instruction,
        messages: input.messages,
        generation: input.generation,
        requestId: input.requestId,
        sourceUrl: input.sourceUrl,
        transcriptLanguage: input.transcriptLanguage,
        transcriptOrigin: input.transcriptOrigin,
        transcriptText: input.transcriptText,
        uiLanguage: input.uiLanguage,
        evidence: input.downloadId
          ? buildCloudSubtitleEvidence(input.downloadId, input.transcriptText)
          : undefined
      }
      let signed = body
      try {
        signed = await signCloudRequest(body)
      } catch {
        /* Personal generation remains available without device credentials. */
      }
      return await fetch(url, {
        body: JSON.stringify(signed),
        headers: {
          'Content-Type': 'application/json',
          Cookie: authClient.getCookie()
        },
        method: 'POST',
        signal: input.signal
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      const detail = flattenErrorMessage(error)
      throw Object.assign(
        new Error(
          detail
            ? `Could not reach VidBee Cloud (${url}): ${detail}`
            : `Could not reach VidBee Cloud (${url}).`
        ),
        { errorCode: 'network' as const }
      )
    }
  },
  now: () => Date.now(),
  broadcast: broadcastPromptRun
}

/**
 * Remember a restored snapshot in the in-memory map so later reads stay in process.
 *
 * @param snapshot Terminal result loaded from SQLite.
 */
const hydratePersistedRun = (snapshot: AiPromptRunSnapshot): void => {
  runs.set(promptRunKey(snapshot.downloadId, snapshot.promptId), {
    agent: noopAgent,
    snapshot,
    unsubscribe: () => undefined,
    lastBroadcastAt: snapshot.updatedAt,
    broadcast: broadcastPromptRun,
    discarded: false
  })
}

/**
 * Return the live snapshot, then the last SQLite result, then idle.
 *
 * @param downloadId Download or settings-test id.
 * @param promptId Prompt id.
 */
export const getPromptRunSnapshot = (downloadId: string, promptId: string): AiPromptRunSnapshot => {
  const live = runs.get(promptRunKey(downloadId, promptId))?.snapshot
  if (live) {
    return live
  }
  const persisted = loadPersistedPromptRun(downloadId, promptId)
  if (persisted) {
    const leakedThinking =
      Boolean(persisted.thinking?.trim()) && persisted.text.trim() === persisted.thinking.trim()
    const snapshot: AiPromptRunSnapshot = {
      ...persisted,
      ...(leakedThinking
        ? {
            text: '',
            status: 'error' as const,
            error: persisted.error || 'The model returned no answer text.',
            errorCode: persisted.errorCode || ('empty-output' as const)
          }
        : {}),
      thinking: persisted.thinking ?? '',
      thinkingMs: persisted.thinkingMs ?? 0
    }
    hydratePersistedRun(snapshot)
    return snapshot
  }
  return idlePromptRunSnapshot(downloadId, promptId)
}

/**
 * Stop an in-flight prompt. Navigating away does not call this.
 *
 * @param downloadId Download or settings-test id.
 * @param promptId Prompt id.
 */
export const stopPromptRun = (downloadId: string, promptId: string): AiPromptRunSnapshot => {
  const run = runs.get(promptRunKey(downloadId, promptId))
  if (run?.snapshot.status !== 'running') {
    return run?.snapshot ?? idlePromptRunSnapshot(downloadId, promptId)
  }
  run.agent.abort()
  run.snapshot = {
    ...run.snapshot,
    status: 'aborted',
    recovery: undefined,
    updatedAt: Date.now()
  }
  savePersistedPromptRun(run.snapshot)
  run.broadcast(run.snapshot)
  return run.snapshot
}

/**
 * Abort in-flight prompt runs for a download without writing a new result.
 * Used when the parent download is removed so a finishing stream cannot
 * resurrect stored prompt rows.
 *
 * @param downloadId Parent download id.
 */
export const stopPromptRunsForDownload = (downloadId: string): void => {
  for (const [key, run] of runs) {
    if (run.snapshot.downloadId !== downloadId) {
      continue
    }
    run.discarded = true
    runs.delete(key)
    if (run.snapshot.status === 'running') {
      run.agent.abort()
      run.unsubscribe()
    }
  }
}

/** Abort every active prompt before the Desktop process exits. */
export const stopAllPromptRuns = async (): Promise<void> => {
  const pendingAborts: Promise<void>[] = []
  for (const run of runs.values()) {
    run.discarded = true
    if (run.snapshot.status === 'running') {
      run.agent.abort()
      if (run.abortCompletion) {
        pendingAborts.push(run.abortCompletion())
      }
    }
    run.unsubscribe()
  }
  runs.clear()
  await Promise.allSettled(pendingAborts)
}

/** Clear in-memory prompt runs between isolated internal test cases. */
export const resetPromptRunsForTests = (): void => {
  for (const run of runs.values()) {
    run.discarded = true
    if (run.snapshot.status === 'running') {
      run.agent.abort()
    }
    run.unsubscribe()
  }
  runs.clear()
}

/** Read a JSON object from an OpenAI SDK request body. */
const readJsonBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'string' || !body.trim()) {
    return {}
  }
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Map a managed API response to stable renderer guidance. */
const managedPromptErrorCode = (status: number, code?: string): AiPromptErrorCode => {
  if (status === 401 || code === 'UNAUTHORIZED') {
    return 'sign-in-required'
  }
  if (status === 402 || code === 'AI_CREDIT_QUOTA_EXCEEDED') {
    return 'credits-exhausted'
  }
  return 'network'
}

/** Read a sanitized managed API error without trusting its response shape. */
const readManagedPromptError = async (
  response: Response
): Promise<{ code?: string; error?: string } | null> => {
  try {
    return (await response.json()) as { code?: string; error?: string }
  } catch {
    return null
  }
}

/**
 * Build an HTTP error the OpenAI client can parse. Throws are collapsed to
 * "Connection error." and hide Cloud 401/402 and the real transport cause.
 *
 * @param detail Flattened fetch or runner error.
 */
const cloudNetworkResponse = (detail: string): Response =>
  new Response(
    JSON.stringify({ code: 'network', error: detail || 'Could not reach VidBee Cloud.' }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 424
    }
  )

/**
 * Subscribe to a pi-agent run and broadcast snapshots until it settles.
 *
 * @param input Download and prompt ids.
 * @param transcriptText User prompt sent to the agent.
 * @param agent Live pi-agent, possibly wrapping Cloud cancellation.
 * @param deps Test doubles and fan-out.
 * @param abortCompletion Optional Cloud cancel that must finish before shutdown.
 * @param viaCloud True when this run uses VidBee Cloud instead of a local key.
 */
const startAgentPromptRun = (
  input: AiPromptRunInput,
  transcriptText: string,
  agent: PromptAgentLike,
  deps: PromptRunDeps,
  abortCompletion?: () => Promise<void>,
  viaCloud = false
): AiPromptRunSnapshot => {
  const key = promptRunKey(input.downloadId, input.promptId)
  const previous = runs.get(key)
  if (previous?.snapshot.status === 'running') {
    previous.discarded = true
    previous.agent.abort()
    previous.unsubscribe()
  }
  const startedAt = deps.now()
  const snapshot: AiPromptRunSnapshot = {
    downloadId: input.downloadId,
    promptId: input.promptId,
    status: 'running',
    text: '',
    thinking: '',
    thinkingMs: 0,
    error: null,
    errorCode: null,
    updatedAt: startedAt
  }
  const run: ActiveRun = {
    agent,
    abortCompletion,
    snapshot,
    unsubscribe: () => undefined,
    lastBroadcastAt: 0,
    broadcast: deps.broadcast,
    discarded: false,
    viaCloud
  }

  /**
   * Push a snapshot to renderers, throttling token deltas.
   *
   * @param next Latest snapshot.
   * @param force Skip the throttle window.
   */
  const emit = (next: AiPromptRunSnapshot, force: boolean): void => {
    run.snapshot = next
    if (next.status !== 'running') {
      savePersistedPromptRun(next)
    }
    const now = deps.now()
    if (!force && now - run.lastBroadcastAt < STREAM_FLUSH_MS) {
      return
    }
    run.lastBroadcastAt = now
    deps.broadcast(next)
  }

  let prefix = ''
  let generatedText = ''
  let thinkingPrefix = ''
  let receivedText = false
  let lastError: string | null = null
  let lastAssistant: AgentMessage | null = null
  run.unsubscribe = agent.subscribe((event) => {
    if (run.discarded || run.snapshot.status !== 'running') {
      return
    }
    if (
      (event.type === 'message_update' ||
        event.type === 'message_end' ||
        event.type === 'turn_end') &&
      event.message.role === 'assistant'
    ) {
      lastAssistant = event.message
      lastError = assistantErrorFromMessage(event.message) ?? lastError
    }
    if (
      (event.type === 'message_update' || event.type === 'message_end') &&
      event.message.role === 'assistant'
    ) {
      const messageText = assistantTextFromMessage(event.message, false)
      receivedText ||= Boolean(messageText.trim())
      const candidate = prefix + messageText
      if (messageText.trim() && candidate.length >= generatedText.length) {
        generatedText = candidate
      }
      const messageThinking = assistantThinkingFromMessage(event.message)
      const thinking = messageThinking ? thinkingPrefix + messageThinking : run.snapshot.thinking
      const text = generatedText || run.snapshot.text
      const now = deps.now()
      emit(
        {
          ...run.snapshot,
          text,
          recovery: messageText.trim() || messageThinking ? undefined : run.snapshot.recovery,
          thinking,
          thinkingMs: thinkingElapsedMs(
            run.snapshot.thinkingMs,
            now - startedAt,
            thinking,
            generatedText
          ),
          updatedAt: now
        },
        event.type === 'message_end'
      )
    }
  })

  runs.set(key, run)
  deps.broadcast(snapshot)
  log.info('ai prompt run started', { downloadId: input.downloadId, promptId: input.promptId })

  /** Retry transient failures with the original transcript and every delivered character. */
  const executePrompt = async (): Promise<void> => {
    try {
      for (let attempt = 0; attempt <= AI_PROMPT_RECOVERY_DELAYS_MS.length; attempt++) {
        let failure: unknown = null
        receivedText = false
        lastError = null
        lastAssistant = null
        try {
          if (attempt === 0) {
            await agent.prompt(transcriptText)
          } else {
            await agent.recover?.(transcriptText, prefix)
          }
        } catch (error) {
          failure = error
        }
        if (run.discarded || run.snapshot.status !== 'running') {
          return
        }
        const message =
          flattenErrorMessage(failure) ||
          lastError ||
          (receivedText ? '' : 'The model returned no text')
        if (!message) {
          emit(
            {
              ...run.snapshot,
              text: run.snapshot.text.trim(),
              status: 'completed',
              recovery: undefined,
              error: null,
              errorCode: null,
              updatedAt: deps.now()
            },
            true
          )
          log.info('ai prompt run completed', {
            downloadId: input.downloadId,
            promptId: input.promptId,
            attempts: attempt + 1
          })
          return
        }
        const retryDelayMs = AI_PROMPT_RECOVERY_DELAYS_MS[attempt]
        if (retryDelayMs !== undefined && agent.recover && isRecoverableAiPromptError(message)) {
          emit(
            {
              ...run.snapshot,
              recovery: {
                attempt: attempt + 1,
                maxAttempts: AI_PROMPT_RECOVERY_DELAYS_MS.length,
                error: formatAiPromptError(message, run.viaCloud)
              },
              updatedAt: deps.now()
            },
            true
          )
          prefix = generatedText
          thinkingPrefix = run.snapshot.thinking ? `${run.snapshot.thinking}\n\n` : ''
          log.info('ai prompt run recovering', {
            downloadId: input.downloadId,
            promptId: input.promptId,
            attempt: attempt + 1,
            maxAttempts: AI_PROMPT_RECOVERY_DELAYS_MS.length,
            retryDelayMs,
            error: formatAiPromptError(message, run.viaCloud),
            outputCharacters: prefix.length
          })
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
          if (run.discarded || run.snapshot.status !== 'running') {
            return
          }
          continue
        }
        const error = formatAiPromptError(message, run.viaCloud)
        const errorCode = classifyAiPromptError(message, !run.snapshot.text.trim())
        emit(
          {
            ...run.snapshot,
            recovery: undefined,
            status: 'error',
            error,
            errorCode,
            updatedAt: deps.now()
          },
          true
        )
        const assistant = lastAssistant as { stopReason?: unknown } | null
        log.warn('ai prompt run failed', {
          downloadId: input.downloadId,
          promptId: input.promptId,
          error,
          errorCode,
          stopReason: assistant?.stopReason,
          attempts: attempt + 1
        })
        return
      }
    } finally {
      run.unsubscribe()
    }
  }
  void executePrompt()

  return snapshot
}

/** Run one transcript prompt through VidBee Cloud via the same pi-agent path. */
const startManagedPromptRun = (
  input: AiPromptRunInput,
  instruction: string,
  deps: PromptRunDeps
): AiPromptRunSnapshot => {
  let abortController = new AbortController()
  let requestId = crypto.randomUUID()
  let stopped = false
  let continued = false
  let cancellationPromise: Promise<void> | null = null

  /** Notify VidBee Cloud before aborting the local response stream. */
  const cancelManagedRequest = (): void => {
    if (!cancellationPromise && deps.managedCancel) {
      const cancelController = new AbortController()
      const timeout = setTimeout(() => cancelController.abort(), 2000)
      cancellationPromise = deps
        .managedCancel({ requestId, signal: cancelController.signal })
        .catch((error: unknown) => {
          log.warn('managed ai prompt cancellation failed', {
            downloadId: input.downloadId,
            promptId: input.promptId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
        .finally(() => clearTimeout(timeout))
    }
    abortController.abort()
  }

  const managedRequest = deps.managedRequest ?? defaultDeps.managedRequest
  if (!managedRequest) {
    return failRun(input, 'VidBee Cloud is unavailable', 'network', deps.now(), deps.broadcast)
  }

  let deliveryId: string | null = null
  /** Report parsed cache content without sending transcript text or affecting the answer. */
  async function reportDelivery(completed: boolean): Promise<void> {
    const id = deliveryId
    deliveryId = null
    if (!id) {
      return
    }
    try {
      const { authClient, getDesktopAuthApiUrl } = await import('./auth-client')
      const text = runs.get(promptRunKey(input.downloadId, input.promptId))?.snapshot.text ?? ''
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(text))
      )
      await fetch(`${getDesktopAuthApiUrl()}/api/ai/cache/delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authClient.getCookie() },
        body: JSON.stringify({
          deliveryId: id,
          completed,
          digest: Buffer.from(digest).toString('hex')
        }),
        signal: AbortSignal.timeout(5000)
      })
    } catch {
      /* Missing receipts remain unknown; delivery evidence never blocks the answer. */
    }
  }

  /** Send Cloud extras alongside the OpenAI-compatible body pi-agent already built. */
  const fetchManaged: FetchFunction = async (_url, init) => {
    try {
      const openai = readJsonBody(init?.body)
      const response = await managedRequest({
        downloadId: input.downloadId,
        forceRegenerate: input.forceRegenerate,
        instruction,
        messages: openai.messages,
        generation: {
          max_tokens: openai.max_tokens,
          max_completion_tokens: openai.max_completion_tokens,
          reasoning_effort: openai.reasoning_effort,
          temperature: openai.temperature,
          top_p: openai.top_p
        },
        requestId,
        signal: (init?.signal as AbortSignal | undefined) ?? abortController.signal,
        sourceUrl: input.sourceUrl,
        transcriptLanguage: input.transcriptLanguage,
        transcriptOrigin: input.transcriptOrigin,
        transcriptText: input.transcriptText.trim(),
        uiLanguage: input.uiLanguage ?? 'en'
      })
      deliveryId = response.headers.get('X-VidBee-Delivery-Id')
      const cloudResultId = response.headers.get('X-VidBee-Result-Id')
      const active = runs.get(promptRunKey(input.downloadId, input.promptId))
      if (continued && active) {
        active.snapshot.cloudResultId = undefined
      }
      if (cloudResultId && active && !continued) {
        active.snapshot.cloudResultId = cloudResultId
      }
      if (!response.ok) {
        const payload = await readManagedPromptError(response.clone())
        log.warn('managed ai prompt rejected', {
          downloadId: input.downloadId,
          promptId: input.promptId,
          status: response.status,
          code: payload?.code,
          error: payload?.error,
          errorCode: managedPromptErrorCode(response.status, payload?.code)
        })
      }
      return response
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      const detail = flattenErrorMessage(error)
      const message = detail
        ? `Could not reach VidBee Cloud: ${detail}`
        : 'Could not reach VidBee Cloud.'
      log.warn('managed ai prompt fetch failed', {
        downloadId: input.downloadId,
        promptId: input.promptId,
        error: message
      })
      return cloudNetworkResponse(message)
    }
  }

  const model = createVidbeeCloudModel(VIDBEE_CLOUD_MODEL_ORIGIN)
  const inner = deps.createAgent({
    apiKey: 'vidbee-cloud',
    fetch: fetchManaged,
    model,
    systemPrompt: `${SYSTEM_PROMPT}\n\nInstruction:\n${instruction}`
  })
  const agent: PromptAgentLike = {
    abort: () => {
      stopped = true
      cancelManagedRequest()
      inner.abort()
      void reportDelivery(false)
    },
    prompt: async (text) => {
      try {
        await inner.prompt(text)
        const snapshot = runs.get(promptRunKey(input.downloadId, input.promptId))?.snapshot
        void reportDelivery(Boolean(snapshot?.text.trim()) && !snapshot?.error)
      } catch (error) {
        void reportDelivery(false)
        throw error
      }
    },
    recover: inner.recover
      ? async (transcript, partialText) => {
          cancelManagedRequest()
          await cancellationPromise
          if (stopped) {
            return
          }
          continued = Boolean(partialText.trim())
          requestId = crypto.randomUUID()
          abortController = new AbortController()
          cancellationPromise = null
          await inner.recover?.(transcript, partialText)
        }
      : undefined,
    subscribe: (listener) => inner.subscribe(listener)
  }
  return startAgentPromptRun(
    input,
    input.transcriptText.trim(),
    agent,
    deps,
    () => cancellationPromise ?? Promise.resolve(),
    true
  )
}

/**
 * Start a prompt against the active provider. The Agent lives in this module so
 * switching pages does not abort the stream.
 *
 * @param input Transcript text plus prompt and download ids.
 * @param deps Optional test doubles.
 */
export const startPromptRun = (
  input: AiPromptRunInput,
  deps: PromptRunDeps = defaultDeps
): AiPromptRunSnapshot => {
  const prompt = deps.getPrompt(input.promptId)
  if (!prompt) {
    return failRun(input, 'Unknown prompt', 'unknown-prompt', deps.now(), deps.broadcast)
  }
  const transcriptText = input.transcriptText.trim()
  if (!transcriptText) {
    return failRun(input, 'Transcript is empty', 'empty-transcript', deps.now(), deps.broadcast)
  }
  const active = deps.getActiveProvider()
  if (!active) {
    const instruction = resolveAiPromptContent(prompt.content, input.uiLanguage ?? 'en')
    return startManagedPromptRun(input, instruction, deps)
  }
  if (aiProviderNeedsApiKey(active.provider.presetId) && !active.apiKey) {
    return failRun(
      input,
      'The enabled provider is missing an API key',
      'missing-api-key',
      deps.now(),
      deps.broadcast
    )
  }
  if (!active.provider.modelId.trim()) {
    return failRun(
      input,
      'The enabled provider is missing a model id',
      'missing-model',
      deps.now(),
      deps.broadcast
    )
  }

  const model = resolvePiModel(active.provider)
  const instruction = resolveAiPromptContent(prompt.content, input.uiLanguage ?? 'en')
  const agent = deps.createAgent({
    apiKey: active.apiKey,
    model,
    systemPrompt: `${SYSTEM_PROMPT}\n\nInstruction:\n${instruction}`,
    thinkingLevel: clampThinkingLevel(model, 'max')
  })
  return startAgentPromptRun(input, transcriptText, agent, deps)
}
