/**
 * PersistAdapter — single writer to the durable store. The contract here is
 * what the orchestrator and ProcessRegistry use; concrete implementations
 * (memory for `--vidbee-local`, SQLite for production) live alongside.
 *
 * Design rules (§9):
 *   - One writer. The orchestrator is the only caller.
 *   - transition writes are immediate (BEGIN IMMEDIATE on SQLite).
 *   - progress writes are downsampled to ≤ 1Hz; terminal transitions force a
 *     flush of the most recent progress.
 *   - pid + pidStartedAt are written synchronously inside `recordSpawn`; no
 *     throttling allowed.
 */
import type { AttemptRow, ProcessJournalOp, ProcessJournalRow, Task, TaskProgress } from '../types'

export interface PersistTransitionInput {
  task: Task
  /** snapshot to atomically write progress alongside the transition. */
  progress: TaskProgress
}

export interface RecordSpawnInput {
  taskId: string
  attemptId: string
  pid: number
  pidStartedAt: number | null
  startedAt: number
  rawArgsHash: string
}

export interface RecordCloseInput {
  taskId: string
  attemptId: string
  endedAt: number
  exitCode: number | null
  errorCategory: AttemptRow['errorCategory']
  stdoutTail: string | null
  stderrTail: string | null
}

export interface JournalAppendInput {
  ts: number
  op: ProcessJournalOp
  taskId: string
  attemptId: string | null
  pid: number
  pidStartedAt: number | null
  exitCode: number | null
  signal: string | null
}

export interface PersistAdapter {
  /**
   * Whether `taskId` has a row in the durable store. Callers that share the
   * database across hosts must use this instead of an in-memory snapshot:
   * another process can insert or delete the row after this process started.
   */
  hasTask(taskId: string): Promise<boolean>
  /** Insert a new task (called from `add()`). */
  insertTask(task: Task): Promise<void>
  /** Replace the existing task row + progress row. Used for every transition. */
  upsertTask(input: PersistTransitionInput): Promise<void>
  /** Atomically replace related task snapshots when a shared source file moves. */
  upsertTasks(inputs: PersistTransitionInput[]): Promise<void>
  /** Downsampled progress write (the orchestrator calls at most every 1s). */
  upsertProgress(taskId: string, progress: TaskProgress): Promise<void>
  /**
   * Remove a task and its descendants (transcription children, playlist
   * entries). Required because `tasks.parent_id` references `tasks(id)`
   * without ON DELETE CASCADE.
   */
  deleteTask(taskId: string): Promise<void>
  /** Insert a new attempt row at spawn time. */
  insertAttempt(input: RecordSpawnInput): Promise<void>
  /** Update the attempt row at close time. */
  closeAttempt(input: RecordCloseInput): Promise<void>
  /** Append a process_journal row. */
  appendJournal(input: JournalAppendInput): Promise<void>
  /** Find spawn rows that have no matching close/killed entry. */
  findOpenSpawns(): Promise<ProcessJournalRow[]>
  /** Restore all task rows on startup (crash recovery). */
  loadAllTasks(): Promise<Task[]>
  /** Restore the latest attempt row per task on startup. */
  loadLatestAttempt(taskId: string): Promise<AttemptRow | null>
  /**
   * Periodic maintenance: WAL checkpoint + journal aging. Optional —
   * memory impl is a no-op.
   */
  maintenance?(): Promise<void>
  /** Close the underlying connection. */
  close?(): Promise<void> | void
}
