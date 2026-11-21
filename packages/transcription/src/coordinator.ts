import { existsSync, statSync } from 'node:fs'
import {
  type Task,
  type TaskQueueAPI,
  type TaskQueueEvent,
  TRANSCRIBABLE_TASK_KINDS
} from '@vidbee/task-queue'
import type { TranscriptionProvider } from './cloud'
import { enqueueTranscription } from './enqueue'
import type { MemoryTranscriptStore } from './memory-store'
import type { TranscriptStore } from './transcript-store'

export interface ImportCaptionsRequest {
  downloadTaskId: string
  sourceFilePath: string
  title?: string
}

export interface AutoTranscriptionCoordinatorOptions {
  queue: TaskQueueAPI
  store: TranscriptStore | MemoryTranscriptStore
  isEnabled: () => boolean
  resolveSourceFile: (task: Task) => string | null
  resolveAsrTier?: () => string
  resolveProvider?: () => TranscriptionProvider
  resolveCloudModelId?: () => string
  /** UI language. Only Simplified vs Traditional Chinese is kept as a post-ASR script preference. */
  resolveLanguage?: () => string
  /** Import embedded or sidecar captions. Return true when a transcript was stored. */
  tryImportCaptions?: (input: ImportCaptionsRequest) => Promise<boolean>
  /** When false, live completions wait until `flushPending()` after models land. */
  isModelsReady?: () => boolean
  logger?: { warn: (...args: unknown[]) => void }
}

/**
 * Host-owned listener. It only reacts to download completions that occur
 * after `start()`, so enabling the setting never backfills history.
 */
export class AutoTranscriptionCoordinator {
  private readonly opts: AutoTranscriptionCoordinatorOptions
  private unsubscribe: (() => void) | null = null
  private readonly pending = new Set<string>()

  /** Keep host configuration pinned for the coordinator's lifetime. */
  constructor(opts: AutoTranscriptionCoordinatorOptions) {
    this.opts = opts
  }

  start(): void {
    if (this.unsubscribe) {
      return
    }
    this.unsubscribe = this.opts.queue.subscribe((event) => {
      void this.onEvent(event)
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.pending.clear()
  }

  /**
   * Enqueue auto-transcription for downloads that finished while models were still preparing.
   */
  async flushPending(): Promise<void> {
    const ids = [...this.pending]
    this.pending.clear()
    for (const id of ids) {
      const task = this.opts.queue.get(id)
      if (task) {
        await this.considerDownload(task)
      }
    }
  }

  private async onEvent(event: TaskQueueEvent): Promise<void> {
    if (event.type !== 'transition' || event.to !== 'completed') {
      return
    }
    const task = this.opts.queue.get(event.taskId)
    if (!(task && TRANSCRIBABLE_TASK_KINDS.has(task.kind))) {
      return
    }
    await this.considerDownload(task)
  }

  /**
   * Import captions if possible, otherwise queue or defer ASR for one completed download.
   */
  private async considerDownload(task: Task): Promise<void> {
    const source = this.opts.resolveSourceFile(task)
    if (!(source && existsSync(source) && statSync(source).size > 0)) {
      return
    }
    const existing = this.opts.store.getLatestForDownload(task.id)
    if (existing) {
      this.pending.delete(task.id)
      return
    }
    if (this.opts.tryImportCaptions) {
      try {
        const imported = await this.opts.tryImportCaptions({
          downloadTaskId: task.id,
          sourceFilePath: source,
          title: task.input.title
        })
        if (imported) {
          this.pending.delete(task.id)
          return
        }
      } catch (err) {
        this.opts.logger?.warn('caption import failed', err)
      }
    }
    if (this.opts.store.getLatestForDownload(task.id)) {
      this.pending.delete(task.id)
      return
    }
    if (!this.opts.isEnabled()) {
      this.pending.delete(task.id)
      return
    }
    if (this.opts.isModelsReady && !this.opts.isModelsReady()) {
      this.pending.add(task.id)
      return
    }
    this.pending.delete(task.id)
    try {
      await enqueueTranscription({
        queue: this.opts.queue,
        store: this.opts.store,
        downloadTaskId: task.id,
        sourceFilePath: source,
        title: task.input.title,
        trigger: 'auto',
        provider: this.opts.resolveProvider?.(),
        cloudModelId: this.opts.resolveCloudModelId?.(),
        asrTier: this.opts.resolveAsrTier?.(),
        language: this.opts.resolveLanguage?.()
      })
    } catch (err) {
      this.opts.logger?.warn('auto-transcription enqueue failed', err)
    }
  }
}
