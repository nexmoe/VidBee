import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildDownloadArgs } from '@vidbee/downloader-core/yt-dlp-args'
import type { Task } from '@vidbee/task-queue'
import { app, nativeImage } from 'electron'
import type { AgentArtifact } from '../../shared/agent-chat'
import {
  agentUnusableVideoError,
  type SourceMediaKind,
  sourceMediaKind
} from '../../shared/source-media-kind'
import { settingsManager } from '../settings'
import { applyExtensionCookieSettings } from './extension-cookies'
import { ffmpegManager } from './ffmpeg-manager'
import { getDesktopTaskQueueRef } from './queue-ref'
import { resolveTaskSourceFile } from './source-file'
import { ytdlpManager } from './ytdlp-manager'

const MAX_BYTES = 1_000_000_000
let mediaBusy = false

/** Restrict every generated file to an application-owned UUID directory. */
export function agentMediaDirectory(threadId: string, runId?: string): string {
  if (![threadId, ...(runId ? [runId] : [])].every((id) => /^[0-9a-f-]{36}$/.test(id))) {
    throw new Error('Invalid media owner')
  }
  return path.join(app.getPath('userData'), 'agent-media', threadId, ...(runId ? [runId] : []))
}

/** Serialize CPU-heavy media work across all agent threads and honor queued cancellation. */
export async function withAgentMedia<T>(
  signal: AbortSignal,
  execute: () => Promise<T>
): Promise<T> {
  while (mediaBusy) {
    await delay(100, undefined, { signal })
  }
  signal.throwIfAborted()
  mediaBusy = true
  try {
    return await execute()
  } finally {
    mediaBusy = false
  }
}

/** Count temporary downloads as well as finalized files toward the resource budget. */
async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name)
    bytes += entry.isDirectory()
      ? await directoryBytes(target)
      : ((await stat(target).catch(() => null))?.size ?? 0)
  }
  return bytes
}

/** Run a bounded subprocess and terminate its complete process group on abort or timeout. */
export async function runAgentMediaProcess(
  executable: string,
  args: string[],
  input: {
    signal: AbortSignal
    directory: string
    timeoutMs: number
    maxBytes?: number
    onProgress?: (text: string) => void
  }
): Promise<string> {
  input.signal.throwIfAborted()
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let errorOutput = ''
    let failure: Error | undefined
    let checking = false
    /** Kill only this agent-owned subprocess tree. */
    const kill = (): void => {
      if (!child.pid) {
        return
      }
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => child.kill('SIGKILL'))
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    /** Preserve the cause while cancelling pending media work. */
    const abort = (): void => {
      failure = new Error('Media operation cancelled')
      kill()
    }
    const timeout = setTimeout(() => {
      failure = new Error('Media operation timed out')
      kill()
    }, input.timeoutMs)
    const budget = setInterval(() => {
      if (checking) {
        return
      }
      checking = true
      void directoryBytes(input.directory)
        .then((bytes) => {
          if (bytes > (input.maxBytes ?? MAX_BYTES)) {
            failure = new Error('Agent media exceeded the 1 GB limit')
            kill()
          }
        })
        .catch(() => {
          failure = new Error('Cannot inspect media budget')
          kill()
        })
        .finally(() => {
          checking = false
        })
    }, 250)
    /** Release timers and abort listeners when the child settles. */
    const cleanup = (): void => {
      clearTimeout(timeout)
      clearInterval(budget)
      input.signal.removeEventListener('abort', abort)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-64_000)
      const percent = chunk.toString().match(/\[download\]\s+([\d.]+)%/)
      if (percent) {
        input.onProgress?.(`${percent[1]}%`)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-4000)
    })
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('close', (code) => {
      cleanup()
      if (failure) {
        reject(failure)
      } else if (code === 0) {
        resolve(output)
      } else {
        reject(new Error(`Media process failed (${code}): ${errorOutput.slice(-800)}`))
      }
    })
    input.signal.addEventListener('abort', abort, { once: true })
    if (input.signal.aborted) {
      abort()
    }
  })
}

/** Convert a user download's optional clock offset into source timeline seconds. */
export function agentSourceOffset(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) {
    return 0
  }
  const parts = value.split(':').map(Number)
  return parts.every((part) => Number.isFinite(part) && part >= 0)
    ? parts.reduce((total, part) => total * 60 + part, 0)
    : 0
}

