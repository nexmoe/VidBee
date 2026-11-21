// Types entry only — the package barrel evaluates Node process helpers and
// crashes the desktop renderer (`node:child_process` is browser-external).
import { canAdmitTranscription, TRANSCRIPTION_GROUP_KEY } from '@vidbee/task-queue/types'

export { canAdmitTranscription }

export const DEFAULT_MAX_CONCURRENT_TRANSCRIPTIONS = 1
export const MAX_CONCURRENT_TRANSCRIPTIONS = 4
export const CONCURRENT_TRANSCRIPTION_CHOICES = [1, 2, 3, 4] as const

const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 5
const MAX_CONCURRENT_DOWNLOADS = 10

export interface TranscriptionConcurrencyQueue {
  setMaxConcurrency: (n: number) => Promise<void> | void
  setMaxPerGroup: (groupKey: string, n: number | null) => Promise<void> | void
  setMaxConcurrentDownloads: (n: number) => Promise<void> | void
}

/**
 * Clamp a stored download concurrency value to the supported range.
 *
 * @param value Raw setting value from storage or UI.
 * @returns An integer between 1 and 10.
 */
const clampMaxConcurrentDownloads = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) {
    return DEFAULT_MAX_CONCURRENT_DOWNLOADS
  }
  return Math.min(MAX_CONCURRENT_DOWNLOADS, Math.max(1, n))
}

/**
 * Clamp a stored transcription concurrency value to the supported range.
 *
 * @param value Raw setting value from storage or UI.
 * @returns An integer between 1 and 4.
 */
export const clampMaxConcurrentTranscriptions = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) {
    return DEFAULT_MAX_CONCURRENT_TRANSCRIPTIONS
  }
  return Math.min(MAX_CONCURRENT_TRANSCRIPTIONS, Math.max(DEFAULT_MAX_CONCURRENT_TRANSCRIPTIONS, n))
}

/**
 * Apply download and transcription caps so both limits are honored.
 *
 * Global slots stay large enough for the higher of the two caps. Transcription
 * tasks still share one group, so they cannot exceed the transcript setting.
 * A new ASR task also waits while active downloads are at the download cap and
 * starts once a download slot frees. Lowering the cap does not stop jobs that
 * are already running.
 *
 * @param input Queue plus the two stored concurrency settings.
 */
export const applyTranscriptionConcurrency = (input: {
  queue: TranscriptionConcurrencyQueue
  maxConcurrentDownloads: unknown
  maxConcurrentTranscriptions: unknown
}): void => {
  const downloads = clampMaxConcurrentDownloads(input.maxConcurrentDownloads)
  const transcriptions = clampMaxConcurrentTranscriptions(input.maxConcurrentTranscriptions)
  void input.queue.setMaxConcurrency(Math.max(downloads, transcriptions))
  void input.queue.setMaxPerGroup(TRANSCRIPTION_GROUP_KEY, transcriptions)
  void input.queue.setMaxConcurrentDownloads(downloads)
}
