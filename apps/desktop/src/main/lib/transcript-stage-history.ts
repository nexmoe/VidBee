import type { Task } from '@vidbee/task-queue'
import type { TranscriptionStage, TranscriptStageTiming } from '@vidbee/transcription'

/** Restore queue and pipeline clocks from persisted task state before worker stages exist. */
export function transcriptStageHistory(
  task: Pick<Task, 'status' | 'enteredStatusAt'> | undefined,
  stage: TranscriptionStage | null,
  history: TranscriptStageTiming[] = []
): TranscriptStageTiming[] {
  if (!task) {
    return history
  }
  if (task.status === 'queued' || task.status === 'retry-scheduled') {
    return [{ stage: task.status, startedAt: task.enteredStatusAt }]
  }
  if (history.length > 0) {
    return history
  }
  if (task.status === 'running' || task.status === 'processing' || task.status === 'paused') {
    return [{ stage: stage ?? 'preparing-audio', startedAt: task.enteredStatusAt }]
  }
  return []
}
