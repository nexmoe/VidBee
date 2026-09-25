import type { TaskCreationMetadata } from '@vidbee/task-queue'
import { atom } from 'jotai'
import { ipcServices } from '../lib/ipc'
import { applyTranscriptSnapshot, mergeTranscriptMaps } from '../lib/transcript-library'

export type TranscriptListState =
  | 'none'
  | 'queued'
  | 'running'
  | 'completed'
  | 'no-speech'
  | 'failed'
  | 'cancelled'
  | 'retry-scheduled'

export interface TranscriptSpeakerView {
  id: string
  speakerKey: string
  displayName: string
  sortIndex: number
}

export interface TranscriptWordView {
  endMs: number
  startMs: number
  text: string
}

export interface TranscriptSegmentView {
  id: string
  speakerId: string | null
  startMs: number
  endMs: number
  text: string
  words?: TranscriptWordView[]
  confidence: number | null
  sortIndex: number
}

export interface TranscriptSnapshotView {
  creation?: TaskCreationMetadata
  downloadTaskId: string
  transcriptionTaskId: string | null
  transcriptId: string | null
  listState: TranscriptListState
  stage: string | null
  stageHistory?: Array<{ stage: string; startedAt: number }>
  error: string | null
  sourceFilePath: string | null
  title?: string | null
  updatedAt?: number
  asrTier?: string | null
  speakerCount?: import('@vidbee/transcription/asr').SpeakerCount
  sourceKind?: 'asr' | 'captions' | null
  /** True while a speaker overlay task is queued or running. Recognition is not re-run. */
  rediarize?: boolean
  sources?: Array<{
    auto: boolean
    key: string
    kind: 'asr' | 'captions'
    language: string | null
    languageCode: string | null
    selected: boolean
  }>
  record: {
    id: string
    resultKind: 'transcript' | 'no-speech'
    asrTier?: string | null
    language?: string | null
    modelVersion?: string
    createdAt?: number
    speakers: TranscriptSpeakerView[]
    segments: TranscriptSegmentView[]
  } | null
}

export const transcriptMapAtom = atom<Record<string, TranscriptSnapshotView>>({})

export const upsertTranscriptAtom = atom(null, (get, set, snapshot: TranscriptSnapshotView) => {
  set(transcriptMapAtom, applyTranscriptSnapshot(get(transcriptMapAtom), snapshot))
})

export const loadTranscriptMapAtom = atom(null, async (get, set) => {
  const map = (await ipcServices.transcript.getStatusMap()) as Record<
    string,
    TranscriptSnapshotView
  >
  set(transcriptMapAtom, mergeTranscriptMaps(get(transcriptMapAtom), map))
})
