import type { AgentRunEvent } from '@shared/agent-chat'
import { AI_PROMPT_TEST_DOWNLOAD_ID, type AiPromptRunSnapshot } from '@shared/ai-types'

type ValueKind = 'download' | 'transcript' | 'ai'
type TaskState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'no-speech'
  | 'retry-scheduled'
type Properties = Record<string, string | number>
type EventSink = (name: string, properties: Properties) => unknown
interface ObservedTask {
  state: TaskState
  startedAt?: number
}
const MAX_TRACKED_TASKS = 1000

/** Reduce provenance to a fixed taxonomy; missing provenance is never guessed to be manual. */
export function desktopTaskOrigin(origin: unknown): string {
  return ['manual', 'subscription', 'agent', 'automatic'].includes(String(origin))
    ? String(origin)
    : 'unknown'
}

/** Observe live task transitions only; task IDs and private content never enter analytics payloads. */
export function createDesktopValueTracker(send: EventSink, now: () => number = Date.now) {
  const states = new Map<string, ObservedTask>()

  /** Deduplicate terminal snapshots and count only observed attempts in outcome-rate diagnostics. */
  function observe(
    kind: ValueKind,
    id: string,
    state: TaskState,
    properties: Properties = {}
  ): void {
    if (!id) {
      return
    }
    const key = `${kind}:${id}`
    const previous = states.get(key)
    const terminal = (value: TaskState): boolean =>
      ['completed', 'failed', 'cancelled', 'no-speech'].includes(value)
    if (previous?.state === state || (previous && terminal(previous.state) && terminal(state))) {
      return
    }
    if (kind !== 'download' && !previous && state === 'completed') {
      return
    }
    const startedAt =
      state === 'running' && previous?.state !== 'running'
        ? now()
        : state === 'queued' && previous && terminal(previous.state)
          ? undefined
          : previous?.startedAt
    states.delete(key)
    states.set(key, { state, startedAt })
    if (states.size > MAX_TRACKED_TASKS) {
      const oldest = states.keys().next().value
      if (oldest) {
        states.delete(oldest)
      }
    }
    const context = { ...properties, task_origin: desktopTaskOrigin(properties.task_origin) }
    if (state === 'running') {
      send(`desktop_${kind}_started`, context)
    } else if (terminal(state)) {
      const outcome =
        state === 'completed' ? 'success' : state === 'cancelled' ? 'cancelled' : 'failed'
      const errorCode =
        state === 'no-speech' ? 'no_speech' : String(properties.error_code ?? 'unknown')
      const result = outcome === 'failed' ? { ...context, error_code: errorCode } : context
      send(`desktop_${kind}_${outcome === 'success' ? 'completed' : outcome}`, result)
      if (startedAt !== undefined) {
        send('desktop_task_outcome', {
          ...result,
          value_kind: kind,
          outcome,
          duration_ms: Math.max(0, now() - startedAt)
        })
      }
      if (state === 'completed') {
        send('desktop_value_delivered', { ...context, value_kind: kind })
      }
    }
  }

  return {
    /** Observe downloader lifecycle IPC, without replaying the history list. */
    download(id: string, state: TaskState, origin?: unknown): void {
      observe('download', id, state, { task_origin: desktopTaskOrigin(origin) })
    },
    /** Count transcript work after a live preparatory state; exclude speaker-only edits. */
    transcript(snapshot: {
      downloadTaskId: string
      listState: string
      sourceKind?: string | null
      rediarize?: boolean
      creation?: { origin?: unknown }
    }): void {
      if (snapshot.rediarize) {
        return
      }
      const state = snapshot.listState
      if (
        ![
          'queued',
          'running',
          'completed',
          'failed',
          'cancelled',
          'no-speech',
          'retry-scheduled'
        ].includes(state)
      ) {
        return
      }
      const source =
        snapshot.sourceKind === 'asr' || snapshot.sourceKind === 'captions'
          ? snapshot.sourceKind
          : 'unknown'
      observe('transcript', snapshot.downloadTaskId, state as TaskState, {
        source_kind: source,
        task_origin: desktopTaskOrigin(snapshot.creation?.origin)
      })
    },
    /** Observe legacy one-shot prompts for either provider; empty answers never deliver value. */
    prompt(snapshot: AiPromptRunSnapshot): void {
      if (
        !(snapshot?.downloadId && snapshot.promptId) ||
        snapshot.downloadId === AI_PROMPT_TEST_DOWNLOAD_ID
      ) {
        return
      }
      const state =
        snapshot.status === 'error'
          ? 'failed'
          : snapshot.status === 'aborted'
            ? 'cancelled'
            : snapshot.status
      if (!['running', 'completed', 'failed', 'cancelled'].includes(state)) {
        return
      }
      const empty = state === 'completed' && !snapshot.text?.trim()
      observe(
        'ai',
        `prompt:${snapshot.downloadId}:${snapshot.promptId}`,
        empty ? 'failed' : (state as TaskState),
        {
          ai_mode: 'prompt',
          task_origin: 'manual',
          provider_type:
            snapshot.providerType === 'cloud' || snapshot.providerType === 'byok'
              ? snapshot.providerType
              : 'unknown',
          ...(empty ? { error_code: 'empty_output' } : {})
        }
      )
    },
    /** Accept only live run boundaries carrying Main's ephemeral provenance; history repairs are ignored. */
    agent(event: AgentRunEvent): void {
      if (!(event?.runId && event.analytics)) {
        return
      }
      const state = (
        {
          'run.started': 'running',
          'run.completed': 'completed',
          'run.error': 'failed',
          'run.aborted': 'cancelled',
          'run.interrupted': 'failed'
        } as const
      )[event.type]
      if (!state) {
        return
      }
      const messages = event.snapshot?.messages ?? event.patch?.messages ?? []
      const hasOutput = messages.some(
        (message) =>
          message.runId === event.runId && message.role === 'assistant' && message.text?.trim()
      )
      const empty = state === 'completed' && !hasOutput
      observe('ai', `agent:${event.runId}`, empty ? 'failed' : state, {
        ai_mode: 'chat',
        task_origin: desktopTaskOrigin(event.analytics.taskOrigin),
        provider_type:
          event.analytics.providerType === 'cloud' || event.analytics.providerType === 'byok'
            ? event.analytics.providerType
            : 'unknown',
        ...(empty ? { error_code: 'empty_output' } : {})
      })
    }
  }
}
