/**
 * Scheduler — owns the readyHeap (priority + FIFO), the global concurrency
 * budget, the per-group quotas and the slot accounting around dispatch.
 *
 * Reference: docs/vidbee-task-queue-state-machine-design.md §6.
 *
 * The Scheduler does NOT touch task.status directly; it asks the orchestrator
 * to perform the FSM transition through the `dispatch` callback. The Scheduler
 * only owns the dispatch ordering, slot bookkeeping and demote-on-shrink logic.
 */
import type { Task, TaskPriority } from '../types'
import { AsyncMutex } from '../util/async-mutex'
import { MinHeap } from '../util/min-heap'
import { logCaughtError } from '@vidbee/logger'

interface ReadyEntry {
  taskId: string
  priority: TaskPriority
  /** monotonic insertion seq for FIFO tie-break within the same priority. */
  seq: number
}

export interface SchedulerCallbacks {
  /**
   * Called when a slot has been reserved and the task should transition
   * queued -> running. Returns true if the spawn succeeded; false (or thrown)
   * causes the slot to be released and the task to be re-queued or failed
   * by the orchestrator.
   */
  dispatch: (taskId: string) => Promise<boolean> | boolean
  /**
   * Called when the global cap is lowered and we need to demote the lowest-
   * priority running task. The orchestrator is responsible for issuing the
   * actual SIGTERM + FSM transition to `paused('demoted')`.
   */
  demote: (taskId: string) => Promise<void> | void
  /**
   * Provided by the store: returns the current Task. Read-only. The Scheduler
   * uses this to inspect priority/groupKey for demotion decisions.
   */
  getTask: (taskId: string) => Readonly<Task> | undefined
}

export interface SchedulerOptions extends SchedulerCallbacks {
  maxConcurrency: number
  /** default per-group cap; null/undefined → unlimited. */
  defaultMaxPerGroup?: number | null
}

