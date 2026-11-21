import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backgroundChildSpawnOptions, lowerChildPriority } from '@vidbee/task-queue/process'
import { BrowserWindow, dialog } from 'electron'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import {
  buildHardSubtitleBurnArgs,
  buildSoftSubtitleMuxArgs,
  parseFfmpegOutTimeMs,
  progressPercent
} from './export-video-subtitles-args'
import { ffmpegManager } from './ffmpeg-manager'
import { probeMediaCodecs, resolveFfprobePath, stagingOutputPath } from './playable-media'

export const VIDEO_EXPORT_PROGRESS_CHANNEL = 'transcript:export-progress'

export type VideoSubtitleEncode = 'soft' | 'hard'

export type VideoSubtitleExportResult =
  | { path: string; status: 'saved' }
  | { status: 'canceled' }
  | { reason: 'missing-source' | 'audio-only'; status: 'unavailable' }
  | { message: string; status: 'failed' }

export interface VideoSubtitleExportInput {
  defaultFileName: string
  mode: VideoSubtitleEncode
  sourcePath: string
  subtitleText: string
}

export interface VideoExportProgress {
  percent: number | null
}

const STDERR_CAP_BYTES = 64 * 1024
const COPY_AUDIO_CODECS = new Set(['aac', 'mp3'])
const logger = scopedLoggers.engine

let activeExport: AbortController | null = null

/**
 * Ask ffmpeg to stop the in-flight video export, if one is running.
 */
export const cancelVideoSubtitleExport = (): void => {
  activeExport?.abort()
}

/**
 * Ask the user where to save the video, then mux or burn captions with ffmpeg.
 */
export const exportVideoWithSubtitles = async (
  input: VideoSubtitleExportInput,
  options?: { outputPath: string; signal: AbortSignal }
): Promise<VideoSubtitleExportResult> => {
  const sourcePath = path.normalize(input.sourcePath.trim())
  if (!(sourcePath && existsSync(sourcePath) && isNonEmptyFile(sourcePath))) {
    return { reason: 'missing-source', status: 'unavailable' }
  }
  if (!input.subtitleText.trim()) {
    return { message: 'subtitle track is empty', status: 'failed' }
  }

  const ffmpegPath = await resolveFfmpegPath()
  if (!ffmpegPath) {
    return { message: 'ffmpeg is not available', status: 'failed' }
  }

  const probe = await probeMediaCodecs(resolveFfprobePath(ffmpegPath), sourcePath).catch(() => null)
  if (!probe?.video) {
    return { reason: 'audio-only', status: 'unavailable' }
  }

  const outputPath =
    options?.outputPath ?? (await pickExportPath(input.defaultFileName, input.mode))
  if (!outputPath) {
    return { status: 'canceled' }
  }
  if (path.resolve(outputPath) === path.resolve(sourcePath)) {
    return { message: 'output path matches the source video', status: 'failed' }
  }
  if (options && (existsSync(outputPath) || activeExport)) {
    return {
      message: activeExport
        ? 'Another video export is already running'
        : 'Output file already exists',
      status: 'failed'
    }
  }

  const abort = new AbortController()
  activeExport?.abort()
  activeExport = abort
  const signal = options ? AbortSignal.any([abort.signal, options.signal]) : abort.signal

  const subtitleExt = input.mode === 'hard' ? '.ass' : '.srt'
  const subtitlePath = path.join(tmpdir(), `vidbee-export-${randomUUID()}${subtitleExt}`)
  const stagingPath = stagingOutputPath(outputPath)
  writeFileSync(subtitlePath, input.subtitleText, 'utf8')
  logger.info(`export video ${input.mode} ${sourcePath} -> ${outputPath}`)

  try {
    const durationMs = await probeDurationMs(ffmpegPath, sourcePath)
    const args =
      input.mode === 'soft'
        ? buildSoftSubtitleMuxArgs({
            outputPath: stagingPath,
            sourcePath,
            subtitlePath
          })
        : buildHardSubtitleBurnArgs({
            audio: probe.audio && COPY_AUDIO_CODECS.has(probe.audio) ? 'copy' : 'aac',
            outputPath: stagingPath,
            sourcePath,
            subtitlePath
          })
    broadcastProgress({ percent: durationMs > 0 ? 0 : null })
    await runExportFfmpeg(ffmpegPath, args, durationMs, signal)
    if (!isNonEmptyFile(stagingPath)) {
      return { message: 'ffmpeg produced an empty file', status: 'failed' }
    }
    renameOrCopy(stagingPath, outputPath)
    broadcastProgress({ percent: 100 })
    return { path: outputPath, status: 'saved' }
  } catch (error) {
    removeIfExists(stagingPath)
    if (signal.aborted) {
      return { status: 'canceled' }
    }
    const detail = error instanceof Error ? error.message : String(error)
    logger.error(`export video failed: ${detail}`)
    return { message: detail, status: 'failed' }
  } finally {
    removeIfExists(subtitlePath)
    removeIfExists(stagingPath)
    if (activeExport === abort) {
      activeExport = null
    }
  }
}

