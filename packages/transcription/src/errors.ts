import { type ClassifiedError, type ErrorCategory, virtualError } from '@vidbee/task-queue'

/** Thrown when the source media has no audio track to decode. */
export const NO_AUDIO_STREAM_ERROR = 'source has no audio stream'

/**
 * Build a classified transcription error from a category and message.
 *
 * @param category Task-queue error category.
 * @param message Raw worker or ffmpeg message.
 */
export function transcriptionError(category: ErrorCategory, message: string): ClassifiedError {
  return virtualError(category, message)
}

/**
 * True when ffmpeg/ffprobe failed because the media has no audio track.
 *
 * @param message Worker, ffmpeg, or ffprobe error text.
 */
export function isNoAudioStreamError(message: string): boolean {
  return message.includes(NO_AUDIO_STREAM_ERROR) || /does not contain any stream/i.test(message)
}

/**
 * Map a transcription worker failure onto a classified task-queue error.
 *
 * @param err Thrown value from extract, pipeline, or worker protocol.
 */
export function classifyTranscriptionFailure(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (/enospc|no space left/i.test(message)) {
    return transcriptionError('disk-full', message)
  }
  if (/eacces|eperm|permission denied/i.test(message)) {
    return transcriptionError('permission-denied', message)
  }
  if (/ffmpeg|ffprobe/i.test(message) && /not found|enoent/i.test(lower)) {
    return transcriptionError('binary-missing', message)
  }
  if (isNoAudioStreamError(message)) {
    return { ...transcriptionError('ffmpeg', message), retryable: false }
  }
  if (/ffmpeg|conversion failed/i.test(message)) {
    return transcriptionError('ffmpeg', message)
  }
  if (/enoent|no such file|source file missing|file not found/i.test(lower)) {
    return transcriptionError('not-found', message)
  }
  if (/econnreset|etimedout|enotfound|socket hang up|http error 5|network/i.test(lower)) {
    return transcriptionError('network-transient', message)
  }
  if (/sherpa-onnx|model missing|model not ready|incomplete model|native addon/i.test(lower)) {
    return transcriptionError('binary-missing', message)
  }
  return transcriptionError('unknown', message)
}
