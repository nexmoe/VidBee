import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  CreateDownloadInput,
  DownloadRuntimeSettings,
  DownloadTask,
  PlaylistDownloadInput,
  PlaylistDownloadResult,
  PlaylistInfo,
  VideoFormat,
  VideoInfo
} from './types'
import {
  buildDownloadArgs,
  buildPlaylistInfoArgs,
  buildVideoInfoArgs,
  formatYtDlpCommand
} from './yt-dlp-args'

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
  extractor_key?: string | null
  webpage_url?: string | null
  description?: string | null
  view_count?: number | null
  uploader?: string | null
  tags?: unknown
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
    quality?: number | null
    protocol?: string | null
    language?: string | null
    video_ext?: string | null
    audio_ext?: string | null
  }>
}

interface RawPlaylistEntry {
  id?: string | null
  title?: string | null
  url?: string | null
  webpage_url?: string | null
  original_url?: string | null
  ie_key?: string | null
  thumbnail?: string | null
}

interface RawPlaylistInfo {
  id?: string | null
  title?: string | null
  entries?: RawPlaylistEntry[]
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
  historyStorePath?: string
  runtimeSettings?: DownloadRuntimeSettings
}

const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'VidBee')
const DEFAULT_MAX_CONCURRENT = 3
const MAX_TASK_LOG_LENGTH = 80_000
const DEFAULT_HISTORY_STORE_DIR = '.vidbee'
const DEFAULT_HISTORY_STORE_FILE = 'history.json'
const FFMPEG_NOT_FOUND_ERROR =
  'ffmpeg/ffprobe not found. Use Desktop resources/ffmpeg, install in PATH, or set FFMPEG_PATH.'
const TERMINAL_STATUSES = new Set(['completed', 'error', 'cancelled'])
const DOWNLOAD_TYPES = new Set(['video', 'audio'])
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT_FROM_MODULE = path.resolve(MODULE_DIR, '../../..')

const getDesktopResourcesDirs = (): string[] => {
  const dirs: string[] = []
  const cwd = process.cwd()

  dirs.push(path.join(cwd, 'resources'))
  dirs.push(path.join(cwd, 'apps', 'desktop', 'resources'))
  dirs.push(path.resolve(cwd, '..', 'desktop', 'resources'))

  dirs.push(path.join(REPO_ROOT_FROM_MODULE, 'resources'))
  dirs.push(path.join(REPO_ROOT_FROM_MODULE, 'apps', 'desktop', 'resources'))

  if (process.env.NODE_ENV === 'development') {
    dirs.push(path.join(REPO_ROOT_FROM_MODULE, 'apps', 'desktop', 'resources'))
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    dirs.push(path.join(resourcesPath, 'app.asar.unpacked', 'resources'))
    dirs.push(path.join(resourcesPath, 'resources'))
  }

  return Array.from(new Set(dirs))
}

const ensureExecutable = (targetPath: string): void => {
  if (process.platform === 'win32') {
    return
  }
  try {
    fs.chmodSync(targetPath, 0o755)
  } catch {
    // Ignore permission errors and let process execution decide.
  }
}

const resolveBundledYtDlpPath = (): string | undefined => {
  const binaryName =
    process.platform === 'win32'
      ? 'yt-dlp.exe'
      : process.platform === 'darwin'
        ? 'yt-dlp_macos'
        : 'yt-dlp_linux'

  for (const resourcesDir of getDesktopResourcesDirs()) {
    const candidate = path.join(resourcesDir, binaryName)
    if (!fs.existsSync(candidate)) {
      continue
    }
    ensureExecutable(candidate)
    return candidate
  }

  return undefined
}

const resolveBundledFfmpegLocation = (): string | undefined => {
  const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeBinaryName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

  for (const resourcesDir of getDesktopResourcesDirs()) {
    const candidateDir = path.join(resourcesDir, 'ffmpeg')
    const ffmpegPath = path.join(candidateDir, ffmpegBinaryName)
    const ffprobePath = path.join(candidateDir, ffprobeBinaryName)
    if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
      continue
    }
    ensureExecutable(ffmpegPath)
    ensureExecutable(ffprobePath)
    return candidateDir
  }

  return undefined
}

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
  const bundledPath = resolveBundledYtDlpPath()
  if (bundledPath) {
    return bundledPath
  }
  const commandPath = tryCommandPath('yt-dlp')
  if (commandPath) {
    return commandPath
  }
  throw new Error('yt-dlp binary not found. Set YTDLP_PATH or install yt-dlp in PATH.')
}

