/**
 * Isolated AI worker. Loaded only in a child process so sherpa-onnx-node
 * cannot stall the Electron / API event loop.
 */
import { join } from 'node:path'
import { readAsrResult } from '../asr-json'
import { tryRecognizerConfig } from '../asr-recognizer'
import { ASR_TIER_IDS } from '../asr-tiers'
import { atomicWriteJson } from '../atomic-file'
import { extractMonoWav } from '../audio'
import { ensureChunkManifest, manifestPathFor } from '../chunk-manifest'
import { ModelManager } from '../model-manager'
import type { TranscriptionPipeline } from '../pipeline'
import { FakeTranscriptionPipeline } from '../pipeline-fake'
import { SherpaTranscriptionPipeline } from '../pipeline-sherpa'
import { loadPipelineSeed, seedDurationMs } from '../speaker-assign'
import { parseSpeakerCount } from '../speaker-count'
import type { TranscriptionStage } from '../types'
import {
  parseMessage,
  WORKER_RESULT_FILE,
  type WorkerInbound,
  type WorkerOutbound,
  writeMessageSync
} from './protocol'

const send = (message: WorkerOutbound): void => {
  // Blocking write so Electron-as-Node pipe buffering cannot starve the watchdog.
  // Retries short writes: a multi-MB result can otherwise lose its trailing newline.
  writeMessageSync(1, message)
}

/**
 * Report a fatal worker exception over the protocol, then exit.
 *
 * @param err Uncaught exception or rejection reason.
 */
const failHard = (err: unknown): void => {
  const message = err instanceof Error ? err.message : String(err)
  try {
    send({ type: 'error', message })
  } catch {
    /* stdout may already be gone */
  }
  process.exit(1)
}

process.on('uncaughtException', failHard)
process.on('unhandledRejection', failHard)

const run = async (): Promise<void> => {
  const abort = new AbortController()
  process.on('SIGTERM', () => abort.abort())
  process.on('SIGINT', () => abort.abort())

  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      const message = parseMessage<WorkerInbound>(line)
      if (message?.type === 'cancel') {
        abort.abort()
      } else if (message?.type === 'probe') {
        void handleProbe(message)
      } else if (message?.type === 'start') {
        void handleStart(message, abort.signal)
      }
      idx = buffer.indexOf('\n')
    }
  })
}

const handleProbe = async (message: Extract<WorkerInbound, { type: 'probe' }>): Promise<void> => {
  try {
    if (process.env.VIDBEE_TRANSCRIPTION_BACKEND === 'fake') {
      send({ type: 'probe-ok' })
      return
    }
    // Native addon — resolved only inside the isolated worker.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const addon = require('sherpa-onnx-node') as {
      OfflineRecognizer: new (
        config: Record<string, unknown>
      ) => {
        createStream: () => {
          acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void
        }
        decode: (stream: unknown) => void
        getResult: (stream: unknown) => { text?: string }
      }
    }
    const models = new ModelManager({ modelsDir: message.modelsDir })
    for (const tier of ASR_TIER_IDS) {
      const config = tryRecognizerConfig(models, tier, 1)
      if (!config) {
        continue
      }
      const recognizer = new addon.OfflineRecognizer(config)
      const samples = new Float32Array(4800)
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.05
      }
      const stream = recognizer.createStream()
      stream.acceptWaveform({ sampleRate: 16_000, samples })
      recognizer.decode(stream)
      readAsrResult(recognizer, stream)
      break
    }
    send({ type: 'probe-ok' })
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

const handleStart = async (
  message: Extract<WorkerInbound, { type: 'start' }>,
  signal: AbortSignal
): Promise<void> => {
  let stage: TranscriptionStage = 'preparing-audio'
  const heartbeat = setInterval(() => {
    send({ type: 'progress', stage, percent: null, message: 'heartbeat' })
  }, 10_000)
  try {
    send({ type: 'progress', stage: 'preparing-audio', percent: 0, message: 'extract' })
    ensureChunkManifest({
      workDir: message.workDir,
      taskId: message.taskId,
      fingerprint: message.fingerprint,
      modelVersion: message.modelVersion
    })
    const existingTranscript = message.existingTranscriptPath
      ? loadPipelineSeed(message.existingTranscriptPath)
      : null
    const skipAudio = Boolean(existingTranscript && parseSpeakerCount(message.speakerCount) === 1)
    const models = new ModelManager({ modelsDir: message.modelsDir })
    const prepareAsr =
      message.backend === 'fake' || existingTranscript
        ? Promise.resolve()
        : models.ensureReady({ groups: ['asr'], tiers: [message.asrTier] })
    const extracted = skipAudio
      ? {
          wavPath: message.sourceFilePath,
          durationMs: existingTranscript ? seedDurationMs(existingTranscript) : 0
        }
      : await extractMonoWav({
          sourceFilePath: message.sourceFilePath,
          ffmpegPath: message.ffmpegPath,
          outputDir: message.workDir,
          signal
        })
    await prepareAsr
    const pipeline: TranscriptionPipeline =
      message.backend === 'fake'
        ? new FakeTranscriptionPipeline()
        : new SherpaTranscriptionPipeline({ models })
    const result = await pipeline.run({
      sourceFilePath: message.sourceFilePath,
      wavPath: extracted.wavPath,
      durationMs: extracted.durationMs,
      skipVad: message.skipVad,
      autoSkipAllowed: message.autoSkipAllowed,
      asrTier: message.asrTier,
      language: message.language,
      speakerCount: message.speakerCount,
      existingTranscript: existingTranscript ?? undefined,
      signal,
      manifestPath: manifestPathFor(message.workDir),
      onProgress: (progress) => {
        stage = progress.stage
        send({
          type: 'progress',
          stage: progress.stage,
          percent: progress.percent,
          message: progress.message
        })
      },
      onPartial: (segment) => {
        send({
          type: 'partial',
          speakerKey: segment.speakerKey,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
          words: segment.words
        })
      }
    })
    const resultPath = join(message.workDir, WORKER_RESULT_FILE)
    atomicWriteJson(resultPath, result)
    send({ type: 'result', resultPath: WORKER_RESULT_FILE, durationMs: extracted.durationMs })
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    if (signal.aborted || /cancelled/i.test(text)) {
      send({ type: 'error', message: 'cancelled' })
      return
    }
    send({ type: 'error', message: text })
  } finally {
    clearInterval(heartbeat)
  }
}

void run()
