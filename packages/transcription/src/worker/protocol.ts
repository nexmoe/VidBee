import { existsSync, readFileSync, writeSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { AsrTierId } from '../asr-tiers'
import type { SherpaExecutionProvider } from '../compute-provider'
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
  provider: SherpaExecutionProvider
  language?: string
  speakerCount?: SpeakerCount
  /** Path to a previous ASR seed so the worker can skip recognition. */
  existingTranscriptPath?: string
}

export interface WorkerProbeMessage {
  type: 'probe'
  modelsDir: string
  asrTier?: AsrTierId
  benchmark?: boolean
  provider?: SherpaExecutionProvider
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
  durationMs?: number
  provider?: SherpaExecutionProvider
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

const PIPE_DRAIN_WAIT = new Int32Array(new SharedArrayBuffer(4))
const PIPE_DRAIN_MS = 1

/**
 * True when a non-blocking pipe write would block.
 *
 * Node sets stdout to non-blocking when it is a pipe, so `writeSync` throws
 * `EAGAIN` once the ~64KB buffer fills instead of waiting for the parent.
 *
 * @param error Caught filesystem error.
 */
const isUnavailableWrite = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false
  }
  const code = (error as { code: unknown }).code
  return code === 'EAGAIN' || code === 'EWOULDBLOCK'
}

/**
 * Park briefly so the parent can drain stdout. A tight spin keeps the pipe
 * full and burns CPU; the parent lives in another process and can read while
 * we wait.
 */
const waitForWritablePipe = (): void => {
  Atomics.wait(PIPE_DRAIN_WAIT, 0, 0, PIPE_DRAIN_MS)
}

interface StdoutHandle {
  setBlocking?: (blocking: boolean) => void
}

/**
 * Make stdout a blocking pipe. `writeSync` on a non-blocking pipe throws
 * `EAGAIN: resource temporarily unavailable, write` when a long transcript
 * streams partials faster than Electron can drain.
 */
export const setStdoutBlocking = (): void => {
  const handle = (process.stdout as { _handle?: StdoutHandle })._handle
  handle?.setBlocking?.(true)
}

/**
 * Write one newline-delimited protocol message, retrying short and EAGAIN
 * pipe writes. A single writeSync of a multi-MB result can return 64KB and
 * drop the rest; a full pipe throws instead of blocking.
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
    let n: number
    try {
      n = write(fd, payload, offset, payload.length - offset)
    } catch (error) {
      if (isUnavailableWrite(error)) {
        waitForWritablePipe()
        continue
      }
      throw error
    }
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
