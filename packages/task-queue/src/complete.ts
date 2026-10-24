/**
 * Kind-specific success guards for `running/processing → completed`.
 *
 * Download tasks still require a non-empty output file; subtitle tasks also
 * require their committed transcript. Transcription tasks
 * require a committed transcript or explicit no-speech result — never a
 * media file check.
 */
import type { TaskKind, TaskOutput } from './types'

export interface OutputCompleteCheck {
  filePresent: (path: string) => boolean
}

export function isOutputComplete(
  kind: TaskKind,
  output: TaskOutput,
  check: OutputCompleteCheck
): boolean {
  if (kind === 'transcription') {
    const result = output.transcript
    return Boolean(
      result?.transcriptId &&
        (result.resultKind === 'transcript' || result.resultKind === 'no-speech')
    )
  }
  if (
    kind === 'subtitles' &&
    !(output.transcript?.resultKind === 'transcript' && output.transcript.transcriptId)
  ) {
    return false
  }
  return Boolean(output.filePath) && output.size > 0 && check.filePresent(output.filePath)
}
