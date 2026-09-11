import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ClassifiedError,
  Executor,
  ExecutorContext,
  ExecutorEvents,
  ExecutorRun,
  TaskOutput
} from '@vidbee/task-queue'
import { DEFAULT_ASR_TIER, parseAsrTier } from './asr-tiers'
import {
  ensureChunkManifest,
  manifestWorkKey,
  saveManifestStages,
  sourceFingerprint
} from './chunk-manifest'
import { classifyTranscriptionFailure } from './errors'
import type { MemoryTranscriptStore } from './memory-store'
import { modelVersion } from './model-catalog'
import { sherpaWorkerEnv } from './native-env'
import { readTranscriptionOptions } from './options'
import { transcriptionPartials } from './partial-buffer'
import {
  createFileProbeCache,
  DEFAULT_MAX_WORKER_RESTARTS,
  formatRuntimeLog,
  probeWorker,
  resolveWorkerRuntime,
  type WorkerRuntime,
  type WorkerRuntimeLayer
} from './runtime'
import {
  latestTranscriptSeed,
  type PipelineSeed,
  SEED_TRANSCRIPT_FILE,
  writePipelineSeed
} from './speaker-assign'
import { DEFAULT_SPEAKER_COUNT, parseSpeakerCount } from './speaker-count'
import type { TranscriptStore } from './transcript-store'
import type { PipelineResult, PipelineSegment, TranscriptionStage } from './types'
import {
  encodeMessage,
  parseMessage,
  readWorkerResult,
  type WorkerInbound,
  type WorkerOutbound
} from './worker/protocol'

export type TranscriptionBackend = 'sherpa' | 'fake'

export interface TranscriptionExecutorOptions {
  store: TranscriptStore | MemoryTranscriptStore
  workerScript: string
  modelsDir: string
  resolveFfmpegPath: () => string
  backend?: TranscriptionBackend
  execPath?: string
  execArgv?: string[]
  env?: NodeJS.ProcessEnv
  workDir?: string
  bundledNodePath?: string | null
  forceLayer?: WorkerRuntimeLayer
  maxWorkerRestarts?: number
  skipProbe?: boolean
  /**
   * Test seam: run the pipeline in-process instead of forking a worker.
   */
  runInProcess?: (input: {
    sourceFilePath: string
    skipVad: boolean
    autoSkipAllowed: boolean
    asrTier: string
    language?: string
    speakerCount?: import('./speaker-count').SpeakerCount
    existingTranscript?: PipelineSeed
    signal: AbortSignal
    onProgress: (stage: TranscriptionStage, percent: number | null) => void
    onPartial?: (segment: PipelineSegment) => void
  }) => Promise<{ result: PipelineResult; durationMs: number }>
  onPartial?: (input: {
    taskId: string
    downloadTaskId: string
    segments: PipelineSegment[]
  }) => void
  onStage?: (input: { taskId: string; downloadTaskId: string; stage: TranscriptionStage }) => void
}

const ACTIVE_STAGES: ReadonlySet<TranscriptionStage> = new Set([
  'preparing-models',
  'preparing-audio',
  'detecting-speech',
  'diarizing',
  'recognizing'
])

export class TranscriptionExecutor implements Executor {
  constructor(private readonly opts: TranscriptionExecutorOptions) {}