export interface AgentMediaContext {
  downloadId: string
  threadId: string
  runId: string
  signal: AbortSignal
  onProgress: (text: string) => void
  downloadBudget: { used: number }
}

/** Classify the current task as audio-only or video without exposing filesystem paths. */
export function agentSourceMediaKind(task: Readonly<Task>): SourceMediaKind {
  const opts = (task.input.options ?? {}) as Record<string, unknown>
  const outputPath = typeof task.output?.filePath === 'string' ? task.output.filePath : null
  return sourceMediaKind({
    type: typeof opts.type === 'string' ? opts.type : null,
    filePath: resolveTaskSourceFile(task) ?? outputPath,
    savedFileName: typeof opts.savedFileName === 'string' ? opts.savedFileName : null,
    url: task.input.url
  })
}

/** Inspect availability without exposing paths or acquiring a different video's media. */
export function getAgentVideoAvailability(downloadId: string): {
  localMediaAvailable: boolean
  canDownload: boolean
  mediaKind: SourceMediaKind
  hasVideoFrames: boolean
} {
  const task = getDesktopTaskQueueRef().get(downloadId)
  if (!task) {
    throw new Error('Video no longer exists')
  }
  const mediaKind = agentSourceMediaKind(task)
  return {
    localMediaAvailable: Boolean(resolveTaskSourceFile(task)),
    canDownload: /^https?:\/\//.test(task.input.url),
    mediaKind,
    hasVideoFrames: mediaKind === 'video'
  }
}

