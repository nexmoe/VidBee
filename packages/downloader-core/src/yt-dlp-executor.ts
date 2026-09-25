/**
 * YtDlpExecutor — host-neutral implementation of the @vidbee/task-queue
 * `Executor` interface. Owns yt-dlp spawn, progress parsing, postprocess
 * detection, output discovery, and SIGTERM/SIGKILL cancel semantics.
 *
 * The executor is deliberately minimal: it does NOT manage queues, history,
 * crash recovery, or persistence — those live in TaskQueueAPI. Hosts wire
 * one of these per process and feed it into TaskQueueAPI so Desktop, Web/API
 * and CLI all execute downloads identically.
 *
 * Reference: NEX-131 issue body §A; design doc §5 / §10.
 */
import { existsSync, statSync } from 'node:fs'
import type {
  ClassifiedError,
  Executor,
  ExecutorContext,
  ExecutorEvents,
  ExecutorRun,
  TaskInput,
  TaskOutput
} from '@vidbee/task-queue'
import { classify, virtualError } from '@vidbee/task-queue'
import { killProcessTree } from '@vidbee/task-queue/process'
import YTDlpWrap from 'yt-dlp-wrap-plus'
import type { OneClickContainerOption } from './format-preferences'
import type { DownloadRuntimeSettings } from './types'
import {
  buildDownloadArgs,
  formatYtDlpCommand,
  isUnsupportedThumbnailEmbedOnlyFailure,
  resolveSubtitleDownloadSkipReason,
  THUMBNAIL_EMBED_UNSUPPORTED_LOG,
  VIDBEE_OUTPUT_PATH_PREFIX
} from './yt-dlp-args'
import { DownloadProgressAggregator, type YtDlpProgressPayload } from './yt-dlp-progress'
import { resolveYtDlpWrapCtor } from './yt-dlp-wrap'