  run(ctx: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    const parsed = readTranscriptionOptions(ctx.input)
    const abort = new AbortController()
    let child: ChildProcess | null = null
    let finished = false

    const finishOnce = (
      result:
        | { type: 'success'; output: TaskOutput }
        | { type: 'error'; error: ClassifiedError; exitCode: number | null }
        | { type: 'cancelled' },
      tails: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
    ): void => {
      if (finished) {
        return
      }
      finished = true
      events.onFinish({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        result,
        closedAt: Date.now(),
        stdoutTail: tails.stdout,
        stderrTail: tails.stderr
      })
    }

    queueMicrotask(() => {
      void this.execute(ctx, events, parsed, abort, (proc) => {
        child = proc
      })
        .then((outcome) => finishOnce(outcome.result, outcome.tails))
        .catch((err) => {
          if (abort.signal.aborted) {
            finishOnce({ type: 'cancelled' })
            return
          }
          const error = classifyTranscriptionFailure(err)
          finishOnce(
            { type: 'error', error, exitCode: null },
            { stdout: '', stderr: error.rawMessage }
          )
        })
    })

    return {
      cancel: async () => {
        abort.abort()
        if (child && !child.killed) {
          child.kill('SIGTERM')
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL')
            }
          }, 10_000).unref?.()
        }
      },
      pause: async () => {
        abort.abort()
        if (child && !child.killed) {
          child.kill('SIGTERM')
        }
      }
    }
  }

  private async execute(
    ctx: ExecutorContext,
    events: ExecutorEvents,
    parsed: ReturnType<typeof readTranscriptionOptions>,
    abort: AbortController,
    attach: (child: ChildProcess | null) => void
  ): Promise<{
    result:
      | { type: 'success'; output: TaskOutput }
      | { type: 'error'; error: ClassifiedError; exitCode: number | null }
      | { type: 'cancelled' }
    tails: { stdout: string; stderr: string }
  }> {
    if (!parsed) {
      throw new Error('source file missing: transcription options incomplete')
    }
    const pid = process.pid
    events.onSpawn({
      taskId: ctx.taskId,
      attemptId: ctx.attemptId,
      pid,
      pidStartedAt: Date.now(),
      kind: 'ai-worker',
      spawnedAt: Date.now()
    })

    let persistDir: string | null = null
    const emitProgress = (stage: TranscriptionStage, percent: number | null, ticks: number) => {
      const next = transcriptionPartials.setStage(ctx.taskId, parsed.downloadTaskId, stage)
      if (persistDir) {
        try {
          saveManifestStages(persistDir, next.stageHistory)
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          if (!/cancelled|enoent/i.test(text)) {
            throw error
          }
        }
      }
      this.opts.onStage?.({
        taskId: ctx.taskId,
        downloadTaskId: parsed.downloadTaskId,
        stage
      })
      events.onProgress({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        progress: {
          percent,
          bytesDownloaded: null,
          bytesTotal: null,
          speedBps: null,
          etaMs: null,
          ticks
        },
        enteredProcessing: stage === 'committing' || !ACTIVE_STAGES.has(stage)
      })
      events.onStd({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        stream: 'stdout',
        line: `stage=${stage}`
      })
    }

    let pipelineOut: { result: PipelineResult; durationMs: number }
    const tails = { stdout: '', stderr: '' }

    const asrTier = parseAsrTier(parsed.asrTier, DEFAULT_ASR_TIER)
    const speakerCount = parseSpeakerCount(parsed.speakerCount, DEFAULT_SPEAKER_COUNT)
    const existingTranscript = parsed.rediarize
      ? latestTranscriptSeed(this.opts.store, parsed.downloadTaskId)
      : null
    const emitPartial = (segment: PipelineSegment) => {
      const next = transcriptionPartials.append(ctx.taskId, parsed.downloadTaskId, segment)
      this.opts.onPartial?.({
        taskId: ctx.taskId,
        downloadTaskId: parsed.downloadTaskId,
        segments: next.segments
      })
    }

    if (this.opts.runInProcess) {
      pipelineOut = await this.opts.runInProcess({
        sourceFilePath: parsed.sourceFilePath,
        skipVad: parsed.skipVad === true,
        autoSkipAllowed: parsed.trigger === 'auto' && parsed.skipVad !== true,
        asrTier,
        language: parsed.language,
        speakerCount,
        existingTranscript: existingTranscript ?? undefined,
        signal: abort.signal,
        onProgress: (stage, percent) => emitProgress(stage, percent, Date.now()),
        onPartial: emitPartial
      })
    } else {
      const fingerprint = sourceFingerprint(parsed.sourceFilePath)
      const workDir = join(
        this.opts.workDir ?? tmpdir(),
        'vidbee-transcript',
        manifestWorkKey(ctx.taskId, fingerprint, `${modelVersion}:${asrTier}:spk-${speakerCount}`)
      )
      mkdirSync(workDir, { recursive: true })
      persistDir = workDir
      ensureChunkManifest({
        workDir,
        taskId: ctx.taskId,
        fingerprint,
        modelVersion: `${modelVersion}:${asrTier}:spk-${speakerCount}`
      })
      const restored = transcriptionPartials.restoreFromManifest({
        taskId: ctx.taskId,
        downloadTaskId: parsed.downloadTaskId,
        workDir
      })
      if (restored) {
        this.opts.onPartial?.({
          taskId: ctx.taskId,
          downloadTaskId: parsed.downloadTaskId,
          segments: restored.segments
        })
        if (restored.stage) {
          this.opts.onStage?.({
            taskId: ctx.taskId,
            downloadTaskId: parsed.downloadTaskId,
            stage: restored.stage
          })
        }
      }
      const runtime = await this.resolveRuntime(events, ctx)
      for (const line of formatRuntimeLog(runtime, 0)) {
        tails.stdout += `${line}\n`
        events.onStd({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          stream: 'stdout',
          line
        })
      }
      try {
        if (existingTranscript) {
          writePipelineSeed(join(workDir, SEED_TRANSCRIPT_FILE), existingTranscript)
        }
        pipelineOut = await this.runWorkerWithRestart({
          ctx,
          events,
          parsed,
          abort,
          workDir,
          attach,
          emitProgress,
          tails,
          runtime,
          fingerprint,
          existingTranscriptPath: existingTranscript
            ? join(workDir, SEED_TRANSCRIPT_FILE)
            : undefined
        })
        rmSync(workDir, { recursive: true, force: true })
        transcriptionPartials.clear(ctx.taskId)
      } catch (err) {
        if (abort.signal.aborted) {
          rmSync(workDir, { recursive: true, force: true })
          transcriptionPartials.clear(ctx.taskId)
          return { result: { type: 'cancelled' }, tails }
        }
        const error = classifyTranscriptionFailure(err)
        const exitCode = err instanceof WorkerExitError ? err.code : null
        return {
          result: { type: 'error', error, exitCode },
          tails: {
            stdout: tails.stdout,
            stderr: tails.stderr.trim() ? tails.stderr : error.rawMessage
          }
        }
      }
    }

    if (abort.signal.aborted) {
      return { result: { type: 'cancelled' }, tails }
    }

    const committed = this.opts.store.commit({
      downloadTaskId: parsed.downloadTaskId,
      transcriptionTaskId: ctx.taskId,
      sourceFilePath: parsed.sourceFilePath,
      result: pipelineOut.result
    })

    return {
      result: {
        type: 'success',
        output: {
          filePath: parsed.sourceFilePath,
          size: 1,
          durationMs: pipelineOut.durationMs || null,
          sha256: null,
          transcript: {
            resultKind: committed.resultKind,
            transcriptId: committed.id
          }
        }
      },
      tails
    }
  }

  private async resolveRuntime(
    events: ExecutorEvents,
    ctx: ExecutorContext
  ): Promise<WorkerRuntime> {
    const cache = createFileProbeCache(
      join(this.opts.workDir ?? tmpdir(), 'vidbee-runtime-probe.json')
    )
    return resolveWorkerRuntime({
      envPath: process.env.VIDBEE_TRANSCRIPTION_NODE ?? null,
      bundledPath: this.opts.bundledNodePath ?? null,
      electronPath: this.opts.execPath ?? process.execPath,
      forceLayer: this.opts.forceLayer,
      cache,
      probe: this.opts.skipProbe
        ? undefined
        : async (runtime) => {
            events.onStd({
              taskId: ctx.taskId,
              attemptId: ctx.attemptId,
              stream: 'stdout',
              line: `runtime.probe=${runtime.layer}`
            })
            return probeWorker({
              execPath: runtime.execPath,
              workerScript: this.opts.workerScript,
              modelsDir: this.opts.modelsDir,
              env: sherpaWorkerEnv(this.opts.env, { electronAsNode: runtime.layer === 'electron' })
            })
          }
    })
  }

  private async runWorkerWithRestart(input: {
    ctx: ExecutorContext
    events: ExecutorEvents
    parsed: NonNullable<ReturnType<typeof readTranscriptionOptions>>
    abort: AbortController
    workDir: string
    attach: (child: ChildProcess | null) => void
    emitProgress: (stage: TranscriptionStage, percent: number | null, ticks: number) => void
    tails: { stdout: string; stderr: string }
    runtime: WorkerRuntime
    fingerprint: string
    existingTranscriptPath?: string
  }): Promise<{ result: PipelineResult; durationMs: number }> {
    const maxRestarts = this.opts.maxWorkerRestarts ?? DEFAULT_MAX_WORKER_RESTARTS
    let restarts = 0
    while (true) {
      try {
        return await this.runWorker(input)
      } catch (err) {
        if (input.abort.signal.aborted) {
          throw err
        }
        if (!isRecoverableWorkerExit(err) || restarts >= maxRestarts) {
          throw err
        }
        restarts += 1
        const line = `runtime.restarts=${restarts}`
        input.tails.stdout += `${line}\n`
        input.events.onStd({
          taskId: input.ctx.taskId,
          attemptId: input.ctx.attemptId,
          stream: 'stdout',
          line
        })
      }
    }
  }

  private runWorker(input: {
    ctx: ExecutorContext
    events: ExecutorEvents
    parsed: NonNullable<ReturnType<typeof readTranscriptionOptions>>
    abort: AbortController
    workDir: string
    attach: (child: ChildProcess | null) => void
    emitProgress: (stage: TranscriptionStage, percent: number | null, ticks: number) => void
    tails: { stdout: string; stderr: string }
    runtime: WorkerRuntime
    fingerprint: string
    existingTranscriptPath?: string
  }): Promise<{ result: PipelineResult; durationMs: number }> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(
        input.runtime.execPath,
        [...(this.opts.execArgv ?? []), this.opts.workerScript],
        {
          env: sherpaWorkerEnv(this.opts.env, {
            electronAsNode: input.runtime.layer === 'electron'
          }),
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      input.attach(child)

      const start: WorkerInbound = {
        type: 'start',
        taskId: input.ctx.taskId,
        attemptId: input.ctx.attemptId,
        sourceFilePath: input.parsed.sourceFilePath,
        ffmpegPath: this.opts.resolveFfmpegPath(),
        workDir: input.workDir,
        modelsDir: this.opts.modelsDir,
        skipVad: input.parsed.skipVad === true,
        autoSkipAllowed: input.parsed.trigger === 'auto' && input.parsed.skipVad !== true,
        backend: this.opts.backend ?? 'sherpa',
        fingerprint: input.fingerprint,
        modelVersion: `${modelVersion}:${parseAsrTier(input.parsed.asrTier, DEFAULT_ASR_TIER)}:spk-${parseSpeakerCount(input.parsed.speakerCount, DEFAULT_SPEAKER_COUNT)}`,
        asrTier: parseAsrTier(input.parsed.asrTier, DEFAULT_ASR_TIER),
        language: input.parsed.language,
        speakerCount: parseSpeakerCount(input.parsed.speakerCount, DEFAULT_SPEAKER_COUNT),
        existingTranscriptPath: input.existingTranscriptPath
      }
      child.stdin?.write(encodeMessage(start))

      // Native sherpa calls block the worker event loop, so in-worker
      // heartbeats cannot keep the 60s running watchdog alive. Stop once
      // committing starts — fake keepalives would hide a lost result forever.
      const alive = setInterval(() => {
        if (!child.killed) {
          input.events.onStd({
            taskId: input.ctx.taskId,
            attemptId: input.ctx.attemptId,
            stream: 'stdout',
            line: 'worker-alive'
          })
        }
      }, 10_000)
      alive.unref?.()

      let settled = false
      const settle = (fn: () => void) => {
        if (settled) {
          return
        }
        settled = true
        clearInterval(alive)
        fn()
      }

      let buffer = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk
        let idx = buffer.indexOf('\n')
        while (idx >= 0) {
          const line = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          const message = parseMessage<WorkerOutbound>(line)
          if (!message) {
            idx = buffer.indexOf('\n')
            continue
          }
          if (message.type === 'progress') {
            if (message.stage === 'committing') {
              clearInterval(alive)
            }
            input.emitProgress(message.stage, message.percent, Date.now())
          } else if (message.type === 'partial') {
            const next = transcriptionPartials.append(
              input.ctx.taskId,
              input.parsed.downloadTaskId,
              {
                speakerKey: message.speakerKey,
                startMs: message.startMs,
                endMs: message.endMs,
                text: message.text,
                words: message.words,
                confidence: null
              }
            )
            this.opts.onPartial?.({
              taskId: input.ctx.taskId,
              downloadTaskId: input.parsed.downloadTaskId,
              segments: next.segments
            })
          } else if (message.type === 'log') {
            input.tails[message.stream] += `${message.line}\n`
            input.events.onStd({
              taskId: input.ctx.taskId,
              attemptId: input.ctx.attemptId,
              stream: message.stream,
              line: message.line
            })
          } else if (message.type === 'result') {
            settle(() => {
              try {
                resolve({
                  result: readWorkerResult(message, input.workDir),
                  durationMs: message.durationMs
                })
              } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)))
              }
            })
          } else if (message.type === 'error') {
            settle(() => {
              if (message.message === 'cancelled' || input.abort.signal.aborted) {
                reject(new Error('cancelled'))
              } else {
                reject(new Error(message.message))
              }
            })
          }
          idx = buffer.indexOf('\n')
        }
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        input.tails.stderr += chunk
      })
      child.on('error', (err) => settle(() => reject(err)))
      child.on('close', (code, signal) => {
        input.attach(null)
        settle(() => {
          if (input.abort.signal.aborted) {
            reject(new Error('cancelled'))
            return
          }
          reject(new WorkerExitError(code, signal, input.tails.stderr))
        })
      })

      input.abort.signal.addEventListener(
        'abort',
        () => {
          child.stdin?.write(encodeMessage({ type: 'cancel' }))
          child.kill('SIGTERM')
        },
        { once: true }
      )
    })
  }
}

class WorkerExitError extends Error {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  constructor(code: number | null, signal: NodeJS.Signals | null, stderr = '') {
    const summary = `ai-worker exited without result (code ${code}${signal ? `, signal ${signal}` : ''})`
    const tail = stderr.trim().slice(-800)
    super(tail ? `${summary}\n${tail}` : summary)
    this.code = code
    this.signal = signal
  }
}

const isRecoverableWorkerExit = (err: unknown): boolean => {
  if (err instanceof WorkerExitError) {
    if (err.signal === 'SIGTRAP' || err.signal === 'SIGABRT' || err.signal === 'SIGSEGV') {
      return true
    }
    return err.code !== 0
  }
  const message = err instanceof Error ? err.message : String(err)
  return /exited without result|SIGTRAP|SIGABRT/i.test(message)
}
