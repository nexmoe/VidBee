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
import { createRequire } from 'node:module'

import type {
  ClassifiedError,
  Executor,
  ExecutorContext,
  ExecutorEvents,
  ExecutorRun,
  TaskInput,
  TaskOutput,
  TaskProgress
} from '@vidbee/task-queue'
import { killProcessTree } from '@vidbee/task-queue/process'
import { virtualError } from '@vidbee/task-queue'

import type { DownloadRuntimeSettings } from './types'
import type { OneClickContainerOption } from './format-preferences'
import { buildDownloadArgs, formatYtDlpCommand } from './yt-dlp-args'

const require = createRequire(import.meta.url)
const YTDlpWrapModule = require('yt-dlp-wrap-plus')

interface YtDlpExecProcess {
  ytDlpProcess?: {
    pid?: number
    stdout?: NodeJS.ReadableStream
    stderr?: NodeJS.ReadableStream
    kill: (signal?: NodeJS.Signals | number) => boolean
  }
  on(event: 'progress', listener: (payload: ProgressPayload) => void): this
  on(event: 'close', listener: (code: number | null) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  once(event: 'close', listener: (code: number | null) => void): this
  once(event: 'error', listener: (error: Error) => void): this
}

interface YtDlpWrapInstance {
  exec(args: string[], options?: { signal?: AbortSignal }): YtDlpExecProcess
}

type YtDlpWrapConstructor = new (binaryPath: string) => YtDlpWrapInstance
const YTDlpWrapCtor = (YTDlpWrapModule.default ?? YTDlpWrapModule) as YtDlpWrapConstructor

interface ProgressPayload {
  percent?: number
  currentSpeed?: string
  eta?: string
  downloaded?: string
  total?: string
}

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
const PROCESSING_DETECT_PATTERNS = [
  /\bMerging formats?\b/i,
  /^\[Postprocess\]/m,
  /\b(?:Embedding|Adding|Fixing|Converting)\b/i,
  /\b(?:ExtractAudio|VideoConvertor|FFmpeg)\b/i
]

const FFMPEG_NOT_FOUND_ERROR =
  'ffmpeg/ffprobe not found. Use Desktop resources/ffmpeg, install in PATH, or set FFMPEG_PATH.'

export class YtDlpExecutor implements Executor {
  private readonly opts: Required<
    Omit<YtDlpExecutorOptions, 'extraArgs' | 'buildArgs' | 'spawnFn' | 'defaultRuntimeSettings'>
  > &
    Pick<YtDlpExecutorOptions, 'extraArgs' | 'buildArgs' | 'spawnFn'> & {
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

    const finishOnce = (e: Parameters<ExecutorEvents['onFinish']>[0]) => {
      if (settled) return
      settled = true
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = null
      }
      events.onFinish(e)
    }