interface YtDlpExecProcess {
  ytDlpProcess?: {
    pid?: number
    stdout?: NodeJS.ReadableStream
    stderr?: NodeJS.ReadableStream
    kill: (signal?: NodeJS.Signals | number) => boolean
  }
  on(event: 'progress', listener: (payload: YtDlpProgressPayload) => void): this
  on(event: 'close', listener: (code: number | null) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  once(event: 'close', listener: (code: number | null) => void): this
  once(event: 'error', listener: (error: Error) => void): this
}

interface YtDlpWrapInstance {
  exec(args: string[], options?: { signal?: AbortSignal }): YtDlpExecProcess
}

type YtDlpWrapConstructor = new (binaryPath: string) => YtDlpWrapInstance
const YTDlpWrapCtor = resolveYtDlpWrapCtor<YtDlpWrapConstructor>(YTDlpWrap)

/**
 * Per-task data hosts pack into `Task.input.options` when calling
 * `TaskQueueAPI.add({ input })`. Adapters that route through downloads.*
 * routes MUST shape options to this contract; `YtDlpExecutor` reads them
 * back out at spawn time.
 */
export interface YtDlpTaskOptions {
  type?: 'video' | 'audio'
  format?: string
  audioFormat?: string
  audioFormatIds?: readonly string[]
  startTime?: string
  endTime?: string
  customDownloadPath?: string
  customFilenameTemplate?: string
  containerFormat?: OneClickContainerOption
  /** Per-task overrides on top of the executor's default DownloadRuntimeSettings. */
  settings?: DownloadRuntimeSettings
  /**
   * Display-only metadata stored at create time. Surfaces back through the
   * legacy projection so renderers see the same fields they used to.
   */
  title?: string
  thumbnail?: string
  description?: string
  channel?: string
  uploader?: string
  duration?: number
  viewCount?: number
  tags?: readonly string[]
  playlistTitle?: string
  playlistSize?: number
  fileSize?: number
  startedAt?: number
  completedAt?: number
  downloadPath?: string
}

export interface YtDlpExecutorOptions {
  /** yt-dlp binary path. Resolved lazily so adapters can pick one up after
   *  startup (e.g. desktop's auto-installer). */
  resolveYtDlpPath: () => string
  /** ffmpeg directory; passed to yt-dlp via `--ffmpeg-location`. Lazy. */
  resolveFfmpegLocation: () => string | undefined
  /** Default download dir if a task does not provide one. */
  defaultDownloadDir: string
  /** Default runtime settings (cookies, proxy, embed flags). */
  defaultRuntimeSettings?: DownloadRuntimeSettings
  /**
   * Extra argv injected after `buildDownloadArgs` (e.g. `--js-runtimes deno:/path`)
   * so adapters can plumb their own runtime resolution.
   */
  extraArgs?: () => readonly string[]
  /**
   * Override args builder. Mostly used by the CLI's `yt-dlp-forward` flow
   * which passes raw argv unchanged.
   */
  buildArgs?: (input: TaskInput, defaultDownloadDir: string) => string[]
  /**
   * Optional host hook that can replace cookies/proxy settings immediately
   * before yt-dlp starts, including retries.
   */
  prepareSettings?: (input: TaskInput) => Promise<DownloadRuntimeSettings | undefined>
  /** Grace period between SIGTERM and SIGKILL. Default 10s. */
  killGraceMs?: number
  /** Test seam. Defaults to Date.now. */
  clock?: () => number
  /** Test seam: override the yt-dlp-wrap-plus invocation. */
  spawnFn?: (binaryPath: string, args: string[], signal: AbortSignal) => YtDlpExecProcess
}

const DEFAULT_KILL_GRACE_MS = 10_000
const STDOUT_TAIL_BYTES = 8 * 1024
const STDERR_TAIL_BYTES = 8 * 1024
const OUTPUT_PATH_SCAN_BYTES = 4 * 1024
const PROCESSING_DETECT_PATTERNS = [
  /\bMerging formats?\b/i,
  /^\[Postprocess\]/m,
  /\b(?:Embedding|Adding|Fixing|Converting)\b/i,
  /\b(?:ExtractAudio|VideoConvertor|FFmpeg)\b/i
]
const SUBTITLE_DOWNLOAD_ERROR = /Unable to download video subtitles for/i
const SUBTITLE_DOWNLOAD_INFO = /\[info\][^\r\n]*Downloading subtitles:\s*([^\r\n]+)/i
const SUBTITLE_UNAVAILABLE_INFO =
  /There are no subtitles for the requested languages|video doesn't have subtitles/i
const SUBTITLE_OPTIONS_WITH_VALUE = new Set(['--sleep-subtitles', '--sub-langs'])
const SUBTITLE_TOGGLE_OPTIONS = new Set([
  '--embed-subs',
  '--no-embed-subs',
  '--no-write-auto-subs',
  '--no-write-subs',
  '--write-auto-subs',
  '--write-subs'
])
const SUBTITLE_FALLBACK_LOG =
  '[VidBee] Subtitle download failed; retrying the video without subtitles.'

const FFMPEG_NOT_FOUND_ERROR =
  'ffmpeg/ffprobe not found. Use Desktop resources/ffmpeg, install in PATH, or set FFMPEG_PATH.'

interface SubtitleOutcome {
  languages?: string[]
  status: NonNullable<TaskOutput['subtitleStatus']>
}

/** Extract the subtitle language tags yt-dlp selected from its info output. */
const extractDownloadedSubtitleLanguages = (output: string): string[] => {
  const rawLanguages = output.match(SUBTITLE_DOWNLOAD_INFO)?.[1]
  if (!rawLanguages) {
    return []
  }
  return rawLanguages
    .split(',')
    .map((language) => language.trim())
    .filter(Boolean)
}

/** Resolve the persisted subtitle outcome from one completed yt-dlp run. */
const resolveSubtitleOutcome = (input: {
  downloadedLanguages: readonly string[]
  fallbackAttempted: boolean
  initialStatus?: SubtitleOutcome['status']
  subtitlesRequested: boolean
  unavailableSeen: boolean
}): SubtitleOutcome | undefined => {
  if (input.initialStatus) {
    return { status: input.initialStatus }
  }
  if (input.fallbackAttempted) {
    return { status: 'failed' }
  }

  if (input.downloadedLanguages.length > 0) {
    return { languages: [...input.downloadedLanguages], status: 'downloaded' }
  }
  if (input.subtitlesRequested && input.unavailableSeen) {
    return { status: 'unavailable' }
  }
  return undefined
}

export class YtDlpExecutor implements Executor {
  private readonly opts: Required<
    Omit<
      YtDlpExecutorOptions,
      'extraArgs' | 'buildArgs' | 'spawnFn' | 'defaultRuntimeSettings' | 'prepareSettings'
    >
  > &
    Pick<YtDlpExecutorOptions, 'extraArgs' | 'buildArgs' | 'spawnFn' | 'prepareSettings'> & {
      defaultRuntimeSettings: DownloadRuntimeSettings
    }
  private cachedYtDlp: YtDlpWrapInstance | null = null
  private cachedYtDlpPath: string | null = null

