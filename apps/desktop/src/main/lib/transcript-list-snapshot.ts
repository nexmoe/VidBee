import type { Task, TaskCreationMetadata } from '@vidbee/task-queue'
import {
  type AsrTierId,
  DEFAULT_ASR_TIER,
  DEFAULT_SPEAKER_COUNT,
  isAsrTierId,
  parseAsrTier,
  parseSpeakerCount,
  readTranscriptionOptions,
  type SpeakerCount,
  type TranscriptHead,
  type TranscriptionStage,
  type TranscriptSourceKind,
  type TranscriptSourceOption,
  type TranscriptStageTiming
} from '@vidbee/transcription'
import { readTaskCreation } from './projection'

export type TranscriptListState =
  | 'none'
  | 'queued'
  | 'running'
  | 'completed'
  | 'no-speech'
  | 'failed'
  | 'cancelled'
  | 'retry-scheduled'

/** List row stored for one download. Caption text and word timestamps are absent. */
export interface TranscriptListRecord {
  asrTier: string | null
  createdAt: number
  id: string
  language: string | null
  modelVersion: string
  resultKind: 'transcript' | 'no-speech'
  sourceKind: TranscriptSourceKind
  updatedAt: number
}

/** Status-map and `transcript:updated` payload. `sources` stay on the detail snapshot. */
export interface TranscriptListSnapshot {
  asrTier: AsrTierId | null
  creation?: TaskCreationMetadata
  downloadTaskId: string
  error: string | null
  listState: TranscriptListState
  record: TranscriptListRecord | null
  rediarize: boolean
  sourceFilePath: string | null
  sourceKind: TranscriptSourceKind | null
  speakerCount: SpeakerCount
  stage: TranscriptionStage | null
  stageHistory: TranscriptStageTiming[]
  title: string | null
  transcriptId: string | null
  transcriptionTaskId: string | null
  updatedAt: number
}

/**
 * True when this transcription child is relabeling speakers, not running ASR.
 *
 * @param task Active or latest transcription child.
 */
export const isRediarizeTask = (task: Task | undefined): boolean =>
  Boolean(task && readTranscriptionOptions(task.input)?.rediarize)

/**
 * Keep an existing transcript visible when a speaker overlay ends without a new commit.
 *
 * @param task Latest transcription child.
 * @param record Current stored transcript, if any.
 */
const listStateFromFinishedRediarize = (
  task: Task,
  record: { resultKind: string } | null
): TranscriptListState | null => {
  if (!(isRediarizeTask(task) && record)) {
    return null
  }
  if (record.resultKind === 'no-speech') {
    return 'no-speech'
  }
  if (record.resultKind === 'transcript') {
    return 'completed'
  }
  return null
}

/**
 * Compact library status from the active task and the listed transcript head.
 *
 * @param task Active or latest transcription child.
 * @param record Selected head, or the latest head when the selected source has no row.
 */
export const listStateOf = (
  task: Task | undefined,
  record: { resultKind: string } | null
): TranscriptListState => {
  if (task) {
    if (task.status === 'queued') {
      return 'queued'
    }
    if (task.status === 'paused') {
      return task.statusReason === 'crash-recovery' ? 'running' : 'queued'
    }
    if (task.status === 'running' || task.status === 'processing') {
      return 'running'
    }
    if (task.status === 'retry-scheduled') {
      return 'retry-scheduled'
    }
    if (task.status === 'failed') {
      return listStateFromFinishedRediarize(task, record) ?? 'failed'
    }
    if (task.status === 'cancelled') {
      return listStateFromFinishedRediarize(task, record) ?? 'cancelled'
    }
    if (task.status === 'completed') {
      const kind = task.output?.transcript?.resultKind ?? record?.resultKind
      return kind === 'no-speech' ? 'no-speech' : 'completed'
    }
  }
  if (record?.resultKind === 'no-speech') {
    return 'no-speech'
  }
  if (record?.resultKind === 'transcript') {
    return 'completed'
  }
  return 'none'
}

/**
 * Map a running task's status reason onto a pipeline stage.
 *
 * @param task Active or latest transcription child.
 */
export const stageFromTask = (task: Task | undefined): TranscriptionStage | null => {
  if (!task || (task.status !== 'running' && task.status !== 'processing')) {
    return null
  }
  const reason = task.statusReason
  if (
    reason === 'preparing-models' ||
    reason === 'preparing-audio' ||
    reason === 'detecting-speech' ||
    reason === 'diarizing' ||
    reason === 'recognizing' ||
    reason === 'committing'
  ) {
    return reason
  }
  return task.status === 'processing' ? 'committing' : 'recognizing'
}

/**
 * Copy the selected head into the list record. Bodies are not included.
 *
 * @param head Selected transcript head, or null when that source has no row.
 */
