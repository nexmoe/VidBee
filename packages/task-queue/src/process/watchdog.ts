import { logCaughtError } from '@vidbee/logger'
/**
 * Watchdog — fires when a task makes no observable progress for too long.
 *
 * Reference: docs/vidbee-task-queue-state-machine-design.md §6, §7.1 row 10.
 *
 * Default thresholds:
 *   - status=running:    60s of stdout/stderr/progress silence → stalled.
 *   - status=processing: 600s (postprocessing/merge can be slow).
 *
 * The Watchdog only emits a "stalled" callback; the orchestrator decides what
 * to do with it (typically: classify as virtual `stalled` and SIGKILL).
 */
export interface WatchdogConfig {
  runningIdleMs?: number
  processingIdleMs?: number
  /** Test seam. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  clock?: () => number
}

export interface WatchdogEntry {
  taskId: string
  status: 'running' | 'processing'
  lastBumpAt: number
  timer: unknown | null
}

export class Watchdog {
  private readonly entries = new Map<string, WatchdogEntry>()
  private readonly runningIdleMs: number
  private readonly processingIdleMs: number
  private readonly setTimer: NonNullable<WatchdogConfig['setTimer']>
  private readonly clearTimer: NonNullable<WatchdogConfig['clearTimer']>
  private readonly clock: NonNullable<WatchdogConfig['clock']>
  private readonly onStalled: (taskId: string, entry: Readonly<WatchdogEntry>) => void

  constructor(
    onStalled: (taskId: string, entry: Readonly<WatchdogEntry>) => void,
    config: WatchdogConfig = {}
  ) {
    this.onStalled = onStalled
    this.runningIdleMs = config.runningIdleMs ?? 60_000
    this.processingIdleMs = config.processingIdleMs ?? 600_000
    this.setTimer = config.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = config.clearTimer ?? ((h) => clearTimeout(h as never))
    this.clock = config.clock ?? Date.now
  }

  arm(taskId: string, status: 'running' | 'processing'): void {
    this.disarm(taskId)
    const entry: WatchdogEntry = {
      taskId,
      status,
      lastBumpAt: this.clock(),
      timer: null
    }
    entry.timer = this.scheduleNext(entry)
    this.entries.set(taskId, entry)
  }

  /**
   * Move from `running` → `processing` thresholds, preserving lastBumpAt.
   * Used when yt-dlp emits the Postprocess line.
   */
  promoteToProcessing(taskId: string): void {
    const e = this.entries.get(taskId)
    if (!e) {
      return
    }
    if (e.timer) {
      this.clearTimer(e.timer)
    }
    e.status = 'processing'
    e.lastBumpAt = this.clock()
    e.timer = this.scheduleNext(e)
  }

  bump(taskId: string): void {
    const e = this.entries.get(taskId)
    if (!e) {
      return
    }
    if (e.timer) {
      this.clearTimer(e.timer)
    }
    e.lastBumpAt = this.clock()
    e.timer = this.scheduleNext(e)
  }

  disarm(taskId: string): void {
    const e = this.entries.get(taskId)
    if (!e) {
      return
    }
    if (e.timer) {
      this.clearTimer(e.timer)
    }
    this.entries.delete(taskId)
  }

  size(): number {
    return this.entries.size
  }

  private scheduleNext(entry: WatchdogEntry): unknown {
    const idle = entry.status === 'processing' ? this.processingIdleMs : this.runningIdleMs
    return this.setTimer(() => {
      const cur = this.entries.get(entry.taskId)
      if (!cur) {
        return
      }
      const elapsed = this.clock() - cur.lastBumpAt
      if (elapsed >= idle) {
        // disarm before notifying so onStalled can call back into us safely
        this.entries.delete(entry.taskId)
        try {
          this.onStalled(entry.taskId, cur)
        } catch (err) {
          logCaughtError('task_queue_watchdog_threw', err)
        }
        return
      }
      // Bumped after we scheduled but before we fired — re-arm.
      cur.timer = this.scheduleNext(cur)
    }, idle)
  }
}
