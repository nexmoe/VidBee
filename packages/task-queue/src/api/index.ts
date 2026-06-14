/**
 * TaskQueueAPI — host-neutral orchestrator. The single object every adapter
 * (Desktop, Web/API, CLI) instantiates exactly once and forwards RPC calls
 * into. Concrete behavior:
 *
 *   - Owns the FSM, Scheduler, RetryScheduler, Watchdog, ProcessRegistry,
 *     EventBus and TaskStore.
 *   - Single writer to PersistAdapter.
 *   - Implements crash recovery on `start()` per design doc §11.
 *   - Provides `subscribe(listener)` so hosts can replicate events to IPC/SSE.
 *
 * Reference: docs/vidbee-task-queue-state-machine-design.md §3, §6, §7, §8, §11.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'

import { defaultMaxAttempts, virtualError } from '../classifier'
import {
  EventBus,
  type TaskQueueEvent,
  type TaskQueueListener
} from '../events'
import {
  IllegalTransitionError,
  transition as fsmTransition,
  type TransitionContext
} from '../fsm'
import type { Executor, ExecutorRun } from '../executor'
import type { PersistAdapter } from '../persist'
import { ProcessRegistry, Watchdog, readPidStartTime } from '../process'
import { RetryScheduler, Scheduler, computeBackoffMs } from '../scheduler'
import { TaskStore } from '../store'
import {
  EMPTY_PROGRESS,
  PRIORITY_USER,
  TERMINAL_STATUSES,
  type ClassifiedError,
  type Task,
  type TaskInput,
  type TaskOutput,
  type TaskPriority,
  type TaskProgress,
  type TaskQueueStats,
  type TaskStatus
} from '../types'

export interface TaskQueueAPIOptions {
  persist: PersistAdapter
  executor: Executor
  /** Defaults to 4 — the production default for desktop and web. */
  maxConcurrency?: number
  /** Default per-group cap. Null = unlimited. */
  defaultMaxPerGroup?: number | null
  /** Test seam; defaults to Date.now. */
  clock?: () => number
  /** Test seam for setTimeout (Watchdog + RetryScheduler). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /**
   * For `processing -> completed` we hard-guard `output.filePath` exists.
   * Test seam.
   */
  filePresent?: (path: string) => boolean
  /** Watchdog idle thresholds. */
  runningIdleMs?: number
  processingIdleMs?: number
  /** Random source for backoff jitter. Test seam. */
  rng?: () => number
  /** Process kill function for ProcessRegistry. Test seam. */
  killProcess?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
}

export interface AddTaskRequest {
  input: TaskInput
  priority?: TaskPriority
  groupKey?: string
  parentId?: string | null
  maxAttempts?: number
  /**
   * Optional caller-supplied identifier. When the host has already minted an
   * id (e.g. desktop renderer optimistic UI before the IPC round-trip) it
   * should be threaded through so the resulting `task.id` matches and the
   * caller does not see two separate rows in the list — the optimistic one
   * and the kernel-generated one. If omitted, a random UUID is generated.
   * Idempotency: re-adding with an existing id returns `{id}` without
   * re-creating the task.
   */
  id?: string
}

export interface ListOptions {
  status?: TaskStatus
  groupKey?: string
  parentId?: string
  limit?: number
  cursor?: string | null
}

interface ActiveRun {
  taskId: string
  attemptId: string
  run: ExecutorRun
}

const PROGRESS_DOWNSAMPLE_MS = 1_000

export class TaskQueueAPI {
  private readonly bus = new EventBus()
  private readonly store = new TaskStore()
  private readonly scheduler: Scheduler
  private readonly retry: RetryScheduler
  private readonly watchdog: Watchdog
  private readonly processes: ProcessRegistry
  private readonly persist: PersistAdapter
  private readonly executor: Executor
  private readonly clock: () => number
  private readonly filePresent: (p: string) => boolean
  private readonly rng: () => number
  private readonly active = new Map<string, ActiveRun>()
  private readonly progressLastWrite = new Map<string, number>()
  private readonly progressDirty = new Map<string, TaskProgress>()
  private started = false
  /** Tasks where pause() was invoked on Windows; onFinish should transition to paused, not cancelled. */
  private readonly pendingPause = new Set<string>()

