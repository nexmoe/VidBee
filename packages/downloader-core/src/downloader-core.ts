import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type {
  CreateDownloadInput,
  DownloadTask,
  VideoFormat,
  VideoInfo
} from './types'

const require = createRequire(import.meta.url)
const YTDlpWrapModule = require('yt-dlp-wrap-plus')

interface YtDlpExecProcess {
  ytDlpProcess?: {
    stdout?: NodeJS.ReadableStream
    stderr?: NodeJS.ReadableStream
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

interface ActiveTask {
  controller: AbortController
  process: YtDlpExecProcess
}

interface RawVideoInfo {
  id?: string
  title?: string
  thumbnail?: string | null
  duration?: number | null
  formats?: Array<{
    format_id?: string | null
    ext?: string | null
    width?: number | null
    height?: number | null
    fps?: number | null
    vcodec?: string | null
    acodec?: string | null
    filesize?: number | null
    filesize_approx?: number | null
    format_note?: string | null
    tbr?: number | null
  }>
}

interface ProgressPayload {
  percent?: number
  currentSpeed?: string
  eta?: string
  downloaded?: string
  total?: string
}

export interface DownloaderCoreOptions {
  downloadDir?: string
  maxConcurrent?: number
}

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'VidBee')
const DEFAULT_MAX_CONCURRENT = 3

const tryCommandPath = (command: string): string | null => {
  const commandName = process.platform === 'win32' ? `where ${command}` : `which ${command}`
  try {
    const output = execSync(commandName, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => value.length > 0)
    return output ?? null
  } catch {
    return null
  }
}

const resolveYtDlpPath = (): string => {
  const envPath = process.env.YTDLP_PATH?.trim()
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }
  const commandPath = tryCommandPath('yt-dlp')
  if (commandPath) {
    return commandPath
  }
  throw new Error('yt-dlp binary not found. Set YTDLP_PATH or install yt-dlp in PATH.')
}

const resolveFfmpegLocation = (): string | undefined => {
  const envPath = process.env.FFMPEG_PATH?.trim()
  if (envPath && fs.existsSync(envPath)) {
    const stats = fs.statSync(envPath)
    return stats.isDirectory() ? envPath : path.dirname(envPath)
  }
  const commandPath = tryCommandPath('ffmpeg')
  if (!commandPath) {
    return undefined
  }
  return path.dirname(commandPath)
}

const clampPercent = (value: unknown): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 100) {
    return 100
  }
  return value
}

const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined
  }

  return value
}

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  return value
}

const toTerminal = (task: DownloadTask): boolean =>
  task.status === 'completed' || task.status === 'error' || task.status === 'cancelled'

export class DownloaderCore extends EventEmitter {
  private readonly maxConcurrent: number
  private readonly downloadDir: string
  private readonly tasks = new Map<string, DownloadTask>()
  private readonly taskInputs = new Map<string, CreateDownloadInput>()
  private readonly active = new Map<string, ActiveTask>()
  private readonly pending: string[] = []
  private readonly history = new Map<string, DownloadTask>()
  private readonly cancelled = new Set<string>()
  private ytdlp: YtDlpWrapInstance | null = null
  private ffmpegLocation: string | undefined

  constructor(options: DownloaderCoreOptions = {}) {
    super()
    this.maxConcurrent = Math.max(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT, 1)
    this.downloadDir = options.downloadDir?.trim() || DEFAULT_DOWNLOAD_DIR
  }

  async initialize(): Promise<void> {
    if (this.ytdlp) {
      return
    }
    fs.mkdirSync(this.downloadDir, { recursive: true })
    this.ffmpegLocation = resolveFfmpegLocation()
    this.ytdlp = new YTDlpWrapCtor(resolveYtDlpPath())
  }

  private getYtDlp(): YtDlpWrapInstance {
    if (!this.ytdlp) {
      throw new Error('DownloaderCore is not initialized.')
    }
    return this.ytdlp
  }

  private updateTask(id: string, patch: Partial<DownloadTask>): DownloadTask | null {
    const existing = this.tasks.get(id)
    if (!existing) {
      return null
    }
    const next: DownloadTask = { ...existing, ...patch }
    this.tasks.set(id, next)

    if (toTerminal(next)) {
      this.history.set(id, next)
      this.taskInputs.delete(id)
    }

    const snapshot = { ...next }
    this.emit('task-updated', snapshot)
    this.emit('queue-updated', this.listDownloads())
    return snapshot
  }

  private async runJsonCommand(args: string[]): Promise<RawVideoInfo> {
    const process = this.getYtDlp().exec(args)
    let stdout = ''
    let stderr = ''

    process.ytDlpProcess?.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    process.ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const code = await new Promise<number | null>((resolve, reject) => {
      process.once('close', (exitCode: number | null) => resolve(exitCode))
      process.once('error', reject)
    })

    if (code !== 0 || !stdout.trim()) {
      throw new Error(stderr.trim() || `yt-dlp exited with code ${code ?? -1}`)
    }

    return JSON.parse(stdout) as RawVideoInfo
  }

