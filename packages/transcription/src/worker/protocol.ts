import { existsSync, readFileSync, writeSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { AsrTierId } from '../asr-tiers'
import type { SpeakerCount } from '../speaker-count'
import type { PipelineProgress, PipelineResult, TranscriptionStage, TranscriptWord } from '../types'

/** Worker writes the finished pipeline payload here so stdout stays small. */
export const WORKER_RESULT_FILE = 'pipeline-result.json'

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
  /** Inline payload for tests and tiny fixtures. Production workers use resultPath. */
  result?: PipelineResult
  /** File under workDir (or an absolute path) written by the worker. */
  resultPath?: string
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

export type SyncWrite = (
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset?: number,
  length?: number
) => number

/**
 * Write one newline-delimited protocol message, retrying short pipe writes.
 * A single writeSync of a multi-MB result can return 64KB and drop the rest.
 *
 * @param fd Destination file descriptor (usually stdout).
 * @param message Protocol payload.
 * @param write Test seam for short writes; defaults to fs.writeSync.
 */
export const writeMessageSync = (
  fd: number,
  message: unknown,
  write: SyncWrite = writeSync
): void => {
  const payload = Buffer.from(encodeMessage(message), 'utf8')
  let offset = 0
  while (offset < payload.length) {
    const n = write(fd, payload, offset, payload.length - offset)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`stdout write failed at ${offset}/${payload.length}`)
    }
    offset += n
  }
}

/**
 * Resolve a worker result from an inline payload or the file the worker wrote.
 *
 * @param message Result protocol message.
 * @param workDir Worker work directory used when resultPath is relative.
 */
export const readWorkerResult = (message: WorkerResultMessage, workDir: string): PipelineResult => {
  if (message.result) {
    return message.result
  }
  const filePath = message.resultPath
    ? isAbsolute(message.resultPath)
      ? message.resultPath
      : join(workDir, message.resultPath)
    : join(workDir, WORKER_RESULT_FILE)
  if (!existsSync(filePath)) {
    throw new Error(`worker result missing: ${filePath}`)
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as PipelineResult
}

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