  constructor(opts: TaskQueueAPIOptions) {
    this.persist = opts.persist
    this.executor = opts.executor
    this.clock = opts.clock ?? Date.now
    this.filePresent =
      opts.filePresent ??
      ((p) => {
        try {
          return existsSync(p) && statSync(p).size > 0
        } catch {
          return false
        }
      })
    this.rng = opts.rng ?? Math.random

    this.scheduler = new Scheduler({
      maxConcurrency: opts.maxConcurrency ?? 4,
      defaultMaxPerGroup: opts.defaultMaxPerGroup ?? null,
      dispatch: (id) => this.dispatchOne(id),
      demote: (id) => this.demoteOne(id),
      getTask: (id) => this.store.get(id)
    })

    this.retry = new RetryScheduler({
      clock: this.clock,
      setTimer: opts.setTimer,
      clearTimer: opts.clearTimer,
      onDue: (id) => this.handleRetryDue(id)
    })

    this.watchdog = new Watchdog((id) => this.handleStalled(id), {
      runningIdleMs: opts.runningIdleMs,
      processingIdleMs: opts.processingIdleMs,
      setTimer: opts.setTimer,
      clearTimer: opts.clearTimer,
      clock: this.clock
    })

    this.processes = new ProcessRegistry({
      persist: this.persist,
      clock: this.clock,
      kill: opts.killProcess
    })
  }

  // ───────────── Lifecycle ─────────────