const resolveFfmpegLocation = (ytDlpPath?: string): string | undefined => {
  const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobeBinaryName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const resolveFromDirectory = (directory: string): string | undefined => {
    const ffmpegPath = path.join(directory, ffmpegBinaryName)
    const ffprobePath = path.join(directory, ffprobeBinaryName)
    if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
      return undefined
    }
    ensureExecutable(ffmpegPath)
    ensureExecutable(ffprobePath)
    return directory
  }
  const envPath = process.env.FFMPEG_PATH?.trim()
  if (envPath && fs.existsSync(envPath)) {
    const stats = fs.statSync(envPath)
    if (stats.isDirectory()) {
      return resolveFromDirectory(envPath)
    }
    const candidateDir = path.dirname(envPath)
    return resolveFromDirectory(candidateDir)
  }

  if (ytDlpPath) {
    const ytDlpDir = path.dirname(ytDlpPath)
    const sameDirResolved = resolveFromDirectory(ytDlpDir)
    if (sameDirResolved) {
      return sameDirResolved
    }

    // Align with Desktop resource layout: resources/yt-dlp_* + resources/ffmpeg/{ffmpeg,ffprobe}
    const siblingDirResolved = resolveFromDirectory(path.join(ytDlpDir, 'ffmpeg'))
    if (siblingDirResolved) {
      return siblingDirResolved
    }
  }

  const bundledLocation = resolveBundledFfmpegLocation()
  if (bundledLocation) {
    return bundledLocation
  }

  const commandPath = tryCommandPath('ffmpeg')
  if (commandPath) {
    const resolved = resolveFromDirectory(path.dirname(commandPath))
    if (resolved) {
      return resolved
    }
  }

  if (process.platform === 'darwin') {
    const macCommonDirs = ['/opt/homebrew/bin', '/usr/local/bin']
    for (const dirPath of macCommonDirs) {
      const resolved = resolveFromDirectory(dirPath)
      if (resolved) {
        return resolved
      }
    }
  }

  return undefined
}

const resolveJsRuntimePath = (runtime: string): string | undefined => {
  const envPath = process.env.YTDLP_JS_RUNTIME_PATH?.trim()
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }

  const runtimeCandidates: string[] = []
  if (runtime === 'deno') {
    runtimeCandidates.push(process.platform === 'win32' ? 'deno.exe' : 'deno')
  } else if (runtime === 'node') {
    runtimeCandidates.push(process.platform === 'win32' ? 'node.exe' : 'node')
  } else if (runtime === 'bun') {
    runtimeCandidates.push(process.platform === 'win32' ? 'bun.exe' : 'bun')
  } else if (runtime === 'quickjs') {
    runtimeCandidates.push(process.platform === 'win32' ? 'qjs.exe' : 'qjs')
  } else {
    runtimeCandidates.push(runtime)
    if (process.platform === 'win32' && !runtime.endsWith('.exe')) {
      runtimeCandidates.push(`${runtime}.exe`)
    }
  }

  for (const resourcesDir of getDesktopResourcesDirs()) {
    for (const candidateName of runtimeCandidates) {
      const candidatePath = path.join(resourcesDir, candidateName)
      if (!fs.existsSync(candidatePath)) {
        continue
      }
      ensureExecutable(candidatePath)
      return candidatePath
    }
  }

  const commandPath = tryCommandPath(runtime)
  return commandPath ?? undefined
}

const resolveJsRuntimeArgs = (): string[] => {
  const runtime = (process.env.YTDLP_JS_RUNTIME || 'deno').trim()
  if (!runtime || runtime === 'none') {
    return []
  }

  const runtimePath = resolveJsRuntimePath(runtime)
  if (runtimePath) {
    return ['--js-runtimes', `${runtime}:${runtimePath}`]
  }

  return process.env.YTDLP_JS_RUNTIME ? ['--js-runtimes', runtime] : []
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

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return trimmed
}

const toOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const list = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  return list.length > 0 ? list : undefined
}

const toTerminal = (task: DownloadTask): boolean =>
  task.status === 'completed' || task.status === 'error' || task.status === 'cancelled'

