/**
 * Legacy `DownloadTask` projection.
 *
 * Renderer / SDK / web client speak the pre-task-queue vocabulary
 * (`pending / downloading / processing / completed / error / cancelled`).
 * This module is the single place that maps internal `TaskStatus` →
 * legacy `DownloadStatus`, plus the augmented sub-status fields that let
 * UI distinguish `paused` and `retry-scheduled` from a generic `pending`.
 *
 * Reference: NEX-131 issue body §C, design doc §10.A.5.
 *
 * Rules:
 *   - Projection is one-way: hosts MUST NOT use legacy fields to write
 *     status back into a Task.
 *   - Projection has no host-specific knowledge: shared across Desktop,
 *     Web/API and CLI so all three render the same task identically.
 *   - The output shape intentionally avoids importing `@vidbee/downloader-core`
 *     to prevent a workspace cycle. Adapters narrow to their local
 *     `DownloadTask` type by spreading.
 */
import type {
  ClassifiedError,
  ErrorCategory,
  Task,
  TaskOutput,
  TaskProgress,
  TaskStatus
} from '../types'
import { TERMINAL_STATUSES } from '../types'

/**
 * Legacy status kept for renderer / web client back-compat.
 */
export type LegacyDownloadStatus =
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error'
  | 'cancelled'

/**
 * Sub-status for the buckets where multiple internal statuses collapse onto
 * the same legacy status. UIs that opt-in can show a richer label
 * ("Paused" / "Retrying in 23s") instead of a flat "pending".
 */
export type LegacySubStatus = 'queued' | 'paused' | 'retry-scheduled'

export interface LegacyDownloadProgress {
  percent: number
  currentSpeed?: string
  eta?: string
  downloaded?: string
  total?: string
}

/**
 * Shape consumed by the renderer/web client. Intentionally a superset of
 * the historical `DownloadTask` shape — adapters spread this onto the
 * local `DownloadTask` and drop fields the local host does not surface.
 */
export interface LegacyTaskProjection {
  id: string
  url: string
  title?: string
  thumbnail?: string
  /** Legacy `type` field. Derived from TaskKind: audio for `audio`, video otherwise. */
  type: 'video' | 'audio'
  status: LegacyDownloadStatus
  /** Internal status kept verbatim so callers that DO know about task-queue
   *  can branch without re-reading `task.status`. */
  internalStatus: TaskStatus
  /** Set when multiple internal statuses collapse onto one legacy status. */
  subStatus?: LegacySubStatus
  /** Mirror of `task.statusReason` (e.g. 'crash-recovery', 'retry-after-stalled'). */
  statusReason?: string | null
  createdAt: number
  startedAt?: number
  completedAt?: number
  duration?: number
  fileSize?: number
  speed?: string
  downloadPath?: string
  savedFileName?: string
  /**
   * yt-dlp's resolved format id (e.g. `30080+30280`). Hosts compare against
   * the user's pick to detect that the chain fell back to best-available.
   */
  resolvedFormatId?: string
  subtitleStatus?: TaskOutput['subtitleStatus']
  subtitleLanguages?: string[]
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: string[]
  playlistId?: string
  playlistTitle?: string
  playlistIndex?: number
  playlistSize?: number
  progress?: LegacyDownloadProgress
  error?: string
  /** Set when status === 'error'. */
  errorCategory?: ErrorCategory
  /** ms epoch; only present when internalStatus === 'retry-scheduled'. */
  nextRetryAt?: number
  /** Current attempt number (0-indexed). */
  attempt?: number
  maxAttempts?: number
  /** i18n key describing the user-facing message for the last error. */
  uiMessageKey?: string
}

/**
 * Map an internal `TaskStatus` to the legacy `DownloadStatus`. Pure;
 * shared by Desktop/API/CLI to guarantee identical rendering.
 */
export function legacyDownloadStatusOf(status: TaskStatus): LegacyDownloadStatus {
  switch (status) {
    case 'queued':
      return 'pending'
    case 'running':
      return 'downloading'
    case 'processing':
      return 'processing'
    case 'paused':
      return 'pending'
    case 'retry-scheduled':
      return 'pending'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    default:
      return status
  }
}

/**
 * Map an internal status to its legacy sub-status, if any. Returns undefined
 * for statuses that map 1-to-1 onto a legacy status.
 */