export class Scheduler {
  private readyHeap = new MinHeap<ReadyEntry>((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.seq - b.seq
  )
  /** taskId → 1 currently consuming a slot. */
  private readonly running = new Set<string>()
  /** Reservations whose dispatch callback has not settled yet. */
  private readonly dispatching = new Set<string>()
  /** groupKey → number of tasks currently consuming a slot. */
  private readonly perGroupRunning = new Map<string, number>()
  /** groupKey → explicit per-group cap. Null means unlimited. */
  private readonly perGroupCap = new Map<string, number | null>()
  private readonly mutex = new AsyncMutex()
  private seqCounter = 0
  private maxConcurrency: number
  private defaultMaxPerGroup: number | null

  constructor(private readonly opts: SchedulerOptions) {
    this.maxConcurrency = opts.maxConcurrency
    this.defaultMaxPerGroup = opts.defaultMaxPerGroup ?? null
  }

  // ─────────────── Public API ───────────────

  /** Schedule each task once, including concurrent admission and recovery calls. */
  enqueue(taskId: string, priority: TaskPriority): Promise<void> {
    return this.ensureEnqueued(taskId, priority)
  }

  /** Removes a task from the ready heap (does not touch running set). */
  async dequeue(taskId: string): Promise<boolean> {
    return this.mutex.runExclusive(() => {
      const removed = this.readyHeap.remove((e) => e.taskId === taskId)
      return removed != null
    })
  }

  /**
   * Push a queued task onto the ready heap if it is not already waiting or running.
   *
   * @param taskId Task to schedule.
   * @param priority Heap priority.
   */
  async ensureEnqueued(taskId: string, priority: TaskPriority): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (this.running.has(taskId)) {
        return
      }
      if (this.readyHeap.toArray().some((entry) => entry.taskId === taskId)) {
        return
      }
      this.readyHeap.push({
        taskId,
        priority,
        seq: ++this.seqCounter
      })
    })
    await this.tryDispatch()
  }

  /**
   * Drop slot reservations for tasks that are no longer actually executing.
   *
   * @param isLive Return true when `taskId` still owns a real run.
   */
  async sweepDeadSlots(isLive: (taskId: string) => boolean): Promise<void> {
    await this.mutex.runExclusive(() => {
      for (const id of [...this.running]) {
        if (this.dispatching.has(id) || isLive(id)) {
          continue
        }
        this.running.delete(id)
      }
      // Rebuild from live reservations to repair counters left by duplicate or removed tasks.
      this.perGroupRunning.clear()
      for (const id of this.running) {
        const task = this.opts.getTask(id)
        if (task) {
          this.incGroup(task.groupKey)
        }
      }
    })
    await this.tryDispatch()
  }

  /**
   * Attempt to fill free slots from the ready heap.
   */
  kick(): Promise<void> {
    return this.tryDispatch()
  }

  /**
   * Marker that a previously-dispatched task has reached a terminal/yielding
   * status (completed/failed/cancelled/paused/retry-scheduled). Releases its
   * slot and bumps dispatch.
   */
  async releaseSlot(taskId: string): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (!this.running.has(taskId)) return
      this.running.delete(taskId)
      const t = this.opts.getTask(taskId)
      const groupKey = t?.groupKey
      if (groupKey) this.decGroup(groupKey)
    })
    await this.tryDispatch()
  }

  async setMaxConcurrency(n: number): Promise<void> {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`maxConcurrency must be ≥ 1 integer, got ${n}`)
    }
    const toDemote: string[] = []
    await this.mutex.runExclusive(() => {
      this.maxConcurrency = n
      while (this.running.size > this.maxConcurrency) {
        const victim = this.pickDemoteVictim()
        if (!victim) break
        toDemote.push(victim)
        this.running.delete(victim)
        const t = this.opts.getTask(victim)
        if (t?.groupKey) this.decGroup(t.groupKey)
      }
    })
    for (const id of toDemote) {
      try {
        await this.opts.demote(id)
      } catch (err) {
        logCaughtError('task_queue_demote_threw', err)
      }
    }
    void this.tryDispatch()
  }

  async setMaxPerGroup(groupKey: string, n: number | null): Promise<void> {
    await this.mutex.runExclusive(() => {
      if (n == null) {
        this.perGroupCap.delete(groupKey)
      } else {
        if (!Number.isInteger(n) || n < 1) {
          throw new Error(`maxPerGroup must be null or ≥ 1 integer, got ${n}`)
        }
        this.perGroupCap.set(groupKey, n)
      }
    })
    void this.tryDispatch()
  }

  setDefaultMaxPerGroup(n: number | null): void {
    this.defaultMaxPerGroup = n
  }

  stats(): {
    readonly running: number
    readonly queued: number
    readonly capacity: number
    readonly perGroup: Record<string, number>
  } {
    const perGroup: Record<string, number> = {}
    for (const [k, v] of this.perGroupRunning) perGroup[k] = v
    return {
      running: this.running.size,
      queued: this.readyHeap.size(),
      capacity: this.maxConcurrency,
      perGroup
    }
  }

  // ─────────────── Internals ───────────────

  /**
   * Tries to fill open slots. Held under the mutex so two concurrent triggers
   * cannot both consume the same slot. The dispatch callback is invoked
   * outside the mutex (callbacks may do FSM transitions and IO).
   */
  private async tryDispatch(): Promise<void> {
    const toDispatch: string[] = []
    await this.mutex.runExclusive(() => {
      while (this.running.size < this.maxConcurrency && this.readyHeap.size() > 0) {
        const candidate = this.popEligible()
        if (!candidate) break
        const t = this.opts.getTask(candidate.taskId)
        if (!t) continue
        this.running.add(candidate.taskId)
        this.dispatching.add(candidate.taskId)
        this.incGroup(t.groupKey)
        toDispatch.push(candidate.taskId)
      }
    })
    for (const id of toDispatch) {
      let ok = false
      try {
        ok = await this.opts.dispatch(id)
      } catch (err) {
        logCaughtError('task_queue_dispatch_threw', err)
      }
      this.dispatching.delete(id)
      if (!ok) {
        // Roll back the slot reservation; the orchestrator may have failed
        // the task synchronously, in which case we would already have been
        // told via `releaseSlot`. Idempotent.
        await this.mutex.runExclusive(() => {
          if (this.running.delete(id)) {
            const t = this.opts.getTask(id)
            if (t?.groupKey) this.decGroup(t.groupKey)
          }
        })
      }
    }
  }

  /**
   * Pop the next entry that satisfies the per-group cap. Skipped entries are
   * stashed and re-pushed at the end of the call so we do not lose them.
   */
  private popEligible(): ReadyEntry | undefined {
    const skipped: ReadyEntry[] = []
    let chosen: ReadyEntry | undefined
    while (this.readyHeap.size() > 0) {
      const top = this.readyHeap.pop()!
      const task = this.opts.getTask(top.taskId)
      if (!task || this.running.has(top.taskId)) {
        // Drop stale entries and tasks that already own a reservation.
        continue
      }
      if (this.canRunInGroup(task.groupKey)) {
        chosen = top
        break
      }
      skipped.push(top)
    }
    for (const s of skipped) this.readyHeap.push(s)
    return chosen
  }

  private canRunInGroup(groupKey: string): boolean {
    const cap = this.perGroupCap.has(groupKey)
      ? this.perGroupCap.get(groupKey)!
      : this.defaultMaxPerGroup
    if (cap == null) return true
    const n = this.perGroupRunning.get(groupKey) ?? 0
    return n < cap
  }

  private pickDemoteVictim(): string | null {
    /**
     * Demote the lowest-priority, least-progress running task. We don't have
     * progress here, so we approximate by walking running tasks and picking
     * the one with the highest priority number (= lowest priority).
     */
    let victim: string | null = null
    let victimPri: number = -1
    for (const id of this.running) {
      const t = this.opts.getTask(id)
      if (!t) continue
      if (t.priority > victimPri) {
        victimPri = t.priority
        victim = id
      }
    }
    return victim
  }

  private incGroup(groupKey: string): void {
    this.perGroupRunning.set(groupKey, (this.perGroupRunning.get(groupKey) ?? 0) + 1)
  }

  private decGroup(groupKey: string): void {
    const cur = this.perGroupRunning.get(groupKey) ?? 0
    if (cur <= 1) this.perGroupRunning.delete(groupKey)
    else this.perGroupRunning.set(groupKey, cur - 1)
  }
}
