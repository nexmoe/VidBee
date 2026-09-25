/**
 * Canonical domain model for @vidbee/task-queue.
 *
 * Authoritative source: docs/vidbee-task-queue-state-machine-design.md §3, §5, §7.
 * Adapters in apps/desktop, apps/api, apps/cli MUST consume these types directly;
 * any host-local divergence is a contract bug.
 */

export type TaskKind =
  | 'video'
  | 'audio'
  | 'playlist'
  | 'subscription-item'
  | 'yt-dlp-forward'
  | 'transcription'
  | 'conversion'
  | 'model-download'

/** Media download kinds that may receive a transcription child task. */
export const TRANSCRIBABLE_TASK_KINDS: ReadonlySet<TaskKind> = new Set([
  'video',
  'audio',
  'subscription-item'
])

export const TRANSCRIPTION_GROUP_KEY = 'transcription'

/** Identify tasks handled by downloader-specific services. */
export const isDownloadTaskKind = (kind: TaskKind): boolean =>
  kind !== 'transcription' && kind !== 'conversion' && kind !== 'model-download'

/** Media-producing tasks share file, playback and history surfaces. */
export const isMediaTaskKind = (kind: TaskKind): boolean =>
  isDownloadTaskKind(kind) || kind === 'conversion'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'processing'
  | 'paused'
  | 'retry-scheduled'
  | 'completed'
  | 'failed'
  | 'cancelled'

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled'
])

export type TaskPriority = 0 | 10 | 20

export const PRIORITY_USER: TaskPriority = 0
export const PRIORITY_SUBSCRIPTION: TaskPriority = 10
export const PRIORITY_BACKGROUND: TaskPriority = 20

export type ErrorCategory =
  | 'http-429'
  | 'auth-required'
  | 'geo-blocked'
  | 'not-found'
  | 'disk-full'
  | 'permission-denied'
  | 'binary-missing'
  | 'ffmpeg'
  | 'network-transient'
  | 'stalled'
  | 'cancelled-by-user'
  | 'output-missing'
  | 'unknown'

/** Creation provenance is independent of the executor and survives retries. */
export interface TaskCreationMetadata {
  origin: 'manual' | 'subscription' | 'agent'
  agentConversation?: {
    downloadId: string
    threadId: string
    promptId: string
  }
}

export interface TaskInput {
  url: string
  kind: TaskKind
  /** Title at submit time (best-effort; may be filled in later by probe). */
  title?: string
  thumbnail?: string
  /** RSS subscription id when this task is a subscription-item. */
  subscriptionId?: string
  /** Playlist parent id when applicable. */
  playlistId?: string
  playlistIndex?: number
  /**
   * Raw yt-dlp argv passed by the caller. Only used for hashing into
   * `attempts.raw_args_hash` so we can correlate retries with the snapshot
   * that produced them. Adapters are responsible for sanitization.
   */
  rawArgs?: readonly string[]
  /** Free-form host hints (output template, cookies, proxy...). */
  options?: Record<string, unknown>
}

export type TranscriptResultKind = 'transcript' | 'no-speech'

export interface TranscriptTaskResult {
  resultKind: TranscriptResultKind
  transcriptId: string
}

export type SubtitleDownloadStatus = 'downloaded' | 'unavailable' | 'skipped-auth' | 'failed'

export interface TaskOutput {
  /** Immutable acquisition facts captured by the downloader process. */
  subtitleAcquisition?: {
    id: string
    acquiredAt: number
    credentialsUsed?: boolean
    visibility?: 'public' | 'private' | 'unlisted'
  }

  filePath: string
  size: number
  durationMs: number | null
  /** sha256 of file at completion, or null if not computed. */
  sha256: string | null
  /**
   * yt-dlp's resolved format id (e.g. `30080+30280`) — captured via
   * `--print after_move:%(format_id)s` so hosts can detect when the chain
   * fell back from the user's pick. null when the executor doesn't surface
   * one (e.g. fake fixtures, raw `yt-dlp -j` info-fetch).
   */
  formatId?: string | null
  /** Outcome of an optional subtitle request; absent when subtitles were not requested. */
  subtitleStatus?: SubtitleDownloadStatus
  /** Actual yt-dlp subtitle language tags selected for download. */
  subtitleLanguages?: string[]
  /**
   * Set by the transcription executor after the transcript or explicit
   * no-speech result has been committed to SQLite. Download tasks leave
   * this unset.
   */
  transcript?: TranscriptTaskResult
}

export interface TaskProgress {
  /** 0..1 inclusive. Sparse — null while parsing or before yt-dlp emits. */
  percent: number | null
  bytesDownloaded: number | null
  bytesTotal: number | null
  speedBps: number | null
  etaMs: number | null
  /** Non-monotonic rolling counter, bumped any time the executor emits. */
  ticks: number
}

export const EMPTY_PROGRESS: TaskProgress = {
  percent: null,
  bytesDownloaded: null,
  bytesTotal: null,
  speedBps: null,
  etaMs: null,
  ticks: 0
}

export interface ClassifiedError {
  category: ErrorCategory
  exitCode: number | null
  /** stderr tail (≤ 8KB). MUST be sanitized before persisting. */
  rawMessage: string
  uiMessageKey: string
  uiActionHints: readonly string[]
  retryable: boolean
  /** null → use default backoff, non-null → honor (e.g. Retry-After). */
  suggestedRetryAfterMs: number | null
}

export interface Task {
  id: string
  kind: TaskKind
  parentId: string | null
  input: TaskInput
  priority: TaskPriority
  groupKey: string
  status: TaskStatus
  /** Status the FSM held immediately before the current one (for diagnostics). */
  prevStatus: TaskStatus | null
  /** Why we are in this status: 'crash-recovery', 'paused-by-user', error category, etc. */
  statusReason: string | null
  enteredStatusAt: number
  attempt: number
  maxAttempts: number
  nextRetryAt: number | null
  progress: TaskProgress
  output: TaskOutput | null
  lastError: ClassifiedError | null
  pid: number | null
  pidStartedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface AttemptRow {
  id: string
  taskId: string
  attemptNumber: number
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  errorCategory: ErrorCategory | null
  stdoutTail: string | null
  stderrTail: string | null
  rawArgsHash: string
}

export type ProcessJournalOp = 'spawn' | 'close' | 'killed' | 'panic'

export interface ProcessJournalRow {
  seq: number
  ts: number
  op: ProcessJournalOp
  taskId: string
  attemptId: string | null
  pid: number
  pidStartedAt: number | null
  exitCode: number | null
  signal: string | null
}

export type ProcessKind = 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'ai-worker'

/**
 * Read-only snapshot returned by TaskStore.snapshot(). Consumers MUST treat
 * this as immutable; mutating requires going through TaskFSM.transition().
 */
export interface TaskSnapshot {
  readonly task: Readonly<Task>
}

export interface TaskQueueStats {
  total: number
  byStatus: Record<TaskStatus, number>
  running: number
  queued: number
  capacity: number
  perGroup: Record<string, number>
}
