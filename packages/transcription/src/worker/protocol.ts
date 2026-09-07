import type { AsrTierId } from '../asr-tiers'
import type { SpeakerCount } from '../speaker-count'
import type { PipelineProgress, TranscriptionStage, TranscriptWord } from '../types'

export const WORKER_RESULT_FILE = 'result.json'

export interface WorkerStartMessage {
  type: 'start'
  taskId: string
  attemptId: string
  sourceFilePath: string
  ffmpegPath: string
  workDir: string
  modelsDir: string
  skipVad: boolean
  autoSkipAllowed: boolean
  backend: 'sherpa' | 'fake'
  fingerprint: string
  modelVersion: string
  asrTier: AsrTierId
  language?: string
  speakerCount?: SpeakerCount
  /** Path to a previous ASR seed so the worker can skip recognition. */
  existingTranscriptPath?: string
}

export interface WorkerProbeMessage {
  type: 'probe'
  modelsDir: string
}

export interface WorkerCancelMessage {
  type: 'cancel'
}

export type WorkerInbound = WorkerStartMessage | WorkerProbeMessage | WorkerCancelMessage

export interface WorkerProgressMessage {
  type: 'progress'
  stage: TranscriptionStage
  percent: number | null
  message?: string
}

export interface WorkerPartialMessage {
  type: 'partial'
  speakerKey: string | null
  startMs: number
  endMs: number
  text: string
  words?: TranscriptWord[]
}

export interface WorkerResultMessage {
  type: 'result'
  durationMs: number
}

export interface WorkerErrorMessage {
  type: 'error'
  message: string
}

export interface WorkerLogMessage {
  type: 'log'
  stream: 'stdout' | 'stderr'
  line: string
}

export interface WorkerProbeOkMessage {
  type: 'probe-ok'
}

export type WorkerOutbound =
  | WorkerProgressMessage
  | WorkerPartialMessage
  | WorkerResultMessage
  | WorkerErrorMessage
  | WorkerLogMessage
  | WorkerProbeOkMessage

export const encodeMessage = (message: unknown): string => `${JSON.stringify(message)}\n`

export const parseMessage = <T>(line: string): T | null => {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

export type { PipelineProgress }
