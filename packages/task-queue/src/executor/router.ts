/**
 * Routes a task attempt to the executor registered for its kind.
 *
 * The kernel stays kind-agnostic: download and transcription logic live in
 * host-supplied executors. Only download kinds use the default executor.
 */
import { isDownloadTaskKind, type TaskKind } from '../types'
import type { Executor, ExecutorContext, ExecutorEvents, ExecutorRun } from './index'

export interface ExecutorRouterOptions {
  defaultExecutor: Executor
  byKind?: Partial<Record<TaskKind, Executor>>
}

export class ExecutorRouter implements Executor {
  private readonly defaultExecutor: Executor
  private readonly byKind: Partial<Record<TaskKind, Executor>>

  constructor(opts: ExecutorRouterOptions) {
    this.defaultExecutor = opts.defaultExecutor
    this.byKind = opts.byKind ?? {}
  }

  /** Route registered kinds and reject missing non-download executors. */
  run(ctx: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    if (!(this.byKind[ctx.input.kind] || isDownloadTaskKind(ctx.input.kind))) {
      throw new Error(`This host has no executor for ${ctx.input.kind} tasks`)
    }
    const executor = this.byKind[ctx.input.kind] ?? this.defaultExecutor
    return executor.run(ctx, events)
  }
}
