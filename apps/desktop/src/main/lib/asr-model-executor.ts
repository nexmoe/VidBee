import {
  classify,
  EMPTY_PROGRESS,
  type Executor,
  type ExecutorContext,
  type ExecutorEvents,
  type ExecutorRun,
  sanitizeOutput,
  virtualError
} from '@vidbee/task-queue'
import type { ModelManager } from '@vidbee/transcription'
import { isAsrTierId } from '@vidbee/transcription/asr'

/** Load the shared model manager after queue initialization to avoid service import cycles. */
async function desktopModels(): Promise<ModelManager> {
  return (await import('./transcript-host')).getModelManager()
}

/** Download catalog-owned ASR files under the same durable lifecycle as other tasks. */
export class AsrModelExecutor implements Executor {
  private readonly loadModels: () => Promise<ModelManager>

  /** Accept a model manager provider so hosts can own package storage and transport. */
  constructor(loadModels: () => Promise<ModelManager> = desktopModels) {
    this.loadModels = loadModels
  }

  /** Subscribe to package progress and settle only after file verification or cancellation cleanup. */
  run(context: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    const identity = { taskId: context.taskId, attemptId: context.attemptId }
    const tier = context.input.options?.asrTier
    let models: ModelManager | undefined
    let cancelled = false
    let unsubscribe = (): void => {}
    let log = ''
    /** Record compact package milestones without persisting download URLs or credentials. */
    const report = (line: string): void => {
      log = `${log}${line}\n`.slice(-8000)
      events.onStd({ ...identity, stream: 'stdout', line })
    }
    const done = (async () => {
      try {
        if (!isAsrTierId(tier)) {
          throw new Error('Unknown ASR tier')
        }
        models = await this.loadModels()
        if (cancelled) {
          return
        }
        report(`Downloading ASR package ${tier}`)
        unsubscribe = models.subscribe((status) => {
          const transfers = status.downloads.filter((item) => item.tier === tier)
          events.onProgress({
            ...identity,
            enteredProcessing: false,
            progress: {
              ...EMPTY_PROGRESS,
              bytesDownloaded: transfers.reduce((sum, item) => sum + item.received, 0),
              bytesTotal:
                transfers.length && transfers.every((item) => item.total !== null)
                  ? transfers.reduce((sum, item) => sum + (item.total ?? 0), 0)
                  : null,
              ticks: Date.now()
            }
          })
        })
        await models.ensureReady({ groups: ['asr'], tiers: [tier] })
        if (cancelled) {
          return
        }
        const status = models.status(['asr'], [tier])
        const file = status.files[0]
        if (!(status.ready && file?.present && file.bytes > 0)) {
          throw Object.assign(new Error('ASR package is not ready after download'), {
            code: 'ASR_OUTPUT_MISSING'
          })
        }
        report(`ASR package ${tier} is ready`)
        events.onFinish({
          ...identity,
          result: {
            type: 'success',
            output: { filePath: file.path, size: status.bytes, durationMs: null, sha256: null }
          },
          closedAt: Date.now(),
          stdoutTail: log,
          stderrTail: ''
        })
      } catch (error) {
        if (!cancelled) {
          const message = sanitizeOutput(error instanceof Error ? error.message : String(error))
          const classified =
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ASR_OUTPUT_MISSING'
              ? virtualError('output-missing', message)
              : classify({ stderr: message, exitCode: 1 })
          events.onFinish({
            ...identity,
            result: {
              type: 'error',
              error: { ...classified, retryable: isAsrTierId(tier) && classified.retryable },
              exitCode: 1
            },
            closedAt: Date.now(),
            stdoutTail: log,
            stderrTail: message
          })
        }
      } finally {
        unsubscribe()
        if (cancelled) {
          events.onFinish({
            ...identity,
            result: { type: 'cancelled' },
            closedAt: Date.now(),
            stdoutTail: log,
            stderrTail: ''
          })
        }
      }
    })()
    /** Abort owned transfers and wait for the model manager to remove partial files. */
    const cancel = async (): Promise<void> => {
      cancelled = true
      if (isAsrTierId(tier)) {
        models?.cancelDownload(tier)
      }
      await done
    }
    return { cancel, pause: cancel }
  }
}