/**
 * Resolve the bundled ffmpeg path without throwing when it is missing.
 */
const resolveFfmpegPath = async (): Promise<string | null> => {
  try {
    return await ffmpegManager.ensureInitialized()
  } catch (error) {
    logger.error(`ffmpeg unavailable for video export: ${error}`)
    return null
  }
}

/**
 * Open a save dialog for the muxed or burned video.
 */
const pickExportPath = async (
  defaultFileName: string,
  mode: VideoSubtitleEncode
): Promise<string | null> => {
  const fileName = path.basename(defaultFileName)
  const downloadPath = String(settingsManager.get('downloadPath') || '')
  const defaultDir = downloadPath && existsSync(downloadPath) ? downloadPath : tmpdir()
  const extension = mode === 'soft' ? 'mkv' : 'mp4'
  const saveOptions = {
    defaultPath: path.join(defaultDir, fileName),
    filters: [
      {
        extensions: [extension],
        name: mode === 'soft' ? 'Matroska' : 'MPEG-4'
      }
    ]
  }
  const window = BrowserWindow.getFocusedWindow()
  const result = window
    ? await dialog.showSaveDialog(window, saveOptions)
    : await dialog.showSaveDialog(saveOptions)
  if (result.canceled || !result.filePath) {
    return null
  }
  return path.normalize(result.filePath)
}

/**
 * Read the media duration from ffprobe so the export dialog can show progress.
 */
const probeDurationMs = async (ffmpegPath: string, filePath: string): Promise<number> => {
  const ffprobe = resolveFfprobePath(ffmpegPath)
  if (!existsSync(ffprobe)) {
    return 0
  }
  return new Promise((resolve) => {
    const child = spawn(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath
    ])
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('close', () => {
      const seconds = Number.parseFloat(out.trim())
      resolve(Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0)
    })
    child.on('error', () => resolve(0))
  })
}

/**
 * Run ffmpeg and forward `-progress` timestamps to the renderer.
 */
const runExportFfmpeg = (
  ffmpegPath: string,
  args: string[],
  durationMs: number,
  signal: AbortSignal
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...backgroundChildSpawnOptions()
    })
    lowerChildPriority(child.pid)
    const chunks: Buffer[] = []
    let bytes = 0
    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      const elapsed = parseFfmpegOutTimeMs(chunk.toString('utf8'))
      if (elapsed !== null) {
        broadcastProgress({ percent: progressPercent(elapsed, durationMs) })
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (bytes >= STDERR_CAP_BYTES) {
        return
      }
      const next =
        bytes + chunk.length > STDERR_CAP_BYTES
          ? chunk.subarray(0, STDERR_CAP_BYTES - bytes)
          : chunk
      chunks.push(next)
      bytes += next.length
    })
    child.on('error', (error) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code, nextSignal) => {
      signal.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolve()
        return
      }
      if (signal.aborted) {
        reject(new Error('export cancelled'))
        return
      }
      const detail = Buffer.concat(chunks).toString('utf8').trim()
      const reason = nextSignal ? `signal ${nextSignal}` : `code ${code}`
      reject(new Error(detail || `ffmpeg exited with ${reason}`))
    })
  })

/**
 * Tell every renderer window how far the export has progressed.
 */
const broadcastProgress = (payload: VideoExportProgress): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(VIDEO_EXPORT_PROGRESS_CHANNEL, payload)
    }
  }
}

/**
 * True when the path is a non-empty regular file.
 */
const isNonEmptyFile = (filePath: string): boolean => {
  try {
    return existsSync(filePath) && statSync(filePath).size > 0
  } catch {
    return false
  }
}

/**
 * Move the staging file onto the user-picked path.
 */
const renameOrCopy = (fromPath: string, toPath: string): void => {
  try {
    renameSync(fromPath, toPath)
  } catch {
    copyFileSync(fromPath, toPath)
    removeIfExists(fromPath)
  }
}

/**
 * Delete a leftover staging or subtitle file.
 */
const removeIfExists = (filePath: string): void => {
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}
