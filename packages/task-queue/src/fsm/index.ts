/**
 * TaskFSM — the only allowed mutator of `task.status`.
 *
 * The transition table mirrors docs/vidbee-task-queue-state-machine-design.md §3.1
 * one-for-one. Any combination not listed below MUST throw IllegalTransitionError;
 * adapters must NOT define new transitions.
 */
import type { ClassifiedError, Task, TaskOutput, TaskStatus } from '../types'
import { TERMINAL_STATUSES } from '../types'

export type TransitionTrigger =
  | 'dispatch'
  | 'pause'
  | 'cancel'
  | 'progressing'
  | 'finalize-success'
  | 'finalize-error'
  | 'retry-tick'
  | 'resume'
  | 'fail'
  | 'retry-manual'
  | 'requeue'
  | 'crash-recovery'

export interface TransitionContext {
  trigger: TransitionTrigger
  reason?: string | null
  /** Required when trigger=finalize-success. */
  output?: TaskOutput
  /** Required when trigger=finalize-error or fail. */
  error?: ClassifiedError
  /** Required when trigger=finalize-error and we want retry-scheduled. */
  nextRetryAt?: number
  /** Stamp used for `enteredStatusAt`/`updatedAt`. Defaults to Date.now(). */
  now?: number
}

export class IllegalTransitionError extends Error {
  readonly from: TaskStatus
  readonly to: TaskStatus
  readonly reason: string | undefined
  constructor(from: TaskStatus, to: TaskStatus, reason?: string) {
    super(
      `IllegalTransition: ${from} -> ${to}${reason ? ` (${reason})` : ''}`
    )
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
    this.reason = reason
  }
}

/**
 * Static legality table — enumerates every From→To combination listed in §3.1.
 * Keys are From, values are the set of legal To statuses. Anything not present
 * MUST be rejected.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  queued: new Set<TaskStatus>(['running', 'paused', 'cancelled']),
  running: new Set<TaskStatus>([
    'processing',
    'completed',
    'retry-scheduled',
    'failed',
    'paused',
    'cancelled'
  ]),
  processing: new Set<TaskStatus>([
    'completed',
    'retry-scheduled',
    'failed',
    'paused',
    'cancelled'
  ]),
  paused: new Set<TaskStatus>(['queued', 'cancelled', 'failed']),
  'retry-scheduled': new Set<TaskStatus>(['queued', 'paused', 'cancelled']),
  failed: new Set<TaskStatus>(['queued']),
  cancelled: new Set<TaskStatus>(['queued']),
  completed: new Set<TaskStatus>()
}

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.has(to) ?? false
}

/**
 * Apply a transition and return the next Task value. Pure: callers (Scheduler,
 * Executor, RetryScheduler) feed in the current Task and receive a new one;
 * persistence and event emission live in the orchestrator.
 *
 * Throws IllegalTransitionError on anything outside §3.1's table.
 */
export function transition(
  task: Readonly<Task>,
  to: TaskStatus,
  ctx: TransitionContext
): Task {
  const from = task.status
  if (TERMINAL_STATUSES.has(from) && from !== to) {
    // `completed` has no outgoing edges at all; failed/cancelled only allow
    // user-initiated requeue/retry which IS in the table — fall through to the
    // legality check, which rejects everything else.
  }
  if (!isLegalTransition(from, to)) {
    throw new IllegalTransitionError(from, to, ctx.trigger)
  }

  const now = ctx.now ?? Date.now()
  const next: Task = {
    ...task,
    prevStatus: from,
    status: to,
    statusReason: ctx.reason ?? null,
    enteredStatusAt: now,
    updatedAt: now
  }

  switch (to) {
    case 'running':
      next.input = {
        ...task.input,
        options: { ...task.input.options, startedAt: task.input.options?.startedAt ?? now }
      }
      // attempt is incremented when we leave retry-scheduled (see retry-tick path);
      // here we only handle the initial dispatch from `queued`. The orchestrator
      // is responsible for stamping pid/pidStartedAt on the spawn callback.
      if (from === 'queued' && task.attempt === 0) {
        next.attempt = 1
      }
      break
    case 'queued':
      if (TERMINAL_STATUSES.has(from)) {
        next.input = {
          ...task.input,
          options: { ...task.input.options, completedAt: undefined }
        }
      }
      if (ctx.trigger === 'retry-tick') {
        next.attempt = task.attempt + 1
        next.nextRetryAt = null
      } else if (ctx.trigger === 'retry-manual') {
        next.attempt = 0
        next.lastError = null
        next.nextRetryAt = null
      } else if (ctx.trigger === 'requeue') {
        next.lastError = null
        next.nextRetryAt = null
      } else if (ctx.trigger === 'resume') {
        // resume from paused: keep progress, do not bump attempt
        next.nextRetryAt = null
      }
      break
    case 'completed': {
      if (!ctx.output) {
        throw new IllegalTransitionError(
          from,
          to,
          'finalize-success requires output'
        )
      }
      // Hard guard from §3.1: completed only legal when file exists with size > 0.
      // Existence is the orchestrator's job (FS check); size is checked here.
      if (ctx.output.size <= 0) {
        throw new IllegalTransitionError(
          from,
          to,
          'completed requires output.size > 0'
        )
      }
      next.output = ctx.output
      next.lastError = null
      next.pid = null
      next.pidStartedAt = null
      break
    }
    case 'failed': {
      if (ctx.error) next.lastError = ctx.error
      next.pid = null
      next.pidStartedAt = null
      break
    }
    case 'cancelled': {
      next.pid = null
      next.pidStartedAt = null
      break
    }
    case 'retry-scheduled': {
      if (ctx.nextRetryAt == null || ctx.nextRetryAt <= 0) {
        throw new IllegalTransitionError(
          from,
          to,
          'retry-scheduled requires nextRetryAt'
        )
      }
      if (ctx.error) next.lastError = ctx.error
      next.nextRetryAt = ctx.nextRetryAt
      next.pid = null
      next.pidStartedAt = null
      break
    }
    case 'paused': {
      // progress is preserved; pid is cleared because the process is gone
      // (SIGTERM on the running path, or never spawned on the queued path).
      next.pid = null
      next.pidStartedAt = null
      break
    }
    case 'processing':
      // running -> processing — pid stays bound to the same yt-dlp child.
      break
  }

  return next
}