  constructor(options: YtDlpExecutorOptions) {
    this.opts = {
      resolveYtDlpPath: options.resolveYtDlpPath,
      resolveFfmpegLocation: options.resolveFfmpegLocation,
      defaultDownloadDir: options.defaultDownloadDir,
      defaultRuntimeSettings: options.defaultRuntimeSettings ?? {},
      extraArgs: options.extraArgs,
      buildArgs: options.buildArgs,
      prepareSettings: options.prepareSettings,
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      clock: options.clock ?? Date.now,
      spawnFn: options.spawnFn
    }
  }

  run(ctx: ExecutorContext, events: ExecutorEvents): ExecutorRun {
    const stdoutTail = createTailBuffer(STDOUT_TAIL_BYTES)
    const stderrTail = createTailBuffer(STDERR_TAIL_BYTES)
    let postprocessSeen = false
    let settled = false
    let cancelRequested = false
    let killTimer: NodeJS.Timeout | null = null
    let proc: YtDlpExecProcess | null = null
    // Captured early — the "Downloading 1 format(s): X" info line yt-dlp
    // prints right after format selection. It happens before the download
    // body so it can fall outside the 8KB stdout tail; we sniff streaming
    // chunks instead and keep the last value across the whole run.
    let formatIdSeen: string | undefined
    let filePathSeen: string | undefined
    let outputPathProbe = ''
    let subtitleSignalProbe = ''
    let subtitleUnavailableSeen = false
    let mediaDurationMs: number | null = null
    let subtitleVisibility: 'public' | 'private' | 'unlisted' | undefined
    const subtitleLanguagesSeen = new Set<string>()
    let progressAggregator = new DownloadProgressAggregator()
    let subtitleFallbackAttempted = false
    const canRetryWithoutSubtitles = !(ctx.input.rawArgs?.length || this.opts.buildArgs)

    /** Preserve complete path signals even after the persisted log tail rolls over. */
    const captureOutputPath = (text: string): void => {
      outputPathProbe = `${outputPathProbe}${text}`.slice(-OUTPUT_PATH_SCAN_BYTES)
      const filePath = extractSavedFilePath(outputPathProbe)
      if (filePath) {
        filePathSeen = filePath
      }
    }

    /** Preserve subtitle outcome signals even after the persisted log tail rolls over. */
    const captureSubtitleSignals = (text: string): void => {
      subtitleSignalProbe = `${subtitleSignalProbe}${text}`.slice(-OUTPUT_PATH_SCAN_BYTES)
      const duration = subtitleSignalProbe.match(/VIDBEE_DURATION:(\d+(?:\.\d+)?)/)
      if (duration) {
        mediaDurationMs = Number(duration[1]) * 1000
      }
      const visibility = subtitleSignalProbe.match(/VIDBEE_VISIBILITY:(public|private|unlisted)\b/)
      if (visibility) {
        subtitleVisibility = visibility[1] as 'public' | 'private' | 'unlisted'
      }
      for (const language of extractDownloadedSubtitleLanguages(subtitleSignalProbe)) {
        subtitleLanguagesSeen.add(language)
      }
      if (SUBTITLE_UNAVAILABLE_INFO.test(subtitleSignalProbe)) {
        subtitleUnavailableSeen = true
      }
    }

    const finishOnce = (e: Parameters<ExecutorEvents['onFinish']>[0]) => {
      if (settled) {
        return
      }
      settled = true
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      events.onFinish(e)
    }

    const launch = (settingsOverride?: DownloadRuntimeSettings): ExecutorRun => {
      if (cancelRequested || settled) {
        return makeNoopRun()
      }
      let args: string[]
      try {
        args = this.buildArgsFor(ctx.input, settingsOverride)
      } catch (err) {
        const error = virtualError('unknown', String(err instanceof Error ? err.message : err))
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'error', error, exitCode: null },
          closedAt: this.opts.clock(),
          stdoutTail: '',
          stderrTail: String(err instanceof Error ? err.message : err)
        })
        return makeNoopRun()
      }
      const subtitlesRequested = hasSubtitleDownloadArgs(args)
      const initialSubtitleStatus = this.resolveInitialSubtitleStatus(ctx.input)