export const listRecordFromHead = (head: TranscriptHead | null): TranscriptListRecord | null => {
  if (!head) {
    return null
  }
  return {
    asrTier: head.asrTier,
    createdAt: head.createdAt,
    id: head.id,
    language: head.language,
    modelVersion: head.modelVersion,
    resultKind: head.resultKind,
    sourceKind: head.sourceKind,
    updatedAt: head.updatedAt
  }
}

/** Fields shared by a full snapshot and its list projection. */
interface TranscriptSnapshotCore {
  asrTier: AsrTierId | null
  creation?: TaskCreationMetadata
  downloadTaskId: string
  error: string | null
  listState: TranscriptListState
  record: {
    asrTier: string | null
    createdAt: number
    id: string
    language: string | null
    modelVersion: string
    resultKind: 'transcript' | 'no-speech'
    sourceKind: TranscriptSourceKind
    updatedAt: number
  } | null
  rediarize: boolean
  sourceFilePath: string | null
  sourceKind: TranscriptSourceKind | null
  speakerCount: SpeakerCount
  stage: TranscriptionStage | null
  stageHistory: TranscriptStageTiming[]
  title: string | null
  transcriptId: string | null
  transcriptionTaskId: string | null
  updatedAt: number
}

/**
 * Drop caption bodies and source options before a snapshot crosses IPC.
 *
 * @param snapshot Full in-process snapshot. `record.segments` are ignored.
 */
export const toTranscriptListSnapshot = (
  snapshot: TranscriptSnapshotCore
): TranscriptListSnapshot => ({
  asrTier: snapshot.asrTier,
  creation: snapshot.creation,
  downloadTaskId: snapshot.downloadTaskId,
  error: snapshot.error,
  listState: snapshot.listState,
  record: snapshot.record
    ? {
        asrTier: snapshot.record.asrTier,
        createdAt: snapshot.record.createdAt,
        id: snapshot.record.id,
        language: snapshot.record.language,
        modelVersion: snapshot.record.modelVersion,
        resultKind: snapshot.record.resultKind,
        sourceKind: snapshot.record.sourceKind,
        updatedAt: snapshot.record.updatedAt
      }
    : null,
  rediarize: snapshot.rediarize,
  sourceFilePath: snapshot.sourceFilePath,
  sourceKind: snapshot.sourceKind,
  speakerCount: snapshot.speakerCount,
  stage: snapshot.stage,
  stageHistory: snapshot.stageHistory,
  title: snapshot.title,
  transcriptId: snapshot.transcriptId,
  transcriptionTaskId: snapshot.transcriptionTaskId,
  updatedAt: snapshot.updatedAt
})

/** Resolved view used to build either a full snapshot or a list snapshot. */
export interface TranscriptViewModel {
  active: Task | undefined
  download: Task | undefined
  downloadTaskId: string
  latest: TranscriptHead | null
  selected: TranscriptHead | null
  sourceFilePath: string | null
  sources: TranscriptSourceOption[]
  task: Task | undefined
  title: string | null
}

/**
 * Build the library payload from heads already chosen by `resolveTranscriptHeads`.
 *
 * @param view Selection, task, and display fields. No segment rows.
 * @param stage Live stage, if the task is running.
 * @param stageHistory Stage clock for the thinking steps.
 */
export const buildTranscriptListSnapshot = (
  view: TranscriptViewModel,
  stage: TranscriptionStage | null,
  stageHistory: TranscriptStageTiming[]
): TranscriptListSnapshot => {
  const listed = view.selected ?? view.latest
  const selectedOption = view.sources.find((item) => item.selected)
  const asrSource = view.selected
  return {
    asrTier: isAsrTierId(asrSource?.asrTier)
      ? asrSource.asrTier
      : parseAsrTier(view.task?.input.options?.asrTier, DEFAULT_ASR_TIER),
    creation: view.task ? readTaskCreation(view.task) : undefined,
    downloadTaskId: view.downloadTaskId,
    error: view.task?.lastError?.rawMessage ?? null,
    listState: listStateOf(view.task, listed),
    record: listRecordFromHead(view.selected),
    rediarize: isRediarizeTask(view.active),
    sourceFilePath: view.sourceFilePath,
    sourceKind: selectedOption?.kind ?? view.selected?.sourceKind ?? (view.task ? 'asr' : null),
    speakerCount: parseSpeakerCount(view.task?.input.options?.speakerCount, DEFAULT_SPEAKER_COUNT),
    stage,
    stageHistory,
    title: view.title,
    transcriptId: view.selected?.id ?? null,
    transcriptionTaskId: view.task?.id ?? listed?.transcriptionTaskId ?? null,
    updatedAt: Math.max(view.task?.updatedAt ?? 0, listed?.updatedAt ?? 0)
  }
}