const toPersistedHistoryTask = (value: unknown): DownloadTask | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const task = value as Partial<DownloadTask>
  const id = toOptionalString(task.id)
  const url = toOptionalString(task.url)
  const type = toOptionalString(task.type)
  const status = toOptionalString(task.status)
  const createdAt =
    typeof task.createdAt === 'number' && Number.isFinite(task.createdAt) ? task.createdAt : undefined

  if (!id || !url || !type || !status || !createdAt) {
    return null
  }
  if (!DOWNLOAD_TYPES.has(type)) {
    return null
  }
  if (!TERMINAL_STATUSES.has(status)) {
    return null
  }

  return cloneTask(task as DownloadTask)
}

const isHttpUrl = (value?: string | null): boolean => {
  if (!value) {
    return false
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const resolvePlaylistEntryUrl = (entry: RawPlaylistEntry): string | undefined => {
  if (isHttpUrl(entry.url)) {
    return toOptionalString(entry.url)
  }

  if (isHttpUrl(entry.webpage_url)) {
    return toOptionalString(entry.webpage_url)
  }

  if (isHttpUrl(entry.original_url)) {
    return toOptionalString(entry.original_url)
  }

  if (entry.url) {
    const extractedId = entry.url.trim()
    const extractor = entry.ie_key?.toLowerCase() ?? ''
    if (extractor.includes('youtube')) {
      return `https://www.youtube.com/watch?v=${extractedId}`
    }
    if (extractor.includes('youtubemusic')) {
      return `https://music.youtube.com/watch?v=${extractedId}`
    }
  }

  return undefined
}

const trimTaskLog = (value: string): string => {
  if (value.length <= MAX_TASK_LOG_LENGTH) {
    return value
  }

  return value.slice(value.length - MAX_TASK_LOG_LENGTH)
}

const extractSavedFilePath = (rawLog: string): string | undefined => {
  const log = rawLog.trim()
  if (!log) {
    return undefined
  }

  const quotedPatterns = [
    /Merging formats into "([^"]+)"/g,
    /Destination:\s+"([^"]+)"/g,
    /Destination:\s+'([^']+)'/g,
    /\[download\]\s+([^\r\n]+?)\s+has already been downloaded/g
  ]

  for (const pattern of quotedPatterns) {
    const matches = Array.from(log.matchAll(pattern))
    const lastMatch = matches.at(-1)
    const candidate = lastMatch?.[1]?.trim()
    if (candidate) {
      return candidate
    }
  }

  const lines = log.split(/\r?\n/).reverse()
  for (const line of lines) {
    const destinationIndex = line.indexOf('Destination:')
    if (destinationIndex >= 0) {
      const candidate = line.slice(destinationIndex + 'Destination:'.length).trim()
      if (candidate) {
        return candidate
      }
    }
  }

  return undefined
}

const cloneVideoFormat = (format?: VideoFormat): VideoFormat | undefined => {
  if (!format) {
    return undefined
  }

  return { ...format }
}

const cloneTask = (task: DownloadTask): DownloadTask => ({
  ...task,
  progress: task.progress ? { ...task.progress } : undefined,
  tags: task.tags ? [...task.tags] : undefined,
  selectedFormat: cloneVideoFormat(task.selectedFormat)
})