/** Resolve only the current product video; acquire missing ranges with the existing downloader arguments. */
async function resolveAgentMedia(
  context: AgentMediaContext,
  start: number,
  end: number
): Promise<{ file: string; offset: number; temporary?: string }> {
  const task = getDesktopTaskQueueRef().get(context.downloadId)
  if (!task) {
    throw new Error('Video no longer exists')
  }
  if (agentSourceMediaKind(task) === 'audio') {
    throw new Error(
      'This source is audio-only; no video frames are available. Write a text-only answer and do not retry capture_frames or create_clip.'
    )
  }
  const local = resolveTaskSourceFile(task)
  const offset = agentSourceOffset(task.input.options?.startTime)
  const localEnd = task.output?.durationMs
    ? offset + task.output.durationMs / 1000
    : Number.POSITIVE_INFINITY
  if (local && start >= offset && end <= localEnd + 0.1) {
    return { file: local, offset }
  }
  const sourceUrl = new URL(task.input.url)
  if (!['https:', 'http:'].includes(sourceUrl.protocol)) {
    throw new Error('No downloadable video source is available')
  }
  const directory = agentMediaDirectory(context.threadId, context.runId)
  const temporary = path.join(directory, `download-${randomUUID()}`)
  const ffmpeg = await ffmpegManager.ensureInitialized()
  const settings = settingsManager.getAll()
  context.onProgress('downloading')
  const remaining = MAX_BYTES - context.downloadBudget.used
  if (remaining <= 0) {
    throw new Error('Agent download budget reached (1 GB per run)')
  }
  const cookieSettings = {
    browserForCookies: settings.browserForCookies,
    cookiesPath: settings.cookiesPath,
    proxy: settings.proxy,
    downloadSubtitles: false,
    embedThumbnail: false,
    embedMetadata: false,
    embedChapters: false
  }
  const overlay = await applyExtensionCookieSettings(task.input.url, cookieSettings)
  const args = buildDownloadArgs(
    {
      url: task.input.url,
      type: 'video',
      format: 'bv*[height<=720]+ba/b[height<=720]',
      containerFormat: 'mp4',
      startTime: String(start),
      endTime: String(end),
      customDownloadPath: temporary,
      customFilenameTemplate: 'source.%(ext)s'
    },
    temporary,
    overlay ?? cookieSettings,
    ytdlpManager.getJsRuntimeArgs()
  )
  // Keep the output template relative: yt-dlp's filename trimming must never truncate owner directories.
  const outputIndex = args.indexOf('-o')
  if (outputIndex < 0) {
    throw new Error('Missing media output template')
  }
  args[outputIndex + 1] = 'source.%(ext)s'
  args.splice(
    args.length - 1,
    0,
    '--paths',
    temporary,
    '--ffmpeg-location',
    path.dirname(ffmpeg),
    '--max-filesize',
    String(remaining),
    '--force-keyframes-at-cuts',
    '--newline',
    '--retries',
    '2',
    '--fragment-retries',
    '2'
  )
  let counted = false
  try {
    await mkdir(temporary, { recursive: true })
    await runAgentMediaProcess(ytdlpManager.getPath(), args, {
      signal: context.signal,
      directory: temporary,
      maxBytes: remaining,
      timeoutMs: 300_000,
      onProgress: context.onProgress
    })
    const acquiredBytes = await directoryBytes(temporary)
    context.downloadBudget.used += acquiredBytes
    counted = true
    if (context.downloadBudget.used > MAX_BYTES) {
      throw new Error('Agent download budget reached (1 GB per run)')
    }
    const file = (await readdir(temporary)).find((name) => /^source\.(mp4|mkv|webm)$/.test(name))
    if (!file) {
      throw new Error('No video was downloaded; the source may exceed the size limit')
    }
    return { file: path.join(temporary, file), offset: start, temporary }
  } catch (error) {
    context.downloadBudget.used = Math.min(
      MAX_BYTES,
      context.downloadBudget.used + (counted ? 0 : await directoryBytes(temporary))
    )
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

/** Validate requested source times before acquiring or processing any video. */
export function validateAgentRange(
  start: number,
  end: number,
  duration: number,
  maxLength = 120
): void {
  if (
    !(Number.isFinite(start) && Number.isFinite(end)) ||
    start < 0 ||
    end <= start ||
    end - start > maxLength ||
    (duration > 0 && end > duration + 0.1)
  ) {
    throw new Error('Invalid or out-of-range media timestamps')
  }
}

/** Produce an immutable screenshot or accurate H.264 clip with a poster. */
export async function createAgentMedia(
  context: AgentMediaContext,
  kind: 'image' | 'video',
  start: number,
  end: number
): Promise<AgentArtifact> {
  return await withAgentMedia(context.signal, async () => {
    const directory = agentMediaDirectory(context.threadId, context.runId)
    await mkdir(directory, { recursive: true })
    const ffmpeg = await ffmpegManager.ensureInitialized()
    const source = await resolveAgentMedia(context, start, end)
    const id = randomUUID()
    const name = `${id}.${kind === 'image' ? 'jpg' : 'mp4'}`
    const file = path.join(directory, name)
    const poster = kind === 'video' ? path.join(directory, `${id}.jpg`) : undefined
    const options = { signal: context.signal, directory, timeoutMs: 180_000 }
    try {
      const seek = Math.max(0, start - source.offset)
      const imageArgs = [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(seek),
        '-i',
        source.file,
        '-frames:v',
        '1',
        '-vf',
        'scale=1280:-2:force_original_aspect_ratio=decrease',
        '-q:v',
        '3'
      ]
      if (kind === 'image') {
        await runAgentMediaProcess(ffmpeg, [...imageArgs, file], options)
      } else {
        await runAgentMediaProcess(
          ffmpeg,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(seek),
            '-i',
            source.file,
            '-t',
            String(end - start),
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-vf',
            'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            file
          ],
          options
        )
        if (!poster) {
          throw new Error('Clip poster path is missing')
        }
        await runAgentMediaProcess(ffmpeg, [...imageArgs, poster], options)
      }
      context.signal.throwIfAborted()
      if (!(await stat(file)).size) {
        throw new Error('Media output is empty')
      }
      if ((await directoryBytes(directory)) > MAX_BYTES) {
        throw new Error('Agent media exceeded the 1 GB limit')
      }
      const dimensions = nativeImage.createFromPath(poster ?? file).getSize()
      return {
        id,
        width: dimensions.width,
        height: dimensions.height,
        threadId: context.threadId,
        runId: context.runId,
        kind,
        path: file,
        posterPath: poster,
        name,
        start,
        ...(kind === 'video' ? { end } : {})
      }
    } catch (error) {
      await rm(file, { force: true })
      if (poster) {
        await rm(poster, { force: true })
      }
      throw agentUnusableVideoError(error)
    } finally {
      if (source.temporary) {
        await rm(source.temporary, { recursive: true, force: true })
      }
    }
  })
}

/** Resolve a stored artifact without allowing arbitrary filesystem reads. */
export async function readAgentArtifactImage(artifact: AgentArtifact): Promise<string> {
  const file = artifact.kind === 'image' ? artifact.path : artifact.posterPath
  if (
    !(
      file?.startsWith(`${agentMediaDirectory(artifact.threadId, artifact.runId)}${path.sep}`) &&
      existsSync(file)
    )
  ) {
    throw new Error('Attachment is unavailable')
  }
  return (await readFile(file)).toString('base64')
}
