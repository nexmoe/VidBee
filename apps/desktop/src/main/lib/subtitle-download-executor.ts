import { rm } from 'node:fs/promises'
import {
  classify,
  type Executor,
  type ExecutorContext,
  type ExecutorEvents,
  type ExecutorRun,
  sanitizeOutput
} from '@vidbee/task-queue'
import { readPidStartTime } from '@vidbee/task-queue/process'
import { z } from 'zod'
import { getDesktopTaskQueueRef } from './queue-ref'
import { downloadSubtitles, subtitleDownloadSchema } from './subtitle-download'

const taskOptionsSchema = subtitleDownloadSchema.extend({
  languages: z.array(z.string()).optional(),
  customDownloadPath: z.string().optional()
})

/** Run website caption downloads under the persistent queue's cancellation and retry lifecycle. */
export class SubtitleDownloadExecutor implements Executor {
  /** Complete only after the caption extractor exits and its owned files are saved or cleaned up. */
  run(context: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    const identity = { taskId: context.taskId, attemptId: context.attemptId }
    const controller = new AbortController()
    const done = (async () => {
      let file: string | undefined
      try {
        const options = taskOptionsSchema.parse(context.input.options ?? {})
        const result = await downloadSubtitles(
          context.input.url,
          {
            ...options,
            title: context.input.title,
            /** Journal the owned extractor so crash recovery can reap it before a retry. */
            onProcess: ({ pid }) => {
              if (pid) {
                events.onSpawn({
                  ...identity,
                  pid,
                  pidStartedAt: readPidStartTime(pid),
                  kind: 'yt-dlp',
                  spawnedAt: Date.now()
                })
              }
            }
          },
          controller.signal
        )
        file = result.path
        const { getTranscriptStore } = await import('./transcript-host')
        const queue = getDesktopTaskQueueRef()
        if (!queue.get(context.taskId)?.input.title && result.title.trim()) {
          await queue.rename(context.taskId, result.title.trim().slice(0, 200))
        }
        controller.signal.throwIfAborted()
        const record = getTranscriptStore().commit({
          downloadTaskId: context.taskId,
          transcriptionTaskId: `download-subtitles:${context.taskId}`,
          sourceFilePath: null,
          result: {
            resultKind: 'transcript',
            modelVersion: 'website-captions',
            asrTier: null,
            sourceKind: 'captions',
            language: result.language ?? null,
            speakers: [],
            segments: result.snapshot.segments.map((segment) => ({
              startMs: Math.round(segment.start * 1000),
              endMs: Math.round(segment.end * 1000),
              text: segment.text,
              speakerKey: null,
              confidence: null
            }))
          }
        })
        events.onFinish({
          ...identity,
          result: {
            type: 'success',
            output: {
              filePath: result.path,
              size: result.bytes,
              durationMs: Math.round(result.snapshot.duration * 1000),
              sha256: null,
              subtitleStatus: 'downloaded',
              subtitleLanguages: result.language ? [result.language] : [],
              transcript: { resultKind: 'transcript', transcriptId: record.id }
            }
          },
          closedAt: Date.now(),
          stdoutTail: `Downloaded ${result.segmentCount} subtitle segments as ${result.format}`,
          stderrTail: ''
        })
      } catch (error) {
        if (file) {
          await rm(file, { force: true })
        }
        const message = sanitizeOutput(error instanceof Error ? error.message : String(error))
        const classified = classify({ stderr: message, exitCode: 1 })
        const noCaptions = error instanceof Error && 'code' in error && error.code === 'noCaptions'
        events.onFinish({
          ...identity,
          result: controller.signal.aborted
            ? { type: 'cancelled' }
            : {
                type: 'error',
                error: { ...classified, retryable: !noCaptions && classified.retryable },
                exitCode: 1
              },
          closedAt: Date.now(),
          stdoutTail: '',
          stderrTail: controller.signal.aborted ? '' : message
        })
      }
    })()
    /** Abort the owned extractor and wait until its temporary directory has been removed. */
    const cancel = async (): Promise<void> => {
      controller.abort()
      await done
    }
    return { cancel, pause: cancel }
  }
}