    let args: string[]
    try {
      args = this.buildArgsFor(ctx.input)
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

    try {
      proc = this.opts.spawnFn
        ? this.opts.spawnFn(ytDlpPath, args, controller.signal)
        : this.getYtDlp(ytDlpPath).exec(args, { signal: controller.signal })
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

    // Emit onSpawn as soon as we can read pid. yt-dlp-wrap-plus exposes
    // `ytDlpProcess` synchronously after exec().
    const pid = proc.ytDlpProcess?.pid ?? -1
    events.onSpawn({
      taskId: ctx.taskId,
      attemptId: ctx.attemptId,
      pid,
      pidStartedAt: null,
      kind: 'yt-dlp',
      spawnedAt: this.opts.clock()
    })

    const pumpStdoutPostprocess = (chunk: Buffer): void => {
      const text = chunk.toString()
      stdoutTail.append(text)
      if (!postprocessSeen && hasPostprocessSignal(text)) {
        postprocessSeen = true
      }
      const fid = extractFormatId(text)
      if (fid) {
        formatIdSeen = fid
      }
    }

    const pumpStderrPostprocess = (chunk: Buffer): void => {
      const text = chunk.toString()
      stderrTail.append(text)
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

    proc.ytDlpProcess?.stdout?.on('data', (chunk: Buffer) => {
      pumpStdoutPostprocess(chunk)
      events.onStd({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        stream: 'stdout',
        line: chunk.toString().replace(/\r?\n$/, '')
      })
    })

    proc.ytDlpProcess?.stderr?.on('data', pumpStderrPostprocess)

    proc.on('progress', (payload: ProgressPayload) => {
      const progress = mapProgress(payload)
      events.onProgress({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        progress,
        enteredProcessing: postprocessSeen
      })
    })

    proc.on('close', (code: number | null) => {
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
        const filePath = extractSavedFilePath(stdout) || ''
        // Stat the produced file so the kernel's processing→completed guard
        // (size > 0) sees real bytes and downstream projections (history UI,
        // SSE events, CLI envelope) report the correct file size. statSync
        // here is the safest place: yt-dlp has just exited 0 so the file is
        // closed and on disk.
        let realSize = 0
        if (filePath) {
          try {
            if (existsSync(filePath)) realSize = statSync(filePath).size
          } catch {
            // ignore — kernel guard will demote to failed('output-missing')
          }
        }
        const output: TaskOutput = {
          filePath,
          size: realSize,
          durationMs: null,
          sha256: null,
          // Prefer the streaming sniff (captures even if pushed out of the
          // tail buffer); fall back to a tail re-scan when running with
          // tiny test fixtures whose entire run fits in 8KB.
          formatId: formatIdSeen ?? extractFormatId(stdout) ?? null
        }
        finishOnce({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'success', output },
          closedAt,
          stdoutTail: stdout,
          stderrTail: stderr
        })
        return
      }
      const error = classifyYtDlpExit(code, stderr)
      finishOnce({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        result: { type: 'error', error, exitCode: code ?? null },
        closedAt,
        stdoutTail: stdout,
        stderrTail: stderr
      })
    })

    proc.on('error', (err: Error) => {
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
      const error = virtualError('unknown', err.message)
      finishOnce({
        taskId: ctx.taskId,
        attemptId: ctx.attemptId,
        result: { type: 'error', error, exitCode: null },
        closedAt,
        stdoutTail: stdoutTail.read(),
        stderrTail: stderrTail.read()
      })
    })

    const cancel = async (timeout?: number): Promise<void> => {
      if (settled) return
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
      if (killTimer) clearTimeout(killTimer)
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

  private buildArgsFor(input: TaskInput): string[] {
    if (this.opts.buildArgs) return this.opts.buildArgs(input, this.opts.defaultDownloadDir)
    if (input.rawArgs && input.rawArgs.length > 0) {
      return [...input.rawArgs]
    }
    const opts = (input.options ?? {}) as YtDlpTaskOptions
    const type = opts.type ?? (input.kind === 'audio' ? 'audio' : 'video')
    const settings: DownloadRuntimeSettings = {
      ...this.opts.defaultRuntimeSettings,
      ...(opts.settings ?? {})
    }
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
    if (this.cachedYtDlp && this.cachedYtDlpPath === binaryPath) return this.cachedYtDlp
    this.cachedYtDlp = new YTDlpWrapCtor(binaryPath)
    this.cachedYtDlpPath = binaryPath
    return this.cachedYtDlp
  }
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
  if (urlArg !== undefined) args.push(urlArg)
}

function mapProgress(payload: ProgressPayload): TaskProgress {
  const percent =
    typeof payload.percent === 'number' && !Number.isNaN(payload.percent)
      ? Math.max(0, Math.min(1, payload.percent / 100))
      : null
  return {
    percent,
    bytesDownloaded: parseSize(payload.downloaded),
    bytesTotal: parseSize(payload.total),
    speedBps: parseSpeed(payload.currentSpeed),
    etaMs: parseEtaMs(payload.eta),
    ticks: 0
  }
}

function parseSize(value: string | undefined): number | null {
  if (!value) return null
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)/i.exec(value)
  if (!m) return null
  const n = Number.parseFloat(m[1] ?? '')
  if (!Number.isFinite(n)) return null
  const unit = (m[2] ?? 'B').toLowerCase()
  const factor =
    unit === 'kb' || unit === 'kib'
      ? 1024
      : unit === 'mb' || unit === 'mib'
        ? 1024 ** 2
        : unit === 'gb' || unit === 'gib'
          ? 1024 ** 3
          : unit === 'tb' || unit === 'tib'
            ? 1024 ** 4
            : 1
  return Math.round(n * factor)
}

function parseSpeed(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/\/s$/i, '').trim()
  return parseSize(cleaned)
}

function parseEtaMs(value: string | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'Unknown') return null
  const parts = trimmed.split(':').map((p) => Number.parseInt(p, 10))
  if (parts.some((n) => !Number.isFinite(n))) return null
  let seconds = 0
  for (const p of parts) seconds = seconds * 60 + p
  return seconds * 1000
}

