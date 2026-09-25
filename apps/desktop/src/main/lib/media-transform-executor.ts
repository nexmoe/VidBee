import { type ChildProcess, spawn } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  classify,
  EMPTY_PROGRESS,
  type Executor,
  type ExecutorContext,
  type ExecutorEvents,
  type ExecutorRun,
  readPidStartTime,
  sanitizeOutput
} from '@vidbee/task-queue'
import { buildMediaTransformArgs, mediaTransformSchema } from '../../shared/media-transform'
import { ffmpegManager } from './ffmpeg-manager'
import { probeLocalMedia } from './media-probe'

/** File conflicts and invalid local inputs need correction, not automatic retries. */
export function classifyMediaTransformError(error: unknown) {
  const message = sanitizeOutput(error instanceof Error ? error.message : String(error))
  const classified = classify({ stderr: message, exitCode: 1 })
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (
    [
      'EEXIST',
      'ENOENT',
      'ENOTDIR',
      'EINVAL',
      'EACCES',
      'EPERM',
      'ENOSPC',
      'SIGILL',
      'SIGSEGV',
      'SIGBUS',
      'SIGABRT'
    ].includes(code) ||
    (error instanceof Error && error.name === 'ZodError')
  ) {
    return { ...classified, retryable: false, suggestedRetryAfterMs: null }
  }
  return classified
}

/** Execute conversions inside the common queue with durable logs and cancellable attempts. */
export class MediaTransformExecutor implements Executor {
  /** Create one process attempt; publish success only after an atomic, non-overwriting commit. */
  run(context: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    let child: ChildProcess | undefined
    let cancelled = false
    const controller = new AbortController()
    let stderr = ''
    let stdout = ''
    let work: string | undefined
    const identity = { taskId: context.taskId, attemptId: context.attemptId }
    /** Reap the owned child before the queue transitions to paused or cancelled. */
    const cancel = async (): Promise<void> => {
      cancelled = true
      controller.abort()
      child?.kill('SIGKILL')
      await done
    }
    const done = (async () => {
      try {
        const input = mediaTransformSchema.parse(context.input.options?.transform)
        const source = String(context.input.options?.sourceFilePath ?? '')
        const directory = String(context.input.options?.outputDirectory ?? '')
        if (
          !(path.isAbsolute(source) && path.isAbsolute(directory) && (await lstat(source)).isFile())
        ) {
          throw new Error(
            'Conversion requires an existing local media file and absolute output directory'
          )
        }
        const ffmpeg = await ffmpegManager.ensureInitialized()
        await mkdir(directory, { recursive: true })
        work = await mkdtemp(path.join(directory, '.convert-'))
        const temporary = path.join(work, `output.${input.format}`)
        const target = path.join(directory, `${context.taskId}.${input.format}`)
        if (cancelled) {
          throw new Error('Cancelled')
        }
        await new Promise<void>((resolve, reject) => {
          child = spawn(ffmpeg, buildMediaTransformArgs(input, source, temporary), {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          })
          const timeout = setTimeout(
            () => {
              child?.kill('SIGKILL')
            },
            6 * 60 * 60 * 1000
          )
          child.once('spawn', () => {
            if (child?.pid) {
              events.onSpawn({
                ...identity,
                pid: child.pid,
                pidStartedAt: readPidStartTime(child.pid),
                kind: 'ffmpeg',
                spawnedAt: Date.now()
              })
            }
          })
          child.stdout?.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            stdout = (stdout + text).slice(-8000)
            const match = [...stdout.matchAll(/out_time_us=(\d+)/g)].at(-1)
            const duration = input.durationSeconds ?? Number(context.input.options?.durationSeconds)
            events.onProgress({
              ...identity,
              enteredProcessing: true,
              progress: {
                ...EMPTY_PROGRESS,
                percent:
                  match && duration > 0
                    ? Math.min(0.99, Number(match[1]) / 1_000_000 / duration)
                    : null,
                ticks: Date.now()
              }
            })
          })
          child.stderr?.on('data', (chunk: Buffer) => {
            const text = sanitizeOutput(chunk.toString())
            stderr = (stderr + text).slice(-8000)
            events.onStd({ ...identity, stream: 'stderr', line: text })
          })
          child.once('error', (error) => {
            clearTimeout(timeout)
            reject(error)
          })
          child.once('close', (code, signal) => {
            clearTimeout(timeout)
            if (code === 0) {
              resolve()
            } else {
              reject(
                Object.assign(
                  new Error(`FFmpeg exited ${code}${signal ? ` (${signal})` : ''}: ${stderr}`),
                  { code: signal ?? String(code) }
                )
              )
            }
          })
        })
        if (cancelled) {
          throw new Error('Cancelled')
        }
        const stat = await lstat(temporary)
        if (!stat.isFile() || stat.size === 0) {
          throw new Error('FFmpeg output is missing or empty')
        }
        const probe = await probeLocalMedia(temporary, controller.signal)
        const duration = Number(probe.format?.duration)
        if (!(probe.streams?.length && Number.isFinite(duration)) || duration <= 0) {
          throw Object.assign(
            new Error('FFmpeg output has no playable media; check the requested time range'),
            { code: 'EINVAL' }
          )
        }
        if (cancelled) {
          throw new Error('Cancelled')
        }
        await link(temporary, target)
        events.onFinish({
          ...identity,
          result: {
            type: 'success',
            output: {
              filePath: target,
              size: stat.size,
              durationMs: Math.round(duration * 1000),
              sha256: null
            }
          },
          closedAt: Date.now(),
          stdoutTail: stdout,
          stderrTail: stderr
        })
      } catch (error) {
        const message = sanitizeOutput(error instanceof Error ? error.message : String(error))
        events.onFinish({
          ...identity,
          result: cancelled
            ? { type: 'cancelled' }
            : { type: 'error', error: classifyMediaTransformError(error), exitCode: 1 },
          closedAt: Date.now(),
          stdoutTail: stdout,
          stderrTail: message
        })
      } finally {
        if (work) {
          await rm(work, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    })()
    return { cancel, pause: cancel }
  }
}
