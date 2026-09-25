import type { GpuKind, OsKind } from './asr-recommend'
import type { AsrFamily, AsrTierId, MachineClass } from './asr-tiers'
import type { SpeakerCount } from './speaker-count'

export type TranscriptResultKind = 'transcript' | 'no-speech'

/** Where a finished transcript came from: local ASR or downloaded video captions. */
export type TranscriptSourceKind = 'asr' | 'captions'

/** One captions-language or ASR choice on the transcript page. */
export interface TranscriptSourceOption {
  auto: boolean
  key: string
  kind: TranscriptSourceKind
  language: string | null
  languageCode: string | null
  selected: boolean
}

export type TranscriptionTrigger = 'manual' | 'auto' | 'force'

export type TranscriptionStage =
  | 'preparing-models'
  | 'preparing-audio'
  | 'detecting-speech'
  | 'diarizing'
  | 'recognizing'
  | 'committing'

/** One pipeline stage with the wall-clock time it started. */
export interface TranscriptStageTiming {
  stage: string
  startedAt: number
}

export interface TranscriptSpeaker {
  id: string
  speakerKey: string
  displayName: string
  sortIndex: number
}

export interface TranscriptWord {
  endMs: number
  startMs: number
  text: string
}

export interface TranscriptSegment {
  id: string
  speakerId: string | null
  startMs: number
  endMs: number
  text: string
  words: TranscriptWord[]
  confidence: number | null
  sortIndex: number
}

export interface TranscriptRecord {
  id: string
  downloadTaskId: string
  transcriptionTaskId: string
  resultKind: TranscriptResultKind
  modelVersion: string
  asrTier: string | null
  language: string | null
  sourceFilePath: string | null
  sourceKind: TranscriptSourceKind
  supersededAt: number | null
  createdAt: number
  updatedAt: number
  speakers: TranscriptSpeaker[]
  segments: TranscriptSegment[]
}

export interface TranscriptSummary {
  downloadTaskId: string
  transcriptionTaskId: string | null
  transcriptId: string | null
  resultKind: TranscriptResultKind | null
  taskStatus: string | null
  stage: TranscriptionStage | null
}

export interface TranscriptionTaskOptions {
  downloadTaskId: string
  sourceFilePath: string
  trigger: TranscriptionTrigger
  skipVad?: boolean
  asrTier?: string
  /** UI/task language used for Chinese script and speaker-embedding choice. */
  language?: string
  /** Auto unless the user pinned a count when re-running diarization. */
  speakerCount?: SpeakerCount
  /** Re-cluster speakers on an existing ASR or captions transcript; skip recognition. */
  rediarize?: boolean
}

export interface PipelineSpeaker {
  speakerKey: string
  displayName: string
}

export interface PipelineSegment {
  speakerKey: string | null
  startMs: number
  endMs: number
  text: string
  words?: TranscriptWord[]
  confidence: number | null
}

export interface PipelineResult {
  resultKind: TranscriptResultKind
  language: string | null
  modelVersion: string
  asrTier: string | null
  sourceKind?: TranscriptSourceKind
  speakers: PipelineSpeaker[]
  segments: PipelineSegment[]
}

export interface PipelineProgress {
  stage: TranscriptionStage
  percent: number | null
  message?: string
}

export type ModelRole =
  | 'vad'
  | 'segmentation'
  | 'embedding'
  | 'asr-encoder'
  | 'asr-decoder'
  | 'asr-frontend'
  | 'asr-tokenizer'
  | 'asr-tokens'
  | 'asr-model'
  | 'asr-joiner'
  | 'asr-extra'
  | 'punctuation'

export type ModelGroup = 'vad' | 'speaker' | 'asr' | 'punct'

export interface ModelFileSpec {
  id: string
  role: ModelRole
  group: ModelGroup
  /** ASR model this file belongs to. Shared VAD/speaker files omit this. */
  tier?: AsrTierId
  /** Path relative to the models directory after download/extract. */
  fileName: string
  url: string
  sha256?: string
  required: boolean
}

export interface AsrTierStatus {
  id: AsrTierId
  family: AsrFamily
  ready: boolean
  bytes: number
  qualityRank: number
}

export interface MachineProfileStatus {
  arch: string
  class: MachineClass
  cpuCount: number
  gpu: GpuKind
  gpuName: string | null
  os: OsKind
  ramBytes: number
}

export interface ModelDownloadProgress {
  url: string
  received: number
  total: number | null
  /** ASR model this transfer belongs to, when known. */
  tier?: AsrTierId
}

export interface ModelStatus {
  /** Queue-owned downloads that should stay visible while waiting for a worker. */
  pendingTiers?: AsrTierId[]
  ready: boolean
  version: string
  bytes: number
  files: Array<{ id: string; present: boolean; path: string; bytes: number }>
  tiers: AsrTierStatus[]
  downloading: ModelDownloadProgress | null
  downloads: ModelDownloadProgress[]
  machine?: MachineProfileStatus
  recommended?: AsrTierId[]
  language?: string
}

export const DEFAULT_MODEL_VERSION = 'vidbee-asr-2026.08.20-3'