  async getVideoInfo(url: string): Promise<VideoInfo> {
    await this.initialize()
    const target = url.trim()
    if (!target) {
      throw new Error('URL is required.')
    }

    const raw = await this.runJsonCommand(['-J', '--no-warnings', '--encoding', 'utf-8', target])
    const formats: VideoFormat[] = (raw.formats ?? []).map((format) => ({
      formatId: format.format_id ?? 'unknown',
      ext: format.ext ?? 'unknown',
      width: toOptionalNumber(format.width),
      height: toOptionalNumber(format.height),
      fps: toOptionalNumber(format.fps),
      vcodec: toOptionalString(format.vcodec),
      acodec: toOptionalString(format.acodec),
      filesize: toOptionalNumber(format.filesize),
      filesizeApprox: toOptionalNumber(format.filesize_approx),
      formatNote: toOptionalString(format.format_note),
      tbr: toOptionalNumber(format.tbr)
    }))

    return {
      id: raw.id ?? target,
      title: raw.title ?? target,
      thumbnail: toOptionalString(raw.thumbnail),
      duration: toOptionalNumber(raw.duration),
      formats
    }
  }

  async createDownload(input: CreateDownloadInput): Promise<DownloadTask> {
    await this.initialize()
    const id = randomUUID()
    const now = Date.now()
    const task: DownloadTask = {
      id,
      url: input.url,
      type: input.type,
      status: 'pending',
      createdAt: now
    }

    this.tasks.set(id, task)
    this.taskInputs.set(id, { ...input })
    this.pending.push(id)
    this.emit('queue-updated', this.listDownloads())
    this.processQueue()

    return { ...task }
  }

  private processQueue(): void {
    if (this.active.size >= this.maxConcurrent) {
      return
    }

    const nextId = this.pending.shift()
    if (!nextId) {
      return
    }

    const task = this.tasks.get(nextId)
    if (!task) {
      this.processQueue()
      return
    }
    const input = this.taskInputs.get(nextId)
    if (!input) {
      this.updateTask(nextId, {
        status: 'error',
        completedAt: Date.now(),
        error: 'Missing download input'
      })
      this.processQueue()
      return
    }

    const controller = new AbortController()
    const outputTemplate = path.join(this.downloadDir, '%(title)s.%(ext)s')
    const args = ['--newline', '--no-warnings', '--progress', '-o', outputTemplate]

    if (input.type === 'audio') {
      args.push('-x', '--audio-format', input.audioFormat ?? 'mp3')
    } else if (input.format) {
      args.push('-f', input.format)
    }

    if (this.ffmpegLocation) {
      args.push('--ffmpeg-location', this.ffmpegLocation)
    }

    args.push(task.url)

    const process = this.getYtDlp().exec(args, {
      signal: controller.signal
    })

    this.active.set(nextId, { controller, process })
    this.updateTask(nextId, {
      status: 'downloading',
      startedAt: Date.now(),
      progress: { percent: 0 }
    })

    process.on('progress', (payload: ProgressPayload) => {
      this.updateTask(nextId, {
        progress: {
          percent: clampPercent(payload.percent),
          currentSpeed: payload.currentSpeed,
          eta: payload.eta,
          downloaded: payload.downloaded,
          total: payload.total
        }
      })
    })

    let settled = false
    const isCancelled = (): boolean => controller.signal.aborted || this.cancelled.has(nextId)
    const finalizeTask = (patch: Pick<DownloadTask, 'status'> & Partial<DownloadTask>): void => {
      if (settled) {
        return
      }
      settled = true
      this.active.delete(nextId)
      this.cancelled.delete(nextId)
      this.updateTask(nextId, {
        ...patch,
        completedAt: patch.completedAt ?? Date.now()
      })
      this.processQueue()
    }

    process.on('close', (code: number | null) => {
      if (settled) {
        return
      }

      if (isCancelled()) {
        finalizeTask({
          status: 'cancelled',
          progress: { percent: 0 }
        })
        return
      }

      if (code === 0) {
        finalizeTask({
          status: 'completed',
          progress: { percent: 100 }
        })
        return
      }

      finalizeTask({
        status: 'error',
        error: `yt-dlp exited with code ${code ?? -1}`
      })
    })

    process.on('error', (error: Error) => {
      if (settled) {
        return
      }

      if (isCancelled()) {
        finalizeTask({
          status: 'cancelled',
          progress: { percent: 0 }
        })
        return
      }

      finalizeTask({
        status: 'error',
        error: error.message
      })
    })

    this.processQueue()
  }

  async cancelDownload(id: string): Promise<boolean> {
    const active = this.active.get(id)
    if (active) {
      this.cancelled.add(id)
      active.controller.abort()
      return true
    }

    const pendingIndex = this.pending.findIndex((value) => value === id)
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1)
      this.updateTask(id, {
        status: 'cancelled',
        completedAt: Date.now()
      })
      return true
    }

    return false
  }

  listDownloads(): DownloadTask[] {
    return Array.from(this.tasks.values())
      .filter((task) => !toTerminal(task))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((task) => ({ ...task }))
  }

  listHistory(): DownloadTask[] {
    return Array.from(this.history.values())
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))
      .map((task) => ({ ...task }))
  }

  getStatus(): { active: number; pending: number } {
    return { active: this.active.size, pending: this.pending.length }
  }
}