      const ffmpegLocation = this.opts.resolveFfmpegLocation()
      if (!ffmpegLocation) {
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: {
            type: 'error',
            error: virtualError('binary-missing', FFMPEG_NOT_FOUND_ERROR),
            exitCode: null
          },
          closedAt: this.opts.clock(),
          stdoutTail: '',
          stderrTail: FFMPEG_NOT_FOUND_ERROR
        })
        return makeNoopRun()
      }
      insertFfmpegLocation(args, ffmpegLocation)

      const controller = new AbortController()
      let ytDlpPath: string
      try {
        ytDlpPath = this.opts.resolveYtDlpPath()
      } catch (err) {
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: {
            type: 'error',
            error: virtualError('binary-missing', String(err instanceof Error ? err.message : err)),
            exitCode: null
          },
          closedAt: this.opts.clock(),
          stdoutTail: '',
          stderrTail: String(err instanceof Error ? err.message : err)
        })
        return makeNoopRun()
      }

      /** Record stdout signals used for progress, output discovery, and format diagnostics. */
      const pumpStdoutPostprocess = (chunk: Buffer): void => {
        const text = chunk.toString()
        stdoutTail.append(text)
        captureOutputPath(text)
        captureSubtitleSignals(text)
        if (!postprocessSeen && hasPostprocessSignal(text)) {
          postprocessSeen = true
        }
        const fid = extractFormatId(text)
        if (fid) {
          formatIdSeen = fid
        }
      }

      /** Record stderr and forward it to the task log stream. */
      const pumpStderrPostprocess = (chunk: Buffer): void => {
        const text = chunk.toString()
        stderrTail.append(text)
        captureOutputPath(text)
        captureSubtitleSignals(text)
        if (!postprocessSeen && hasPostprocessSignal(text)) {
          postprocessSeen = true
        }
        events.onStd({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          stream: 'stderr',
          line: text.replace(/\r?\n$/, '')
        })
      }

      /** Spawn one yt-dlp child with the shared cancellation signal. */
      const spawnProcess = (processArgs: string[]): YtDlpExecProcess =>
        this.opts.spawnFn
          ? this.opts.spawnFn(ytDlpPath, processArgs, controller.signal)
          : this.getYtDlp(ytDlpPath).exec(processArgs, { signal: controller.signal })

      /** Finish a successful child after verifying the output file on disk. */
      const finishSuccessfulProcess = (closedAt: number): void => {
        const stdout = stdoutTail.read()
        const stderr = stderrTail.read()
        const filePath = filePathSeen ?? extractSavedFilePath(`${stdout}\n${stderr}`) ?? ''
        // Stat the produced file so the kernel's processing→completed guard
        // (size > 0) sees real bytes and downstream projections (history UI,
        // SSE events, CLI envelope) report the correct file size. statSync
        // here is the safest place: yt-dlp has just exited 0 so the file is
        // closed and on disk.
        let realSize = 0
        if (filePath) {
          try {
            if (existsSync(filePath)) {
              realSize = statSync(filePath).size
            }
          } catch {
            // ignore — kernel guard will demote to failed('output-missing')
          }
        }
        const output: TaskOutput = {
          filePath,
          size: realSize,
          durationMs: mediaDurationMs,
          sha256: null,
          // Prefer the streaming sniff (captures even if pushed out of the
          // tail buffer); fall back to a tail re-scan when running with
          // tiny test fixtures whose entire run fits in 8KB.
          formatId: formatIdSeen ?? extractFormatId(stdout) ?? null
        }
        const subtitleOutcome = resolveSubtitleOutcome({
          downloadedLanguages: [...subtitleLanguagesSeen],
          fallbackAttempted: subtitleFallbackAttempted,
          initialStatus: initialSubtitleStatus,
          subtitlesRequested,
          unavailableSeen: subtitleUnavailableSeen
        })
        if (subtitleOutcome) {
          output.subtitleStatus = subtitleOutcome.status
          output.subtitleAcquisition = {
            id: ctx.attemptId,
            acquiredAt: closedAt,
            visibility: subtitleVisibility,
            credentialsUsed: args.includes('--ignore-config')
              ? args.some((argument) =>
                  /^(?:--cookies|--cookies-from-browser|--username|--password|--netrc|--netrc-location|--netrc-cmd|--add-header)(?:=|$)/.test(
                    argument
                  )
                )
              : undefined
          }
          if (subtitleOutcome.languages) {
            output.subtitleLanguages = subtitleOutcome.languages
          }
        }
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'success', output },
          closedAt,
          stdoutTail: stdout,
          stderrTail: stderr
        })
      }

      /** Finish one uncaught child-process error without waiting for close. */
      const finishProcessError = (err: Error): void => {
        const closedAt = this.opts.clock()
        if (cancelRequested) {
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: { type: 'cancelled' },
            closedAt,
            stdoutTail: stdoutTail.read(),
            stderrTail: stderrTail.read()
          })
          return
        }
        const error = classifyYtDlpExit(null, `${stderrTail.read()}\n${err.message}`)
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'error', error, exitCode: null },
          closedAt,
          stdoutTail: stdoutTail.read(),
          stderrTail: stderrTail.read()
        })
      }

      /** Bind one process, transparently replacing subtitle-only failures once. */
      const bindProcess = (target: YtDlpExecProcess, processArgs: string[]): void => {
        let processStderr = ''

        target.ytDlpProcess?.stdout?.on('data', (chunk: Buffer) => {
          if (target !== proc) {
            return
          }
          pumpStdoutPostprocess(chunk)
          events.onStd({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            stream: 'stdout',
            line: chunk.toString().replace(/\r?\n$/, '')
          })
        })

        target.ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => {
          if (target === proc) {
            processStderr = `${processStderr}${chunk.toString()}`.slice(-STDERR_TAIL_BYTES)
            pumpStderrPostprocess(chunk)
          }
        })

        target.on('progress', (payload: YtDlpProgressPayload) => {
          if (target !== proc) {
            return
          }
          const progress = progressAggregator.apply(payload)
          if (!progress) {
            return
          }
          events.onProgress({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            progress,
            enteredProcessing: postprocessSeen
          })
        })

        target.on('close', (code: number | null) => {
          if (target !== proc || settled) {
            return
          }
          const closedAt = this.opts.clock()
          const stdout = stdoutTail.read()
          const stderr = stderrTail.read()
          if (cancelRequested) {
            finishOnce({
              taskId: ctx.taskId,
              attemptId: ctx.attemptId,
              result: { type: 'cancelled' },
              closedAt,
              stdoutTail: stdout,
              stderrTail: stderr
            })
            return
          }
          if (code === 0) {
            finishSuccessfulProcess(closedAt)
            return
          }
          const savedPath = filePathSeen ?? extractSavedFilePath(`${stdout}\n${stderr}`)
          // GitHub issue #467: cover embedding can fail after a valid WebM
          // (or other unsupported container) is already on disk. Keep that
          // media file instead of reporting the download as failed.
          if (
            hasNonEmptyFile(savedPath) &&
            isUnsupportedThumbnailEmbedOnlyFailure(processStderr || stderr)
          ) {
            stderrTail.append(`\n${THUMBNAIL_EMBED_UNSUPPORTED_LOG}\n`)
            finishSuccessfulProcess(closedAt)
            return
          }
          if (
            !subtitleFallbackAttempted &&
            canRetryWithoutSubtitles &&
            hasSubtitleDownloadArgs(processArgs) &&
            SUBTITLE_DOWNLOAD_ERROR.test(processStderr)
          ) {
            subtitleFallbackAttempted = true
            stderrTail.append(`${SUBTITLE_FALLBACK_LOG}\n`)
            events.onStd({
              taskId: ctx.taskId,
              attemptId: ctx.attemptId,
              stream: 'stderr',
              line: SUBTITLE_FALLBACK_LOG
            })
            progressAggregator = new DownloadProgressAggregator()
            postprocessSeen = false
            try {
              const fallbackArgs = withoutSubtitleDownloadArgs(processArgs)
              proc = spawnProcess(fallbackArgs)
              bindProcess(proc, fallbackArgs)
            } catch (err) {
              finishProcessError(err instanceof Error ? err : new Error(String(err)))
            }
            return
          }
          const error = classifyYtDlpExit(code, processStderr || stderr)
          finishOnce({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: { type: 'error', error, exitCode: code ?? null },
            closedAt,
            stdoutTail: stdout,
            stderrTail: stderr
          })
        })

        target.on('error', (err: Error) => {
          if (target === proc) {
            finishProcessError(err)
          }
        })
      }

      try {
        proc = spawnProcess(args)
      } catch (err) {
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: {
            type: 'error',
            error: virtualError('unknown', String(err instanceof Error ? err.message : err)),
            exitCode: null
          },
          closedAt: this.opts.clock(),
          stdoutTail: stdoutTail.read(),
          stderrTail: stderrTail.read()
        })
        return makeNoopRun()
      }

      // Emit onSpawn once for the executor attempt. A subtitle-only fallback is
      // an internal recovery and keeps the same task attempt and cancellation handle.
      const pid = proc.ytDlpProcess?.pid ?? -1
      events.onSpawn({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        pid,
        pidStartedAt: null,
        kind: 'yt-dlp',
        spawnedAt: this.opts.clock()
      })
      bindProcess(proc, args)

      const cancel = async (timeout?: number): Promise<void> => {
        if (settled) {
          return
        }
        cancelRequested = true
        const grace = timeout ?? this.opts.killGraceMs
        try {
          controller.abort()
        } catch {
          /* noop */
        }
        try {
          killProcessTree(proc?.ytDlpProcess?.pid, 'SIGTERM')
        } catch {
          /* noop */
        }
        if (killTimer) {
          clearTimeout(killTimer)
        }
        if (grace > 0) {
          killTimer = setTimeout(() => {
            try {
              killProcessTree(proc?.ytDlpProcess?.pid, 'SIGKILL')
            } catch {
              /* noop */
            }
          }, grace)
        } else {
          try {
            killProcessTree(proc?.ytDlpProcess?.pid, 'SIGKILL')
          } catch {
            /* noop */
          }
        }
      }

      return {
        cancel,
        pause: () => cancel(this.opts.killGraceMs)
      }
    }

    if (!this.opts.prepareSettings) {
      return launch()
    }

    let launched: ExecutorRun | undefined
    const pendingCancel = async (timeout?: number): Promise<void> => {
      cancelRequested = true
      if (launched) {
        await launched.cancel(timeout)
      }
    }
    void this.opts.prepareSettings(ctx.input).then(
      (prepared) => {
        if (cancelRequested || settled) {
          return
        }
        launched = launch(prepared ?? undefined)
      },
      (err) => {
        const message = String(err instanceof Error ? err.message : err)
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'error', error: virtualError('unknown', message), exitCode: null },
          closedAt: this.opts.clock(),
          stdoutTail: '',
          stderrTail: message
        })
      }
    )
    return {
      cancel: pendingCancel,
      pause: () => pendingCancel(this.opts.killGraceMs)
    }
  }

  /** Merge host defaults with per-task runtime setting overrides. */
  private resolveRuntimeSettings(
    input: TaskInput,
    override?: DownloadRuntimeSettings
  ): DownloadRuntimeSettings {
    const opts = (input.options ?? {}) as YtDlpTaskOptions
    return {
      ...this.opts.defaultRuntimeSettings,
      ...(opts.settings ?? {}),
      ...(override ?? {})
    }
  }

  /** Detect user-visible subtitle skips that happen before yt-dlp starts. */
  private resolveInitialSubtitleStatus(input: TaskInput): TaskOutput['subtitleStatus'] | undefined {
    if (input.rawArgs?.length || this.opts.buildArgs) {
      return undefined
    }
    const opts = (input.options ?? {}) as YtDlpTaskOptions
    const type = opts.type ?? (input.kind === 'audio' ? 'audio' : 'video')
    const skipReason = resolveSubtitleDownloadSkipReason(
      { type, url: input.url },
      this.resolveRuntimeSettings(input)
    )
    return skipReason === 'auth-required' ? 'skipped-auth' : undefined
  }

  /** Build the final yt-dlp arguments for one task input. */
  private buildArgsFor(input: TaskInput, settingsOverride?: DownloadRuntimeSettings): string[] {
    if (this.opts.buildArgs) {
      return this.opts.buildArgs(input, this.opts.defaultDownloadDir)
    }
    if (input.rawArgs && input.rawArgs.length > 0) {
      return [...input.rawArgs]
    }
    const opts = (input.options ?? {}) as YtDlpTaskOptions
    const type = opts.type ?? (input.kind === 'audio' ? 'audio' : 'video')
    const settings = this.resolveRuntimeSettings(input, settingsOverride)
    const downloadPath =
      opts.customDownloadPath?.trim() ||
      settings.downloadPath?.trim() ||
      this.opts.defaultDownloadDir
    const merged: DownloadRuntimeSettings = { ...settings, downloadPath }
    const extra = this.opts.extraArgs ? [...this.opts.extraArgs()] : []
    return buildDownloadArgs(
      {
        url: input.url,
        type,
        format: opts.format,
        audioFormat: opts.audioFormat,
        audioFormatIds: opts.audioFormatIds ? [...opts.audioFormatIds] : undefined,
        startTime: opts.startTime,
        endTime: opts.endTime,
        customDownloadPath: opts.customDownloadPath,
        customFilenameTemplate: opts.customFilenameTemplate,
        containerFormat: opts.containerFormat
      },
      this.opts.defaultDownloadDir,
      merged,
      extra
    )
  }

  /** Diagnostic: return the resolved argv yt-dlp would be invoked with. */
  describeCommandFor(input: TaskInput): string {
    return formatYtDlpCommand(this.buildArgsFor(input))
  }

  private getYtDlp(binaryPath: string): YtDlpWrapInstance {
    if (this.cachedYtDlp && this.cachedYtDlpPath === binaryPath) {
      return this.cachedYtDlp
    }
    this.cachedYtDlp = new YTDlpWrapCtor(binaryPath)
    this.cachedYtDlpPath = binaryPath
    return this.cachedYtDlp
  }
}

