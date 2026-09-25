// Public surface of @vidbee/task-queue. Adapters import from here.

export type {
  AddTaskRequest,
  ImportCompletedRequest,
  ListOptions,
  TaskQueueAPIOptions
} from './api'
export { TaskQueueAPI } from './api'
export type { ClassifyInput } from './classifier'
export {
  CLASSIFIER_RULES,
  classify,
  defaultMaxAttempts,
  getRuleForCategory,
  parseRetryAfter,
  sanitizeOutput,
  takeStderrTail,
  virtualError
} from './classifier'
export type { OutputCompleteCheck } from './complete'
export { isOutputComplete } from './complete'
export type { TaskQueueContract } from './contract'
export { taskQueueContract } from './contract'
export type {
  ErrorClassifiedEvent,
  OrphanKilledEvent,
  ProgressEvent,
  SnapshotChangedEvent,
  TaskQueueEvent,
  TaskQueueEventType,
  TaskQueueListener,
  TaskRemovedEvent,
  TransitionEvent
} from './events'
export { EventBus } from './events'
export type {
  Executor,
  ExecutorContext,
  ExecutorEvents,
  ExecutorFinishEvent,
  ExecutorProgressEvent,
  ExecutorRouterOptions,
  ExecutorRun,
  ExecutorSpawnEvent,
  ExecutorStdEvent
} from './executor'
export { ExecutorRouter } from './executor'
export type { TransitionContext, TransitionTrigger } from './fsm'
export {
  IllegalTransitionError,
  isLegalTransition,
  LEGAL_TRANSITIONS,
  transition
} from './fsm'
export type {
  JournalAppendInput,
  PersistAdapter,
  PersistTransitionInput,
  RecordCloseInput,
  RecordSpawnInput,
  SqlitePersistOptions
} from './persist'
export {
  MemoryPersistAdapter,
  SqlitePersistAdapter
} from './persist'
export type {
  ProcessHandle,
  ProcessRegistryDeps,
  ReadPidStartTimeFn,
  WatchdogConfig,
  WatchdogEntry
} from './process'
export {
  isPidAlive,
  ProcessRegistry,
  readPidStartTime,
  setReadPidStartTimeImpl,
  Watchdog
} from './process'
export type {
  LegacyDownloadProgress,
  LegacyDownloadStatus,
  LegacySubStatus,
  LegacyTaskProjection
} from './projection'
export {
  legacyDownloadStatusOf,
  legacySubStatusOf,
  projectTaskToLegacy
} from './projection'
export type {
  RetrySchedulerOptions,
  SchedulerCallbacks,
  SchedulerOptions
} from './scheduler'
export {
  computeBackoffMs,
  RetryScheduler,
  Scheduler
} from './scheduler'
export * from './schemas'
export { TaskStore } from './store'
export * from './types'