function hasPostprocessSignal(text: string): boolean {
  return PROCESSING_DETECT_PATTERNS.some((re) => re.test(text))
}

/**
 * Tail stdout for yt-dlp's "Downloading 1 format(s): X" info line. The
 * value `X` (e.g. `30080+30280`) is the resolved format id picked by the
 * chain — hosts compare it to the user's single-format pick to detect
 * that the fallback (`/best`) kicked in.
 */
function extractFormatId(rawLog: string): string | undefined {
  const log = rawLog.trim()
  if (!log) return undefined
  // [info] BV...: Downloading 1 format(s): 30080+30280
  const re = /Downloading\s+\d+\s+format\(s\):\s+([^\r\n]+)/gi
  const matches = Array.from(log.matchAll(re))
  const last = matches.at(-1)
  const value = last?.[1]?.trim()
  if (!value) return undefined
  return value
}

function extractSavedFilePath(rawLog: string): string | undefined {
  const log = rawLog.trim()
  if (!log) return undefined
  const patterns = [
    /Merging formats into "([^"]+)"/g,
    /Destination:\s+"([^"]+)"/g,
    /Destination:\s+'([^']+)'/g,
    /\[download\]\s+([^\r\n]+?)\s+has already been downloaded/g
  ]
  for (const re of patterns) {
    const matches = Array.from(log.matchAll(re))
    const last = matches.at(-1)
    const candidate = last?.[1]?.trim()
    if (candidate) return candidate
  }
  const lines = log.split(/\r?\n/).reverse()
  for (const line of lines) {
    const idx = line.indexOf('Destination:')
    if (idx >= 0) {
      const candidate = line.slice(idx + 'Destination:'.length).trim()
      if (candidate) return candidate
    }
  }
  return undefined
}

/**
 * Map a yt-dlp non-zero exit + stderr to a ClassifiedError. The kernel's
 * own classifier handles structured retry decisions; we only need to seed
 * with a sensible category.
 */
function classifyYtDlpExit(exitCode: number | null, stderr: string): ClassifiedError {
  const txt = stderr.toLowerCase()
  if (/(http error 429|too many requests|rate.?limit)/.test(txt))
    return virtualError('http-429', stderr || `yt-dlp exited ${exitCode}`)
  if (/(login required|requires (?:cookies|authentication)|sign in to confirm)/.test(txt))
    return virtualError('auth-required', stderr || `yt-dlp exited ${exitCode}`)
  if (/(not available in your country|geo.?restricted|geographic)/.test(txt))
    return virtualError('geo-blocked', stderr || `yt-dlp exited ${exitCode}`)
  if (/(video unavailable|not found|404)/.test(txt))
    return virtualError('not-found', stderr || `yt-dlp exited ${exitCode}`)
  if (/(no space left|disk full|enospc)/.test(txt))
    return virtualError('disk-full', stderr || `yt-dlp exited ${exitCode}`)
  if (/(permission denied|eacces)/.test(txt))
    return virtualError('permission-denied', stderr || `yt-dlp exited ${exitCode}`)
  if (/(ffmpeg|ffprobe)/.test(txt))
    return virtualError('ffmpeg', stderr || `yt-dlp exited ${exitCode}`)
  if (/(network|timeout|econnreset|enotfound|ehostunreach)/.test(txt))
    return virtualError('network-transient', stderr || `yt-dlp exited ${exitCode}`)
  return virtualError('unknown', stderr || `yt-dlp exited with code ${exitCode ?? -1}`)
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
export type { TaskInput, ExecutorContext, ExecutorEvents, ExecutorRun }