/**
 * Return whether an argv snapshot asks yt-dlp to fetch or embed subtitles.
 *
 * @param args Full yt-dlp argv.
 * @returns True when subtitle download behavior is enabled.
 */
const hasSubtitleDownloadArgs = (args: readonly string[]): boolean =>
  args.some(
    (arg) => arg === '--embed-subs' || arg === '--write-auto-subs' || arg === '--write-subs'
  )

/**
 * Remove subtitle options and append explicit opt-outs before the source URL.
 *
 * @param args Full yt-dlp argv from the failed process.
 * @returns A retry argv that downloads the media without subtitles.
 */
const withoutSubtitleDownloadArgs = (args: readonly string[]): string[] => {
  const filtered: string[] = []
  let skipNextValue = false

  for (const arg of args) {
    if (skipNextValue) {
      skipNextValue = false
      continue
    }
    if (SUBTITLE_OPTIONS_WITH_VALUE.has(arg)) {
      skipNextValue = true
      continue
    }
    if (SUBTITLE_TOGGLE_OPTIONS.has(arg)) {
      continue
    }
    filtered.push(arg)
  }

  const sourceUrl = filtered.pop()
  filtered.push('--no-write-subs', '--no-write-auto-subs', '--no-embed-subs')
  if (sourceUrl) {
    filtered.push(sourceUrl)
  }
  return filtered
}

