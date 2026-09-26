/**
 * Executor — host-neutral interface that the orchestrator uses to spawn a
 * single attempt of a task. The default production implementation lives in
 * @vidbee/downloader-core (`YtDlpExecutor`) and is owned by NEX-131. Tests
 * supply a fake.
 */
import type { ClassifiedError, ProcessKind, TaskInput, TaskOutput, TaskProgress } from '../types'

export interface ExecutorSpawnEvent {
  taskId: string
  attemptId: string
  pid: number
  pidStartedAt: number | null
  kind: ProcessKind
  spawnedAt: number
}

export interface ExecutorProgressEvent {
  taskId: string
  attemptId: string
  progress: TaskProgress
  /**
   * True when yt-dlp emits a Postprocess/Merging line — the orchestrator
   * uses this to transition `running -> processing`.
   */
  enteredProcessing: boolean
}

export interface ExecutorStdEvent {
  taskId: string
  attemptId: string
  stream: 'stdout' | 'stderr'
  /** A complete line with no trailing newline. */
  line: string
}

export interface ExecutorFinishEvent {
  taskId: string
  attemptId: string
  /**
   * One of:
   *   - 'success' with output (filePath, size, ...) if the executor verified
   *      the file exists and is non-empty.
   *   - 'error' with a ClassifiedError if the run produced a non-zero exit
   *      or the executor decided to surface a structured failure.
   *   - 'cancelled' if the orchestrator requested cancel and the child has
   *      been reaped.
   */
  result:
    | { type: 'success'; output: TaskOutput }
    | { type: 'error'; error: ClassifiedError; exitCode: number | null }
    | { type: 'cancelled' }
  closedAt: number
  /** stdoutTail/stderrTail to be persisted on the attempt row. */
  stdoutTail: string
  stderrTail: string
}

export interface ExecutorEvents {
  onSpawn: (e: ExecutorSpawnEvent) => void
  onProgress: (e: ExecutorProgressEvent) => void
  /** Postprocessing can start without another download progress event. */
  onProcessing?: (e: Pick<ExecutorProgressEvent, 'taskId' | 'attemptId'>) => void
  onStd: (e: ExecutorStdEvent) => void
  onFinish: (e: ExecutorFinishEvent) => void
}

export interface ExecutorRun {
  /**
   * Issue SIGTERM and reap. The implementation MUST resolve onFinish with
   * `{ type: 'cancelled' }` after the child closes; the orchestrator will
   * issue SIGKILL after a 10s grace period (handled here so the kernel does
   * not need to know OS specifics).
   */
  cancel: (timeout?: number) => Promise<void>
  /**
   * Pause: SIGTERM but record that resume is allowed. Same finish semantics
   * as cancel; orchestrator will stamp `paused('user')` on the FSM.
   */
  pause: () => Promise<void>
}

export interface ExecutorContext {
  taskId: string
  attemptId: string
  attemptNumber: number
  input: TaskInput
}

export interface Executor {
  /**
   * Begin a new attempt. Returns a handle used to cancel/pause. The
   * orchestrator subscribes to events through the supplied `events`
   * callbacks; the executor MUST call them in order:
   *    onSpawn → (onProgress|onProcessing|onStd)* → onFinish (exactly once).
   */
  run(ctx: ExecutorContext, events: ExecutorEvents): ExecutorRun
}

export type { ExecutorRouterOptions } from './router'
// biome-ignore lint/performance/noBarrelFile: Preserve the existing executor subpath API.
export { ExecutorRouter } from './router'
