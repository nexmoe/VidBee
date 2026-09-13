import { mediaKindFromName } from '@vidbee/ui/lib/ingest'

export type SourceMediaKind = 'audio' | 'video'

/**
 * Classify a download as audio-only or video from the same signals the player uses.
 */
export function sourceMediaKind(input: {
  type?: string | null
  filePath?: string | null
  savedFileName?: string | null
  url?: string | null
}): SourceMediaKind {
  if (input.type === 'audio') {
    return 'audio'
  }
  for (const name of [input.filePath, input.savedFileName, input.url]) {
    if (name && mediaKindFromName(name) === 'audio') {
      return 'audio'
    }
  }
  return 'video'
}

/** Turn a missing-video-stream failure into a non-retryable tool error. */
export function agentUnusableVideoError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (
    /does not contain any stream|matches no streams|Output file is empty|Media output is empty/i.test(
      message
    )
  ) {
    return new Error(
      'This source has no usable video frames. Write a text-only answer and do not retry capture_frames or create_clip.'
    )
  }
  return error instanceof Error ? error : new Error(message)
}