function makeNoopRun(): ExecutorRun {
  return {
    cancel: async () => {
      /* noop */
    },
    pause: async () => {
      /* noop */
    }
  }
}

function insertFfmpegLocation(args: string[], ffmpegLocation: string): void {
  const urlArg = args.pop()
  args.push('--ffmpeg-location', ffmpegLocation)
  if (urlArg !== undefined) {
    args.push(urlArg)
  }
}

function hasPostprocessSignal(text: string): boolean {
  return PROCESSING_DETECT_PATTERNS.some((re) => re.test(text))
}

/** Return whether a produced media file is present and non-empty. */
function hasNonEmptyFile(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  try {
    return existsSync(filePath) && statSync(filePath).size > 0
  } catch {
    return false
  }
}

/**
 * Tail stdout for yt-dlp's "Downloading 1 format(s): X" info line. The
 * value `X` (e.g. `30080+30280`) is the resolved format id picked by the
 * chain — hosts compare it to the user's single-format pick to detect
 * that the fallback (`/best`) kicked in.
 */
function extractFormatId(rawLog: string): string | undefined {
  const log = rawLog.trim()
  if (!log) {
    return undefined
  }
  // [info] BV...: Downloading 1 format(s): 30080+30280
  const re = /Downloading\s+\d+\s+format\(s\):\s+([^\r\n]+)/gi
  const matches = Array.from(log.matchAll(re))
  const last = matches.at(-1)
  const value = last?.[1]?.trim()
  if (!value) {
    return undefined
  }
  return value
}

