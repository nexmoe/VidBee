import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { backgroundChildSpawnOptions, lowerChildPriority } from '@vidbee/task-queue/process'
import { captionLanguageScore, isHumanCaptionTrack, isTextSubtitleCodec } from './captions'

export interface ExtractedCaptionTrack {
  language: string | null
  text: string
  title?: string
}

interface FfprobeStream {
  codec_name?: string
  codec_type?: string
  index?: number
  tags?: { language?: string; title?: string }
}

const BITMAP_PROBE_TIMEOUT_MS = 8000
const EXTRACT_TIMEOUT_MS = 20_000
const MAX_TRACKS = 24

/**
 * Resolve the ffprobe binary that sits next to ffmpeg.
 *
 * @param ffmpegPath Absolute ffmpeg path.
 */
export const ffprobePathFromFfmpeg = (ffmpegPath: string): string =>
  ffmpegPath.endsWith('ffmpeg.exe')
    ? ffmpegPath.replace(/ffmpeg\.exe$/i, 'ffprobe.exe')
    : join(dirname(ffmpegPath), 'ffprobe')

/**
 * Run a child process and collect stdout, rejecting on timeout or non-zero exit.
 *
 * @param bin Executable path.
 * @param args Command arguments.
 * @param timeoutMs Kill the process after this many milliseconds.
 */
const runCaptured = (bin: string, args: string[], timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...backgroundChildSpawnOptions()
    })
    lowerChildPriority(child.pid)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
        return
      }
      reject(new Error(`${bin} failed (exit ${code}): ${stderr.slice(-500)}`))
    })
  })

/**
 * Extract text subtitle streams from a container as WebVTT documents.
 *
 * Preferred UI languages are extracted first so a Chinese or English track is
 * not dropped when ffmpeg listed Arabic (or another 639-2 tag) ahead of them.
 *
 * @param input ffmpeg binary, media path, and optional UI language tags.
 */
export const extractEmbeddedCaptionTracks = async (input: {
  ffmpegPath: string
  filePath: string
  preferredLanguages?: string[]
}): Promise<ExtractedCaptionTrack[]> => {
  if (!(existsSync(input.ffmpegPath) && existsSync(input.filePath))) {
    return []
  }
  const ffprobe = ffprobePathFromFfmpeg(input.ffmpegPath)
  if (!existsSync(ffprobe)) {
    return []
  }
  let parsed: { streams?: FfprobeStream[] }
  try {
    const raw = await runCaptured(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        's',
        '-show_entries',
        'stream=index,codec_name,codec_type:stream_tags=language,title',
        '-of',
        'json',
        input.filePath
      ],
      BITMAP_PROBE_TIMEOUT_MS
    )
    parsed = JSON.parse(raw) as { streams?: FfprobeStream[] }
  } catch {
    return []
  }
  const preferred = input.preferredLanguages ?? []
  const streams = (parsed.streams ?? [])
    .filter(
      (stream) =>
        stream.codec_type === 'subtitle' &&
        isTextSubtitleCodec(stream.codec_name) &&
        isHumanCaptionTrack({
          language: stream.tags?.language,
          title: stream.tags?.title
        })
    )
    .map((stream, index) => ({
      score: captionLanguageScore(stream.tags?.language ?? null, preferred),
      stream,
      index
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_TRACKS)
    .map((item) => item.stream)
  const tracks: ExtractedCaptionTrack[] = []
  for (const stream of streams) {
    if (typeof stream.index !== 'number') {
      continue
    }
    try {
      const text = await runCaptured(
        input.ffmpegPath,
        [
          '-v',
          'error',
          '-i',
          input.filePath,
          '-map',
          `0:${stream.index}`,
          '-f',
          'webvtt',
          'pipe:1'
        ],
        EXTRACT_TIMEOUT_MS
      )
      if (!text.trim()) {
        continue
      }
      tracks.push({
        language: stream.tags?.language?.trim() || null,
        text,
        title: stream.tags?.title?.trim() || undefined
      })
    } catch {}
  }
  return tracks
}
