import type { ClassifiedError, Task, TaskProgress, TaskStatus } from '../types'

export interface TransitionEvent {
  type: 'transition'
  taskId: string
  from: TaskStatus | null
  to: TaskStatus
  reason: string | null
  attempt: number
  at: number
}

export interface ProgressEvent {
  type: 'progress'
  taskId: string
  progress: Readonly<TaskProgress>
  at: number
}

export interface SnapshotChangedEvent {
  type: 'snapshot-changed'
  taskId: string
  task: Readonly<Task>
  at: number
}

export interface OrphanKilledEvent {
  type: 'orphan-killed'
  taskId: string
  pid: number
  pidStartedAt: number | null
  signal: 'SIGTERM' | 'SIGKILL'
  at: number
}

export interface ErrorClassifiedEvent {
  type: 'error-classified'
  taskId: string
  attempt: number
  error: ClassifiedError
  at: number
}

/** A single stdout/stderr line from the running executor, for live log streaming. */
export interface LogEvent {
  type: 'log'
  taskId: string
  attemptId: string
  stream: 'stdout' | 'stderr'
  line: string
  at: number
}

export type TaskQueueEvent =
  | TransitionEvent
  | ProgressEvent
  | SnapshotChangedEvent
  | OrphanKilledEvent
  | ErrorClassifiedEvent
  | LogEvent

export type TaskQueueEventType = TaskQueueEvent['type']

export type TaskQueueListener<E extends TaskQueueEvent = TaskQueueEvent> = (
  event: E
) => void

export class EventBus {
  private readonly listeners = new Map<TaskQueueEventType | '*', Set<TaskQueueListener>>()

  subscribe(listener: TaskQueueListener): () => void {
    return this.subscribeFiltered('*', listener)
  }

  on<T extends TaskQueueEventType>(
    type: T,
    listener: TaskQueueListener<Extract<TaskQueueEvent, { type: T }>>
  ): () => void {
    return this.subscribeFiltered(type, listener as TaskQueueListener)
  }

  emit(event: TaskQueueEvent): void {
    const typed = this.listeners.get(event.type)
    if (typed) {
      for (const l of typed) this.safeCall(l, event)
    }
    const wildcard = this.listeners.get('*')
    if (wildcard) {
      for (const l of wildcard) this.safeCall(l, event)
    }
  }

  /** Number of subscribers; for tests/diagnostics. */
  size(): number {
    let n = 0
    for (const set of this.listeners.values()) n += set.size
    return n
  }

  private subscribeFiltered(
    key: TaskQueueEventType | '*',
    listener: TaskQueueListener
  ): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) this.listeners.delete(key)
    }
  }

  private safeCall(listener: TaskQueueListener, event: TaskQueueEvent): void {
    try {
      listener(event)
    } catch (err) {
      // Listener errors must never poison kernel control flow.
      // eslint-disable-next-line no-console
      console.error('[task-queue] listener threw', err)
    }
  }
}