export class DownloaderCore extends EventEmitter {
  private readonly maxConcurrent: number
  private readonly downloadDir: string
  private readonly historyStorePath: string
  private readonly defaultRuntimeSettings: DownloadRuntimeSettings
  private readonly jsRuntimeArgs: string[]
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
    this.defaultRuntimeSettings = { ...(options.runtimeSettings ?? {}) }
    this.jsRuntimeArgs = resolveJsRuntimeArgs()
    const configuredHistoryStorePath = options.historyStorePath?.trim()
    this.historyStorePath =
      configuredHistoryStorePath && configuredHistoryStorePath.length > 0
        ? path.resolve(configuredHistoryStorePath)
        : path.join(this.downloadDir, DEFAULT_HISTORY_STORE_DIR, DEFAULT_HISTORY_STORE_FILE)
  }

  async initialize(): Promise<void> {
    if (this.ytdlp) {
      return
    }
    fs.mkdirSync(this.downloadDir, { recursive: true })
    this.loadPersistedHistory()
    const ytDlpPath = resolveYtDlpPath()
    this.ffmpegLocation = resolveFfmpegLocation(ytDlpPath)
    if (this.ffmpegLocation) {
      process.env.FFMPEG_PATH = this.ffmpegLocation
    }
    this.ytdlp = new YTDlpWrapCtor(ytDlpPath)
  }

  private getYtDlp(): YtDlpWrapInstance {
    if (!this.ytdlp) {
      throw new Error('DownloaderCore is not initialized.')
    }
    return this.ytdlp
  }

  private publishHistory(): void {
    this.emit('history-updated', this.listHistory())
  }

  private resolveRuntimeSettings(
    taskSettings?: DownloadRuntimeSettings | undefined
  ): DownloadRuntimeSettings {
    const merged: DownloadRuntimeSettings = {
      ...this.defaultRuntimeSettings,
      ...(taskSettings ?? {})
    }
    const downloadPath =
      taskSettings?.downloadPath?.trim() ||
      this.defaultRuntimeSettings.downloadPath?.trim() ||
      this.downloadDir

    return {
      ...merged,
      downloadPath
    }
  }

  private loadPersistedHistory(): void {
    if (!fs.existsSync(this.historyStorePath)) {
      return
    }

    try {
      const raw = fs.readFileSync(this.historyStorePath, 'utf-8')
      if (!raw.trim()) {
        return
      }

      const parsed = JSON.parse(raw) as
        | {
            history?: unknown
          }
        | unknown[]
      const historyEntries = Array.isArray(parsed) ? parsed : parsed.history

      if (!Array.isArray(historyEntries)) {
        return
      }

      this.history.clear()
      for (const item of historyEntries) {
        const task = toPersistedHistoryTask(item)
        if (task) {
          this.history.set(task.id, task)
        }
      }
    } catch (error) {
      console.error('Failed to load persisted download history:', error)
    }
  }

  private persistHistory(): void {
    try {
      fs.mkdirSync(path.dirname(this.historyStorePath), { recursive: true })
      const payload = JSON.stringify(
        {
          version: 1,
          history: this.listHistory()
        },
        null,
        2
      )
      fs.writeFileSync(this.historyStorePath, payload, 'utf-8')
    } catch (error) {
      console.error('Failed to persist download history:', error)
    }
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
      this.persistHistory()
      this.publishHistory()
    }

    const snapshot = cloneTask(next)
    this.emit('task-updated', snapshot)
    this.emit('queue-updated', this.listDownloads())
    return snapshot
  }

  private async runJsonCommand<T>(args: string[]): Promise<T> {
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

    return JSON.parse(stdout) as T
  }

  async getVideoInfo(url: string, runtimeSettings?: DownloadRuntimeSettings): Promise<VideoInfo> {
    await this.initialize()
    const target = url.trim()
    if (!target) {
      throw new Error('URL is required.')
    }

    const raw = await this.runJsonCommand<RawVideoInfo>(
      buildVideoInfoArgs(target, this.resolveRuntimeSettings(runtimeSettings), this.jsRuntimeArgs)
    )
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
      tbr: toOptionalNumber(format.tbr),
      quality: toOptionalNumber(format.quality),
      protocol: toOptionalString(format.protocol),
      language: toOptionalString(format.language),
      videoExt: toOptionalString(format.video_ext),
      audioExt: toOptionalString(format.audio_ext)
    }))

    return {
      id: raw.id ?? target,
      title: raw.title ?? target,
      thumbnail: toOptionalString(raw.thumbnail),
      duration: toOptionalNumber(raw.duration),
      extractorKey: toOptionalString(raw.extractor_key),
      webpageUrl: toOptionalString(raw.webpage_url),
      description: toOptionalString(raw.description),
      viewCount: toOptionalNumber(raw.view_count),
      uploader: toOptionalString(raw.uploader),
      tags: toOptionalStringArray(raw.tags),
      formats
    }
  }

  async getPlaylistInfo(
    url: string,
    runtimeSettings?: DownloadRuntimeSettings
  ): Promise<PlaylistInfo> {
    await this.initialize()
    const target = url.trim()
    if (!target) {
      throw new Error('URL is required.')
    }

    const raw = await this.runJsonCommand<RawPlaylistInfo>(
      buildPlaylistInfoArgs(target, this.resolveRuntimeSettings(runtimeSettings), this.jsRuntimeArgs)
    )

    const rawEntries = Array.isArray(raw.entries) ? raw.entries : []
    const entries = rawEntries
      .map((entry, index) => {
        const resolvedUrl = resolvePlaylistEntryUrl(entry)
        if (!resolvedUrl || !isHttpUrl(resolvedUrl)) {
          return null
        }

        return {
          id: toOptionalString(entry.id) ?? `${index + 1}`,
          title: toOptionalString(entry.title) ?? `Entry ${index + 1}`,
          url: resolvedUrl,
          index: index + 1,
          thumbnail: toOptionalString(entry.thumbnail)
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    return {
      id: toOptionalString(raw.id) ?? target,
      title: toOptionalString(raw.title) ?? 'Playlist',
      entries,
      entryCount: entries.length
    }
  }

  async startPlaylistDownload(input: PlaylistDownloadInput): Promise<PlaylistDownloadResult> {
    const playlist = await this.getPlaylistInfo(input.url, input.settings)
    const groupId = `playlist_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    if (playlist.entryCount === 0) {
      return {
        groupId,
        playlistId: playlist.id,
        playlistTitle: playlist.title,
        type: input.type,
        totalCount: 0,
        startIndex: 0,
        endIndex: 0,
        entries: []
      }
    }

    let selectedEntries: PlaylistInfo['entries'] = []

    if (input.entryIds && input.entryIds.length > 0) {
      const selectedIdSet = new Set(input.entryIds)
      selectedEntries = playlist.entries.filter((entry) => selectedIdSet.has(entry.id))
    } else {
      const requestedStart = Math.max((input.startIndex ?? 1) - 1, 0)
      const requestedEnd = input.endIndex
        ? Math.min(input.endIndex - 1, playlist.entryCount - 1)
        : playlist.entryCount - 1
      const rangeStart = Math.min(requestedStart, requestedEnd)
      const rangeEnd = Math.max(requestedStart, requestedEnd)
      selectedEntries = playlist.entries.slice(rangeStart, rangeEnd + 1)
    }

    const createdEntries: PlaylistDownloadResult['entries'] = []

    for (const entry of selectedEntries) {
      const download = await this.createDownload({
        url: entry.url,
        type: input.type,
        title: entry.title,
        thumbnail: entry.thumbnail,
        playlistId: groupId,
        playlistTitle: playlist.title,
        playlistIndex: entry.index,
        playlistSize: selectedEntries.length,
        format: input.format,
        audioFormat: input.audioFormat,
        audioFormatIds: input.audioFormatIds,
        customDownloadPath: input.customDownloadPath,
        customFilenameTemplate: input.customFilenameTemplate,
        settings: input.settings
      })

      createdEntries.push({
        downloadId: download.id,
        entryId: entry.id,
        title: entry.title,
        url: entry.url,
        index: entry.index
      })
    }

    return {
      groupId,
      playlistId: playlist.id,
      playlistTitle: playlist.title,
      type: input.type,
      totalCount: selectedEntries.length,
      startIndex: selectedEntries[0]?.index ?? 0,
      endIndex: selectedEntries.at(-1)?.index ?? 0,
      entries: createdEntries
    }
  }

  async createDownload(input: CreateDownloadInput): Promise<DownloadTask> {
    await this.initialize()
    const id = randomUUID()
    const now = Date.now()
    const runtimeSettings = this.resolveRuntimeSettings(input.settings)
    const resolvedDownloadPath =
      input.customDownloadPath?.trim() || runtimeSettings.downloadPath?.trim() || this.downloadDir
    const task: DownloadTask = {
      id,
      url: input.url,
      title: input.title,
      thumbnail: input.thumbnail,
      type: input.type,
      status: 'pending',
      createdAt: now,
      duration: input.duration,
      description: input.description,
      channel: input.channel,
      uploader: input.uploader,
      viewCount: input.viewCount,
      tags: input.tags ? [...input.tags] : undefined,
      selectedFormat: cloneVideoFormat(input.selectedFormat),
      playlistId: input.playlistId,
      playlistTitle: input.playlistTitle,
      playlistIndex: input.playlistIndex,
      playlistSize: input.playlistSize,
      downloadPath: resolvedDownloadPath
    }

    this.tasks.set(id, task)
    this.taskInputs.set(id, {
      ...input,
      selectedFormat: cloneVideoFormat(input.selectedFormat),
      customDownloadPath: input.customDownloadPath?.trim() || undefined,
      customFilenameTemplate: input.customFilenameTemplate?.trim() || undefined,
      settings: runtimeSettings
    })
    this.pending.push(id)
    this.emit('queue-updated', this.listDownloads())
    this.processQueue()

    return cloneTask(task)
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

    const runtimeSettings = this.resolveRuntimeSettings(input.settings)
    const resolvedDownloadPath =
      input.customDownloadPath?.trim() || runtimeSettings.downloadPath?.trim() || this.downloadDir
    const args = buildDownloadArgs(
      {
        url: task.url,
        type: input.type,
        format: input.format,
        audioFormat: input.audioFormat,
        audioFormatIds: input.audioFormatIds,
        startTime: input.startTime,
        endTime: input.endTime,
        customDownloadPath: input.customDownloadPath,
        customFilenameTemplate: input.customFilenameTemplate
      },
      this.downloadDir,
      runtimeSettings,
      this.jsRuntimeArgs
    )

    const urlArg = args.pop()
    if (!urlArg) {
      this.updateTask(nextId, {
        status: 'error',
        completedAt: Date.now(),
        error: 'Download arguments missing URL'
      })
      this.processQueue()
      return
    }

    if (!this.ffmpegLocation) {
      this.updateTask(nextId, {
        status: 'error',
        completedAt: Date.now(),
        error: FFMPEG_NOT_FOUND_ERROR
      })
      this.processQueue()
      return
    }

    args.push('--ffmpeg-location', this.ffmpegLocation)
    args.push(urlArg)

    const controller = new AbortController()
    const ytDlpCommand = formatYtDlpCommand(args)
    const process = this.getYtDlp().exec(args, {
      signal: controller.signal
    })

    this.active.set(nextId, { controller, process })

    let taskLog = ''
    const appendLogChunk = (chunk: Buffer | string): void => {
      taskLog = trimTaskLog(`${taskLog}${chunk.toString()}`)
    }

    process.ytDlpProcess?.stdout?.on('data', appendLogChunk)
    process.ytDlpProcess?.stderr?.on('data', appendLogChunk)

    this.updateTask(nextId, {
      status: 'downloading',
      startedAt: Date.now(),
      progress: { percent: 0 },
      ytDlpCommand,
      ytDlpLog: ''
    })

    process.on('progress', (payload: ProgressPayload) => {
      this.updateTask(nextId, {
        progress: {
          percent: clampPercent(payload.percent),
          currentSpeed: payload.currentSpeed,
          eta: payload.eta,
          downloaded: payload.downloaded,
          total: payload.total
        },
        speed: payload.currentSpeed
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

      const finalPatch: Partial<DownloadTask> = {
        ...patch,
        completedAt: patch.completedAt ?? Date.now(),
        ytDlpLog: taskLog
      }

      const filePath = extractSavedFilePath(taskLog)
      if (filePath) {
        finalPatch.savedFileName = path.basename(filePath)
        finalPatch.downloadPath = path.dirname(filePath)
      } else {
        finalPatch.downloadPath = resolvedDownloadPath
      }

      this.updateTask(nextId, finalPatch)
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

  removeHistoryItems(ids: string[]): number {
    let removed = 0

    for (const rawId of ids) {
      const id = rawId.trim()
      if (!id) {
        continue
      }

      if (!this.history.delete(id)) {
        continue
      }

      removed += 1
      const task = this.tasks.get(id)
      if (task && toTerminal(task)) {
        this.tasks.delete(id)
      }
    }

    if (removed > 0) {
      this.persistHistory()
      this.publishHistory()
    }

    return removed
  }

  removeHistoryByPlaylist(playlistId: string): number {
    const target = playlistId.trim()
    if (!target) {
      return 0
    }

    const idsToDelete: string[] = []
    for (const [id, task] of this.history.entries()) {
      if (task.playlistId === target) {
        idsToDelete.push(id)
      }
    }

    return this.removeHistoryItems(idsToDelete)
  }

  listDownloads(): DownloadTask[] {
    return Array.from(this.tasks.values())
      .filter((task) => !toTerminal(task))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(cloneTask)
  }

  listHistory(): DownloadTask[] {
    return Array.from(this.history.values())
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))
      .map(cloneTask)
  }

  getStatus(): { active: number; pending: number } {
    return { active: this.active.size, pending: this.pending.length }
  }
}