  /**
   * Crash recovery + reconciliation. Per §11:
   *  1. load tasks from persistence
   *  2. reconcile process_journal: kill orphans, journal `killed`
   *  3. running/processing → paused('crash-recovery'); preserve progress
   *  4. queued → re-enqueue
   *  5. retry-scheduled → re-arm RetryScheduler with original nextRetryAt
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    const tasks = await this.persist.loadAllTasks()
    for (const t of tasks) this.store.insert(t)

    // Kill orphans and journal them.
    const orphans = await this.processes.reconcile()
    for (const o of orphans) {
      this.bus.emit({
        type: 'orphan-killed',
        taskId: o.taskId,
        pid: o.pid,
        pidStartedAt: null,
        signal: 'SIGKILL',
        at: this.clock()
      })
    }

    // Reclassify recovered task statuses.
    for (const t of tasks) {
      if (t.status === 'running' || t.status === 'processing') {
        await this.applyTransition(t.id, 'paused', {
          trigger: 'crash-recovery',
          reason: 'crash-recovery'
        })
      } else if (t.status === 'queued') {
        await this.scheduler.enqueue(t.id, t.priority)
      } else if (t.status === 'retry-scheduled' && t.nextRetryAt != null) {
        this.retry.enqueue(t.id, t.nextRetryAt)
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.retry.stop()
    // Cancel all active runs; let the executor reap.
    for (const a of [...this.active.values()]) {
      try {
        await a.run.cancel(0)
      } catch {
        /* noop */
      }
    }
    if (this.persist.close) await this.persist.close()
    this.started = false
  }

  // ───────────── RPC surface ─────────────

  async add(req: AddTaskRequest): Promise<{ id: string }> {
    const now = this.clock()
    // Honor caller-supplied id (optimistic UI correlation). Idempotent: if a
    // task with that id already exists, return it instead of double-adding.
    if (req.id) {
      const existing = this.store.get(req.id)
      if (existing) return { id: existing.id }
    }
    const id = req.id ?? randomUUID()
    const task: Task = {
      id,
      kind: req.input.kind,
      parentId: req.parentId ?? null,
      input: req.input,
      priority: req.priority ?? PRIORITY_USER,
      groupKey: req.groupKey ?? defaultGroupKey(req.input),
      status: 'queued',
      prevStatus: null,
      statusReason: null,
      enteredStatusAt: now,
      attempt: 0,
      maxAttempts: req.maxAttempts ?? 5,
      nextRetryAt: null,
      progress: { ...EMPTY_PROGRESS },
      output: null,
      lastError: null,
      pid: null,
      pidStartedAt: null,
      createdAt: now,
      updatedAt: now
    }
    this.store.insert(task)
    await this.persist.insertTask(task)
    this.bus.emit({
      type: 'transition',
      taskId: id,
      from: null,
      to: 'queued',
      reason: null,
      attempt: 0,
      at: now
    })
    this.bus.emit({
      type: 'snapshot-changed',
      taskId: id,
      task,
      at: now
    })
    await this.scheduler.enqueue(id, task.priority)
    return { id }
  }

  get(id: string): Readonly<Task> | undefined {
    return this.store.get(id)
  }

  list(opts: ListOptions = {}): { tasks: Task[]; nextCursor: string | null } {
    return this.store.list(opts)
  }

  async cancel(id: string, reason = 'user'): Promise<void> {
    const t = this.store.get(id)
    if (!t) return
    if (TERMINAL_STATUSES.has(t.status)) return
    if (t.status === 'queued' || t.status === 'paused') {
      await this.scheduler.dequeue(id)
      this.retry.remove(id)
      await this.applyTransition(id, 'cancelled', {
        trigger: 'cancel',
        reason
      })
      return
    }
    if (t.status === 'retry-scheduled') {
      this.retry.remove(id)
      await this.applyTransition(id, 'cancelled', {
        trigger: 'cancel',
        reason
      })
      return
    }
    // running/processing — issue cancel through the executor; the finish
    // event will drive the FSM transition. ProcessRegistry handles the
    // SIGTERM→SIGKILL grace period.
    const active = this.active.get(id)
    if (active) {
      try {
        await active.run.cancel()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[task-queue] cancel run threw', err)
      }
    }
    // The orchestrator transitions to `cancelled` from the onFinish callback
    // (executor reports `result.type === 'cancelled'`).
  }

  async pause(id: string, reason = 'user'): Promise<void> {
    const t = this.store.get(id)
    if (!t) return
    if (t.status === 'queued') {
      await this.scheduler.dequeue(id)
      await this.applyTransition(id, 'paused', { trigger: 'pause', reason })
      return
    }
    if (t.status === 'retry-scheduled') {
      this.retry.remove(id)
      await this.applyTransition(id, 'paused', { trigger: 'pause', reason })
      return
    }
    if (t.status === 'running' || t.status === 'processing') {
      const active = this.active.get(id)
      if (active) {
        if (process.platform === 'win32') {
          // Windows: pause() internally cancels the process. Mark this as a
          // pause-intent so handleFinish transitions to paused not cancelled.
          this.pendingPause.add(id)
          try {
            await active.run.pause()
          } catch (err) {
            this.pendingPause.delete(id)
            // eslint-disable-next-line no-console
            console.error('[task-queue] pause run threw', err)
          }
          // handleFinish will clear pendingPause and apply paused transition.
        } else {
          // Unix: SIGSTOP suspends the process in-place; onFinish will NOT fire.
          // We drive the FSM transition and release the scheduler slot ourselves.
          try {
            await active.run.pause()
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[task-queue] pause run threw', err)
            return
          }
          this.watchdog.disarm(id)
          this.active.delete(id)
          await this.applyTransition(id, 'paused', { trigger: 'pause', reason })
          await this.scheduler.releaseSlot(id)
        }
      }
    }
  }

  async resume(id: string): Promise<void> {
    const t = this.store.get(id)
    if (!t || t.status !== 'paused') return
    await this.applyTransition(id, 'queued', { trigger: 'resume', reason: 'resume' })
    await this.scheduler.enqueue(id, t.priority)
  }

  async retryManual(id: string): Promise<void> {
    const t = this.store.get(id)
    if (!t || (t.status !== 'failed' && t.status !== 'cancelled')) return
    await this.applyTransition(id, 'queued', {
      trigger: t.status === 'failed' ? 'retry-manual' : 'requeue',
      reason: 'manual'
    })
    await this.scheduler.enqueue(id, t.priority)
  }

  async setMaxConcurrency(n: number): Promise<void> {
    await this.scheduler.setMaxConcurrency(n)
  }

  async setMaxPerGroup(groupKey: string, n: number | null): Promise<void> {
    await this.scheduler.setMaxPerGroup(groupKey, n)
  }

  async removeFromHistory(id: string): Promise<void> {
    const t = this.store.get(id)
    if (!t) return
    if (!TERMINAL_STATUSES.has(t.status)) {
      throw new Error(`removeFromHistory: ${id} is not in a terminal state`)
    }
    this.store.remove(id)
    await this.persist.deleteTask(id)
  }

  stats(): TaskQueueStats {
    const stats = this.store.stats(this.scheduler.stats().capacity)
    // Scheduler is the source of truth for `running`/`queued` counts; merge.
    const sStats = this.scheduler.stats()
    stats.running = sStats.running
    stats.queued = sStats.queued
    stats.perGroup = { ...stats.perGroup, ...sStats.perGroup }
    return stats
  }

  subscribe(listener: TaskQueueListener): () => void {
    return this.bus.subscribe(listener)
  }

  on<T extends TaskQueueEvent['type']>(
    type: T,
    listener: (e: Extract<TaskQueueEvent, { type: T }>) => void
  ): () => void {
    return this.bus.on(type, listener)
  }

  // ───────────── Internal: dispatch + executor wiring ─────────────

  private async dispatchOne(id: string): Promise<boolean> {
    const t = this.store.get(id)
    if (!t || t.status !== 'queued') return false

    const attemptId = randomUUID()
    let next: Task
    try {
      next = await this.applyTransition(id, 'running', {
        trigger: 'dispatch',
        reason: null
      })
    } catch (err) {
      if (err instanceof IllegalTransitionError) return false
      throw err
    }

    // Insert the attempt row before the executor spawns; pid is filled in by
    // the spawn callback. raw_args_hash captures the snapshot we ran with.
    await this.persist.insertAttempt({
      taskId: id,
      attemptId,
      pid: -1,
      pidStartedAt: null,
      startedAt: this.clock(),
      rawArgsHash: hashRawArgs(t.input.rawArgs)
    })

    let run: ExecutorRun
    try {
      run = this.executor.run(
        {
          taskId: id,
          attemptId,
          attemptNumber: next.attempt,
          input: t.input
        },
        {
          onSpawn: (e) => {
            this.active.set(id, { taskId: id, attemptId, run })
            void this.processes.recordSpawn({
              taskId: id,
              attemptId,
              pid: e.pid,
              pidStartedAt: e.pidStartedAt ?? readPidStartTime(e.pid),
              kind: e.kind,
              spawnedAt: e.spawnedAt
            })
            // Stamp pid synchronously into the task row.
            void this.persist.upsertTask({
              task: { ...next, pid: e.pid, pidStartedAt: e.pidStartedAt },
              progress: next.progress
            })
            this.watchdog.arm(id, 'running')
          },
          onProgress: (e) => {
            this.applyProgress(id, e.progress)
            this.watchdog.bump(id)
            if (e.enteredProcessing) {
              void this.applyTransition(id, 'processing', {
                trigger: 'progressing',
                reason: null
              })
              this.watchdog.promoteToProcessing(id)
            }
          },
          onStd: () => {
            this.watchdog.bump(id)
          },
          onFinish: (e) => {
            void this.handleFinish(id, attemptId, e)
          }
        }
      )
      this.active.set(id, { taskId: id, attemptId, run })
    } catch (err) {
      // executor.run synchronously threw → fail the task and free the slot.
      const error = virtualError('unknown', String(err))
      await this.applyTransition(id, 'failed', {
        trigger: 'finalize-error',
        reason: error.category,
        error
      })
      await this.scheduler.releaseSlot(id)
      return false
    }
    return true
  }

  private async demoteOne(id: string): Promise<void> {
    const a = this.active.get(id)
    if (a) {
      try {
        await a.run.pause()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[task-queue] demote pause threw', err)
      }
    }
    // applyTransition(running -> paused) happens from the executor's
    // onFinish callback when the child reports cancelled/paused. If it
    // doesn't fire (executor is stuck), the watchdog will eventually
    // surface it.
  }

  private async handleFinish(
    id: string,
    attemptId: string,
    e: import('../executor').ExecutorFinishEvent
  ): Promise<void> {
    this.watchdog.disarm(id)
    this.active.delete(id)

    if (e.result.type === 'success') {
      const out = e.result.output
      const guardOk = out.filePath
        ? this.filePresent(out.filePath) && out.size > 0
        : false
      if (guardOk) {
        await this.persist.closeAttempt({
          taskId: id,
          attemptId,
          endedAt: e.closedAt,
          exitCode: 0,
          errorCategory: null,
          stdoutTail: e.stdoutTail,
          stderrTail: e.stderrTail
        })
        await this.processes.recordClose(id, attemptId, 0, null)
        await this.applyTransition(id, 'completed', {
          trigger: 'finalize-success',
          reason: null,
          output: out
        })
      } else {
        const err = virtualError(
          'output-missing',
          `output ${out.filePath} missing or empty`
        )
        await this.persist.closeAttempt({
          taskId: id,
          attemptId,
          endedAt: e.closedAt,
          exitCode: null,
          errorCategory: 'output-missing',
          stdoutTail: e.stdoutTail,
          stderrTail: e.stderrTail
        })
        await this.processes.recordClose(id, attemptId, null, null)
        await this.applyTransition(id, 'failed', {
          trigger: 'finalize-error',
          reason: 'output-missing',
          error: err
        })
      }
      await this.scheduler.releaseSlot(id)
      return
    }

    if (e.result.type === 'cancelled') {
      // The cancel may have been user-driven, demote-driven, or pause-driven.
      await this.persist.closeAttempt({
        taskId: id,
        attemptId,
        endedAt: e.closedAt,
        exitCode: null,
        errorCategory: 'cancelled-by-user',
        stdoutTail: e.stdoutTail,
        stderrTail: e.stderrTail
      })
      await this.processes.recordClose(id, attemptId, null, 'SIGTERM')

      // Windows pause path: the executor terminates the process to simulate
      // pause. Honour the original intent by transitioning to paused instead.
      if (this.pendingPause.has(id)) {
        this.pendingPause.delete(id)
        const cur = this.store.get(id)
        if (cur && (cur.status === 'running' || cur.status === 'processing')) {
          await this.applyTransition(id, 'paused', {
            trigger: 'pause',
            reason: 'user'
          })
        }
        await this.scheduler.releaseSlot(id)
        return
      }

      const t = this.store.get(id)
      if (t && (t.status === 'running' || t.status === 'processing')) {
        await this.applyTransition(id, 'cancelled', {
          trigger: 'cancel',
          reason: 'user'
        })
      }
      await this.scheduler.releaseSlot(id)
      return
    }

    // result.type === 'error'
    const err = e.result.error
    const exitCode = e.result.exitCode ?? null
    await this.persist.closeAttempt({
      taskId: id,
      attemptId,
      endedAt: e.closedAt,
      exitCode,
      errorCategory: err.category,
      stdoutTail: e.stdoutTail,
      stderrTail: e.stderrTail
    })
    await this.processes.recordClose(id, attemptId, exitCode, null)
    this.bus.emit({
      type: 'error-classified',
      taskId: id,
      attempt: this.store.get(id)?.attempt ?? 0,
      error: err,
      at: this.clock()
    })

    const t = this.store.get(id)
    const maxAttempts = Math.max(
      t?.maxAttempts ?? 0,
      defaultMaxAttempts(err.category)
    )
    const willRetry = err.retryable && (t?.attempt ?? 0) < maxAttempts
    if (willRetry) {
      const wait = computeBackoffMs(
        t?.attempt ?? 0,
        err.suggestedRetryAfterMs,
        this.rng
      )
      const nextRetryAt = this.clock() + wait
      await this.applyTransition(id, 'retry-scheduled', {
        trigger: 'finalize-error',
        reason: err.category,
        error: err,
        nextRetryAt
      })
      this.retry.enqueue(id, nextRetryAt)
    } else {
      await this.applyTransition(id, 'failed', {
        trigger: 'finalize-error',
        reason: err.category,
        error: err
      })
    }
    await this.scheduler.releaseSlot(id)
  }

  private async handleRetryDue(id: string): Promise<void> {
    const t = this.store.get(id)
    if (!t || t.status !== 'retry-scheduled') return
    const next = await this.applyTransition(id, 'queued', {
      trigger: 'retry-tick',
      reason: 'retry'
    })
    await this.scheduler.enqueue(id, next.priority)
  }

  private handleStalled(id: string): void {
    void (async () => {
      const err = virtualError('stalled', 'Watchdog: task idle exceeded')
      const a = this.active.get(id)
      if (a) {
        try {
          await a.run.cancel(0)
        } catch {
          /* noop */
        }
      }
      // The executor will eventually call onFinish with cancelled; convert
      // to error path so retry/maxAttempts is honored.
      const t = this.store.get(id)
      if (!t) return
      const max = Math.max(t.maxAttempts, defaultMaxAttempts('stalled'))
      if (t.attempt < max) {
        const wait = computeBackoffMs(
          t.attempt,
          err.suggestedRetryAfterMs,
          this.rng
        )
        const nextRetryAt = this.clock() + wait
        await this.applyTransition(id, 'retry-scheduled', {
          trigger: 'finalize-error',
          reason: 'stalled',
          error: err,
          nextRetryAt
        })
        this.retry.enqueue(id, nextRetryAt)
      } else {
        await this.applyTransition(id, 'failed', {
          trigger: 'finalize-error',
          reason: 'stalled',
          error: err
        })
      }
      await this.scheduler.releaseSlot(id)
    })()
  }

  private async applyTransition(
    id: string,
    to: TaskStatus,
    ctx: TransitionContext
  ): Promise<Task> {
    const cur = this.store.get(id)
    if (!cur) throw new Error(`applyTransition: missing task ${id}`)
    let next: Task
    try {
      next = fsmTransition(cur, to, { ...ctx, now: this.clock() })
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        // panic path (§ task body): journal panic + force this task to failed,
        // do not poison other tasks.
        await this.persist.appendJournal({
          ts: this.clock(),
          op: 'panic',
          taskId: id,
          attemptId: null,
          pid: cur.pid ?? -1,
          pidStartedAt: cur.pidStartedAt,
          exitCode: null,
          signal: err.message
        })
        // Force a terminal failed transition only if legal.
        if (cur.status !== 'completed' && cur.status !== 'cancelled') {
          const failedErr = virtualError('unknown', err.message)
          const fallback = fsmTransition(cur, 'failed', {
            trigger: 'finalize-error',
            reason: 'panic',
            error: failedErr,
            now: this.clock()
          })
          this.store.update(fallback)
          await this.persist.upsertTask({
            task: fallback,
            progress: fallback.progress
          })
          this.bus.emit({
            type: 'transition',
            taskId: id,
            from: cur.status,
            to: 'failed',
            reason: 'panic',
            attempt: fallback.attempt,
            at: this.clock()
          })
        }
        throw err
      }
      throw err
    }
    this.store.update(next)
    await this.persist.upsertTask({ task: next, progress: next.progress })
    this.bus.emit({
      type: 'transition',
      taskId: id,
      from: cur.status,
      to: next.status,
      reason: next.statusReason,
      attempt: next.attempt,
      at: next.updatedAt
    })
    this.bus.emit({
      type: 'snapshot-changed',
      taskId: id,
      task: next,
      at: next.updatedAt
    })
    return next
  }

  private applyProgress(id: string, progress: TaskProgress): void {
    const t = this.store.get(id)
    if (!t) return
    const merged: Task = { ...t, progress, updatedAt: this.clock() }
    this.store.update(merged)
    this.progressDirty.set(id, progress)
    this.bus.emit({
      type: 'progress',
      taskId: id,
      progress,
      at: merged.updatedAt
    })
    // 1Hz downsample to disk.
    const last = this.progressLastWrite.get(id) ?? 0
    if (merged.updatedAt - last >= PROGRESS_DOWNSAMPLE_MS) {
      this.progressLastWrite.set(id, merged.updatedAt)
      void this.persist.upsertProgress(id, progress)
      this.progressDirty.delete(id)
    }
  }
}

function defaultGroupKey(input: TaskInput): string {
  if (input.subscriptionId) return `sub:${input.subscriptionId}`
  try {
    return new URL(input.url).host || 'unknown'
  } catch {
    return 'unknown'
  }
}

function hashRawArgs(args: readonly string[] | undefined): string {
  if (!args || args.length === 0) return 'sha256:none'
  const h = createHash('sha256')
  h.update(args.join(' '))
  return `sha256:${h.digest('hex')}`
}

// Re-export so adapters can construct rich finish events with named imports.
export type { ClassifiedError, TaskOutput, TaskProgress }
