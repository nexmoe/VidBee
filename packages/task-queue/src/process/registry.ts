/**
 * ProcessRegistry — in-memory mirror of the `process_journal` table.
 *
 * Reference: docs/vidbee-task-queue-state-machine-design.md §8.
 *
 * On spawn we record `(taskId, attemptId, pid, pidStartedAt, kind)` and
 * append a `spawn` journal row. On close we append a `close` row. During
 * crash recovery we walk the journal looking for spawns without a matching
 * close and verify (pid, pidStartedAt) still maps to a live process; if so
 * the process is killed (SIGTERM → 10s → SIGKILL).
 */
import type { PersistAdapter } from '../persist'
import type { ProcessJournalOp, ProcessKind } from '../types'
import { killProcessTree } from './kill-process-tree'
import { isPidAlive, readPidStartTime } from './pid-start-time'

export interface ProcessHandle {
  taskId: string
  attemptId: string
  pid: number
  pidStartedAt: number | null
  kind: ProcessKind
  spawnedAt: number
}

export interface ProcessRegistryDeps {
  persist: PersistAdapter
  /** Test seam for time. */
  clock?: () => number
  /** Test seam for sending signals. */
  kill?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
  /** Test seam for sleep — used between SIGTERM and SIGKILL. */
  sleep?: (ms: number) => Promise<void>
  killGracePeriodMs?: number
}

export class ProcessRegistry {
  private readonly handles = new Map<string, ProcessHandle>()
  private readonly clock: () => number
  private readonly kill: NonNullable<ProcessRegistryDeps['kill']>
  private readonly sleep: NonNullable<ProcessRegistryDeps['sleep']>
  private readonly killGracePeriodMs: number

  constructor(private readonly deps: ProcessRegistryDeps) {
    this.clock = deps.clock ?? Date.now
    this.kill = deps.kill ?? ((pid, sig) => killProcessTree(pid, sig))
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.killGracePeriodMs = deps.killGracePeriodMs ?? 10_000
  }

  /** Record a spawn and append a journal row. */
  async recordSpawn(handle: ProcessHandle): Promise<void> {
    this.handles.set(this.key(handle.taskId, handle.attemptId), handle)
    await this.deps.persist.appendJournal({
      ts: handle.spawnedAt,
      op: 'spawn',
      taskId: handle.taskId,
      attemptId: handle.attemptId,
      pid: handle.pid,
      pidStartedAt: handle.pidStartedAt,
      exitCode: null,
      signal: null
    })
  }

  /** Record a clean close (process exited under its own steam). */
  async recordClose(
    taskId: string,
    attemptId: string,
    exitCode: number | null,
    signal: string | null
  ): Promise<void> {
    const handle = this.handles.get(this.key(taskId, attemptId))
    this.handles.delete(this.key(taskId, attemptId))
    await this.appendJournal('close', {
      taskId,
      attemptId,
      pid: handle?.pid ?? -1,
      pidStartedAt: handle?.pidStartedAt ?? null,
      exitCode,
      signal
    })
  }

  /** Cancel: SIGTERM → 10s → SIGKILL → journal `killed`. */
  async cancel(taskId: string, attemptId: string): Promise<void> {
    const handle = this.handles.get(this.key(taskId, attemptId))
    if (!handle) return
    try {
      this.kill(handle.pid, 'SIGTERM')
    } catch {
      // process already gone
    }
    await this.sleep(this.killGracePeriodMs)
    if (isPidAlive(handle.pid)) {
      try {
        this.kill(handle.pid, 'SIGKILL')
      } catch {
        // race: gone between checks
      }
    }
    this.handles.delete(this.key(taskId, attemptId))
    await this.appendJournal('killed', {
      taskId,
      attemptId,
      pid: handle.pid,
      pidStartedAt: handle.pidStartedAt,
      exitCode: null,
      signal: 'SIGKILL'
    })
  }

  /**
   * Walk the journal for unclosed spawns. For each, verify the same process
   * is still alive (pid + pidStartedAt match). If yes → kill it. Either way,
   * append a `killed` row so the journal is reconciled.
   *
   * Returns the list of taskIds whose attempts the orchestrator must
   * re-classify (typically: transition to `paused('crash-recovery')`).
   */
  async reconcile(): Promise<
    Array<{ taskId: string; attemptId: string | null; pid: number; killed: boolean }>
  > {
    const open = await this.deps.persist.findOpenSpawns()
    const reconciled: Array<{
      taskId: string
      attemptId: string | null
      pid: number
      killed: boolean
    }> = []
    for (const row of open) {
      const stillAlive = isPidAlive(row.pid)
      const startedAtNow = stillAlive ? readPidStartTime(row.pid) : null
      const sameProcess =
        stillAlive &&
        (row.pidStartedAt == null ||
          startedAtNow == null ||
          Math.abs((startedAtNow ?? 0) - (row.pidStartedAt ?? 0)) < 2_000)
      let killed = false
      if (sameProcess) {
        try {
          this.kill(row.pid, 'SIGTERM')
          await this.sleep(this.killGracePeriodMs)
          if (isPidAlive(row.pid)) this.kill(row.pid, 'SIGKILL')
          killed = true
        } catch {
          // already gone
        }
      }
      await this.appendJournal('killed', {
        taskId: row.taskId,
        attemptId: row.attemptId,
        pid: row.pid,
        pidStartedAt: row.pidStartedAt,
        exitCode: null,
        signal: killed ? 'SIGKILL' : null
      })
      reconciled.push({
        taskId: row.taskId,
        attemptId: row.attemptId,
        pid: row.pid,
        killed
      })
    }
    return reconciled
  }

  size(): number {
    return this.handles.size
  }

  private key(taskId: string, attemptId: string): string {
    return `${taskId}:${attemptId}`
  }

  private async appendJournal(
    op: ProcessJournalOp,
    row: {
      taskId: string
      attemptId: string | null
      pid: number
      pidStartedAt: number | null
      exitCode: number | null
      signal: string | null
    }
  ): Promise<void> {
    await this.deps.persist.appendJournal({
      ts: this.clock(),
      op,
      taskId: row.taskId,
      attemptId: row.attemptId,
      pid: row.pid,
      pidStartedAt: row.pidStartedAt,
      exitCode: row.exitCode,
      signal: row.signal
    })
  }
}