function extractSavedFilePath(rawLog: string): string | undefined {
  const log = rawLog.trim()
  if (!log) {
    return undefined
  }
  const patterns: RegExp[] = [
    new RegExp(`^${VIDBEE_OUTPUT_PATH_PREFIX}(.+)$`, 'gm'),
    /Merging formats into "([^"]+)"/g,
    /Destination:\s+"([^"]+)"/g,
    /Destination:\s+'([^']+)'/g,
    /\[download\]\s+([^\r\n]+?)\s+has already been downloaded/g,
    /\[MoveFiles\]\s+Moving file "[^"]+" to "([^"]+)"/g,
    /\[(?:EmbedSubtitle|EmbedThumbnail|FixupM3u8|Metadata)\].*?"([^"]+)"/g,
    /\[(?:ExtractAudio|VideoConvertor|VideoRemuxer)\].*?\bto "([^"]+)"/g
  ]
  let latestMatchIndex = -1
  let latestCandidate: string | undefined
  for (const re of patterns) {
    for (const match of log.matchAll(re)) {
      const candidate = match[1]?.trim()
      const matchIndex = match.index ?? -1
      if (candidate && matchIndex >= latestMatchIndex) {
        latestMatchIndex = matchIndex
        latestCandidate = candidate
      }
    }
  }
  if (latestCandidate) {
    return latestCandidate
  }
  const lines = log.split(/\r?\n/).reverse()
  for (const line of lines) {
    const idx = line.indexOf('Destination:')
    if (idx >= 0) {
      const candidate = line.slice(idx + 'Destination:'.length).trim()
      if (candidate) {
        return candidate
      }
    }
  }
  return undefined
}

/** Use the queue's canonical classifier for both process errors and non-zero exits. */
function classifyYtDlpExit(exitCode: number | null, stderr: string): ClassifiedError {
  return classify({ exitCode, stderr: stderr || `yt-dlp exited with code ${exitCode ?? -1}` })
}

interface TailBuffer {
  append: (text: string) => void
  read: () => string
}

function createTailBuffer(maxBytes: number): TailBuffer {
  let buf = ''
  return {
    append(text) {
      buf += text
      if (buf.length > maxBytes * 4) {
        // Avoid pathological growth before truncate.
        buf = buf.slice(buf.length - maxBytes)
      }
    },
    read() {
      return buf.length > maxBytes ? buf.slice(buf.length - maxBytes) : buf
    }
  }
}

// Re-export types adapters need to wire host-specific args building.
export type { ExecutorContext, ExecutorEvents, ExecutorRun, TaskInput }