export function legacySubStatusOf(status: TaskStatus): LegacySubStatus | undefined {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'paused':
      return 'paused'
    case 'retry-scheduled':
      return 'retry-scheduled'
    default:
      return undefined
  }
}

interface MaybeHostFields {
  /** Legacy host metadata stashed in `Task.input.options` by adapters. */
  description?: string
  channel?: string
  uploader?: string
  viewCount?: number
  tags?: readonly string[]
  duration?: number
  playlistTitle?: string
  playlistSize?: number
  fileSize?: number
  startedAt?: number
  completedAt?: number
  downloadPath?: string
}

/**
 * Project a Task into the legacy shape. Host adapters call this and then
 * narrow to their concrete `DownloadTask` type.
 *
 * Pure; no I/O, no clock reads.
 */
export function projectTaskToLegacy(task: Readonly<Task>): LegacyTaskProjection {
  const status = legacyDownloadStatusOf(task.status)
  const subStatus = legacySubStatusOf(task.status)
  const opts = (task.input.options ?? {}) as MaybeHostFields
  const proj: LegacyTaskProjection = {
    id: task.id,
    url: task.input.url,
    title: task.input.title,
    thumbnail: task.input.thumbnail,
    type: task.kind === 'audio' ? 'audio' : 'video',
    status,
    internalStatus: task.status,
    statusReason: task.statusReason,
    createdAt: task.createdAt,
    description: opts.description,
    channel: opts.channel,
    uploader: opts.uploader,
    viewCount: opts.viewCount,
    tags: opts.tags ? [...opts.tags] : undefined,
    duration: opts.duration,
    playlistId: task.input.playlistId,
    playlistTitle: opts.playlistTitle,
    playlistIndex: task.input.playlistIndex,
    playlistSize: opts.playlistSize,
    fileSize: opts.fileSize,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt ?? (TERMINAL_STATUSES.has(task.status) ? task.enteredStatusAt : undefined),
    downloadPath: opts.downloadPath,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts
  }

  if (subStatus) {
    proj.subStatus = subStatus
  }

  // Progress is meaningful for running/processing AND for paused/retry, where
  // we want the UI to remember "you were 47% in" rather than reset to 0.
  if (task.progress.percent != null || task.progress.bytesDownloaded != null) {
    proj.progress = projectProgress(task.progress)
    if (task.progress.speedBps != null) {
      proj.speed = formatSpeed(task.progress.speedBps)
    }
  }

  if (task.output) {
    const out = task.output as TaskOutput
    proj.fileSize = out.size
    proj.savedFileName = basenameOf(out.filePath)
    proj.downloadPath = dirnameOf(out.filePath)
    if (out.durationMs != null) {
      proj.duration = Math.round(out.durationMs / 1000)
    }
    if (out.formatId) {
      proj.resolvedFormatId = out.formatId
    }
    if (out.subtitleStatus) {
      proj.subtitleStatus = out.subtitleStatus
    }
    if (out.subtitleLanguages) {
      proj.subtitleLanguages = [...out.subtitleLanguages]
    }
  }

  if (task.lastError) {
    const err = task.lastError as ClassifiedError
    proj.errorCategory = err.category
    proj.uiMessageKey = err.uiMessageKey
    if (status === 'error') {
      proj.error = err.rawMessage
    }
  }

  if (task.status === 'retry-scheduled' && task.nextRetryAt != null) {
    proj.nextRetryAt = task.nextRetryAt
  }

  return proj
}

function projectProgress(p: Readonly<TaskProgress>): LegacyDownloadProgress {
  const percent = p.percent == null ? 0 : Math.max(0, Math.min(100, p.percent * 100))
  return {
    percent,
    currentSpeed: p.speedBps == null ? undefined : formatSpeed(p.speedBps),
    eta: p.etaMs == null ? undefined : formatEta(p.etaMs),
    downloaded: p.bytesDownloaded == null ? undefined : formatBytes(p.bytesDownloaded),
    total: p.bytesTotal == null ? undefined : formatBytes(p.bytesTotal)
  }
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n}B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(2)}${units[i]}`
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`
}

function formatEta(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }
  return `${m}:${String(r).padStart(2, '0')}`
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function dirnameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(0, i) : ''
}
