import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { isNativelyPlayableAudio } from '../../shared/utils/native-playable'

const execFileAsync = promisify(execFile)

const MP4_VIDEO_CODECS = new Set(['av1', 'h264', 'hevc', 'h265'])
const MP4_AUDIO_CODECS = new Set(['aac', 'mp3'])
const WEBM_VIDEO_CODECS = new Set(['av1', 'vp8', 'vp9'])
const WEBM_AUDIO_CODECS = new Set(['opus', 'vorbis'])
const COPY_CONTAINERS = new Set(['.m4a', '.mp3', '.mp4', '.webm'])
const IMAGE_VIDEO_CODECS = new Set(['bmp', 'gif', 'jpeg', 'jpg', 'mjpeg', 'png', 'webp'])
const WINDOWS_UNSAFE_VIDEO_CODECS = new Set(['av1', 'h265', 'hevc'])
const PREVIEW_CACHE_VERSION = 'preview-v4'
const STDERR_CAP_BYTES = 64 * 1024

export interface MediaCodecProbe {
  audio: string | null
  video: string | null
  videoPixFmt?: string | null
}

export type PlayablePrepareMode = 'original' | 'remux' | 'transcode'
export type PlayableContainer = 'mp4' | 'webm'
export type PlayableVideoCodec = 'copy' | 'libx264'
export type PlayableAudioCodec = 'copy' | 'aac' | 'libopus'

export type PlayableMuxerFormat = 'mp4' | 'mpegts' | 'webm'

export interface PlayableConvertOptions {
  audio?: PlayableAudioCodec
  format?: PlayableMuxerFormat
  video?: PlayableVideoCodec
}

export interface PreparePlayableMediaOptions {
  cacheDir?: string
}

const inflightPrepares = new Map<
  string,
  Promise<{ mode: PlayablePrepareMode; playablePath: string }>
>()

export interface PlayablePreparePlan {
  audio?: PlayableAudioCodec
  container?: PlayableContainer
  mode: PlayablePrepareMode
  outputPath: string
  video?: PlayableVideoCodec
}

/**
 * Return the ffprobe binary that sits next to the bundled ffmpeg.
 */
export const resolveFfprobePath = (ffmpegPath: string): string =>
  path.join(path.dirname(ffmpegPath), path.basename(ffmpegPath).replace('ffmpeg', 'ffprobe'))

/**
 * Swap the file extension, keeping the rest of the path.
 */
const withExtension = (filePath: string, ext: `.${string}`): string => {
  const current = path.extname(filePath)
  return current ? filePath.slice(0, -current.length) + ext : `${filePath}${ext}`
}

/**
 * Write next to the final file while keeping the real container extension.
 *
 * ffmpeg picks a muxer from the output name. `clip.mp4.part` is unknown and
 * fails with "Unable to choose an output format"; `clip.part.mp4` remuxes.
 */
export const stagingOutputPath = (outputPath: string): string => {
  const ext = path.extname(outputPath)
  return ext ? `${outputPath.slice(0, -ext.length)}.part${ext}` : `${outputPath}.part`
}

/**
 * ffmpeg `-f` name for a preview path, so a staging file still muxes.
 */
const outputFormat = (outputPath: string): string | null => {
  const ext = path.extname(outputPath).toLowerCase()
  if (ext === '.m4a' || ext === '.m4v' || ext === '.mp4') {
    return 'mp4'
  }
  if (ext === '.webm') {
    return 'webm'
  }
  if (ext === '.ts') {
    return 'mpegts'
  }
  return null
}

/**
 * True when this codec can sit in a Chromium MP4.
 *
 * Chromium only paints 8-bit 4:2:0 H.264. High 4:4:4 and 10-bit streams
 * must be transcoded even though ffprobe still reports `h264`. Windows AV1
 * and HEVC are also transcoded so playback does not depend on optional OS codecs
 * or unstable decoders.
 */
const isMp4Video = (
  codec: string | null,
  pixFmt: string | null = null,
  platform: NodeJS.Platform = process.platform
): boolean => {
  if (platform === 'win32' && codec && WINDOWS_UNSAFE_VIDEO_CODECS.has(codec)) {
    return false
  }
  if (codec === 'h264' && pixFmt && pixFmt !== 'yuv420p') {
    return false
  }
  return codec === null || MP4_VIDEO_CODECS.has(codec)
}

/**
 * True when this codec can sit in a Chromium MP4.
 */
const isMp4Audio = (codec: string | null): boolean => codec === null || MP4_AUDIO_CODECS.has(codec)

/**
 * True when this codec can sit in a Chromium WebM.
 */
const isWebmVideo = (
  codec: string | null,
  platform: NodeJS.Platform = process.platform
): boolean => {
  if (platform === 'win32' && codec && WINDOWS_UNSAFE_VIDEO_CODECS.has(codec)) {
    return false
  }
  return codec === null || WEBM_VIDEO_CODECS.has(codec)
}

/**
 * True when this codec can sit in a Chromium WebM.
 */
const isWebmAudio = (codec: string | null): boolean =>
  codec === null || WEBM_AUDIO_CODECS.has(codec)

/**
 * Read the first video and audio codec names from a local file.
 */
export const probeMediaCodecs = async (
  ffprobePath: string,
  filePath: string
): Promise<MediaCodecProbe> => {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name,codec_type,pix_fmt',
    '-of',
    'csv=p=0',
    filePath
  ])
  let audio: string | null = null
  let video: string | null = null
  let videoPixFmt: string | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const [codec, kind, pixFmt] = line.split(',')
    if (!(codec && kind)) {
      continue
    }
    if (kind === 'video' && !video && !IMAGE_VIDEO_CODECS.has(codec)) {
      video = codec
      videoPixFmt = pixFmt || null
    }
    if (kind === 'audio' && !audio) {
      audio = codec
    }
  }
  return { audio, video, videoPixFmt }
}

/**
 * Decide whether the file can play in Chromium as-is, remux, or must be transcoded.
 *
 * Chromium cannot open MKV. Compatible streams are remuxed (or audio-only
 * re-encoded) into MP4/WebM; everything else is transcoded to H.264/AAC. The
 * platform parameter keeps platform-specific decoder decisions testable.
 */
export const planPlayableMedia = (
  filePath: string,
  probe: MediaCodecProbe,
  outputPath: string,
  platform: NodeJS.Platform = process.platform
): PlayablePreparePlan => {
  const ext = path.extname(filePath).toLowerCase()
  if (isNativelyPlayableAudio(filePath)) {
    return { mode: 'original', outputPath: filePath }
  }
  const mp4Video = isMp4Video(probe.video, probe.videoPixFmt, platform)
  const mp4Audio = isMp4Audio(probe.audio)
  const webmVideo = isWebmVideo(probe.video, platform)
  const webmAudio = isWebmAudio(probe.audio)
  if (
    COPY_CONTAINERS.has(ext) &&
    ((ext === '.webm' && webmVideo && webmAudio) || (ext !== '.webm' && mp4Video && mp4Audio))
  ) {
    return { mode: 'original', outputPath: filePath }
  }
  if (mp4Video && mp4Audio) {
    return {
      audio: 'copy',
      container: 'mp4',
      mode: 'remux',
      outputPath: withExtension(outputPath, '.mp4'),
      video: 'copy'
    }
  }
  if (webmVideo && webmAudio) {
    return {
      audio: 'copy',
      container: 'webm',
      mode: 'remux',
      outputPath: withExtension(outputPath, '.webm'),
      video: 'copy'
    }
  }
  if (mp4Video && probe.video) {
    return {
      audio: 'aac',
      container: 'mp4',
      mode: 'remux',
      outputPath: withExtension(outputPath, '.mp4'),
      video: 'copy'
    }
  }
  if (webmVideo && probe.video) {
    return {
      audio: 'libopus',
      container: 'webm',
      mode: 'remux',
      outputPath: withExtension(outputPath, '.webm'),
      video: 'copy'
    }
  }
  return {
    audio: 'aac',
    container: 'mp4',
    mode: 'transcode',
    outputPath: withExtension(outputPath, '.mp4'),
    video: 'libx264'
  }
}

/**
 * Build ffmpeg args that remux or transcode a file into a Chromium-playable container.
 */
export const buildPlayableMediaArgs = (
  inputPath: string,
  outputPath: string,
  options: PlayableConvertOptions = {}
): string[] => {
  const video = options.video ?? 'libx264'
  const audio = options.audio ?? 'aac'
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-fflags',
    '+genpts',
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn'
  ]
  if (video === 'copy') {
    args.push('-c:v', 'copy')
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20')
  }
  if (audio === 'copy') {
    args.push('-c:a', 'copy')
  } else if (audio === 'libopus') {
    args.push('-c:a', 'libopus', '-b:a', '96k', '-ac', '2')
  } else {
    args.push('-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '44100', '-ac', '2', '-b:a', '160k')
  }
  const format = options.format ?? outputFormat(outputPath)
  if (format === 'mp4') {
    args.push('-movflags', '+faststart')
  }
  if (format) {
    args.push('-f', format)
  }
  args.push(outputPath)
  return args
}

/**
 * Convert one plan into ffmpeg args.
 */
const argsForPlan = (inputPath: string, plan: PlayablePreparePlan): string[] =>
  buildPlayableMediaArgs(inputPath, plan.outputPath, {
    audio: plan.audio ?? 'aac',
    format: plan.container === 'webm' ? 'webm' : 'mp4',
    video: plan.video ?? 'libx264'
  })

/**
 * Remux into MP4 through MPEG-TS.
 *
 * The bundled ffmpeg segfaults on a direct Matroska-to-MP4 stream copy
 * (Lavf 62). MPEG-TS accepts the same copy and MP4 can then copy from TS.
 */
const remuxToMp4ViaMpegTs = async (
  ffmpegPath: string,
  inputPath: string,
  plan: PlayablePreparePlan
): Promise<void> => {
  const tsPath = `${plan.outputPath}.bridge.ts`
  try {
    await runFfmpeg(
      ffmpegPath,
      buildPlayableMediaArgs(inputPath, tsPath, {
        audio: plan.audio ?? 'copy',
        format: 'mpegts',
        video: plan.video ?? 'copy'
      })
    )
    await runFfmpeg(
      ffmpegPath,
      buildPlayableMediaArgs(tsPath, plan.outputPath, {
        audio: 'copy',
        format: 'mp4',
        video: 'copy'
      })
    )
  } finally {
    removeCache(tsPath)
  }
}

/**
 * Write a preview to a staging file, then rename it into place.
 */
const convertWithPlan = async (
  ffmpegPath: string,
  inputPath: string,
  plan: PlayablePreparePlan
): Promise<void> => {
  const partPath = stagingOutputPath(plan.outputPath)
  const partPlan = { ...plan, outputPath: partPath }
  removeCache(partPath)
  try {
    if (plan.mode === 'remux' && plan.container === 'mp4') {
      await remuxToMp4ViaMpegTs(ffmpegPath, inputPath, partPlan)
    } else {
      await runFfmpeg(ffmpegPath, argsForPlan(inputPath, partPlan))
    }
    if (!isUsableCache(partPath)) {
      throw new Error('ffmpeg produced an empty preview file')
    }
    renameSync(partPath, plan.outputPath)
  } catch (error) {
    removeCache(partPath)
    throw error
  }
}

/**
 * Full H.264/AAC fallback used when remux cannot write a Chromium container.
 */
const transcodeFallbackPlan = (outputPath: string): PlayablePreparePlan => ({
  audio: 'aac',
  container: 'mp4',
  mode: 'transcode',
  outputPath: withExtension(outputPath, '.mp4'),
  video: 'libx264'
})

/**
 * Stable key so overlapping attaches reuse one remux/transcode.
 */
const prepareKey = (filePath: string): string => {
  const stats = statSync(filePath)
  return `${filePath}:${stats.mtimeMs}:${stats.size}`
}

/**
 * Remux or transcode once, without sharing in-flight work.
 */
const preparePlayableMediaOnce = async (
  ffmpegPath: string,
  filePath: string,
  options?: PreparePlayableMediaOptions
): Promise<{ mode: PlayablePrepareMode; playablePath: string }> => {
  if (isNativelyPlayableAudio(filePath)) {
    return { mode: 'original', playablePath: filePath }
  }
  const ffprobePath = resolveFfprobePath(ffmpegPath)
  const probe = await probeMediaCodecs(ffprobePath, filePath)
  const plan = planPlayableMedia(
    filePath,
    probe,
    playableCachePath(filePath, 'mp4', options?.cacheDir),
    process.platform
  )
  if (plan.mode === 'original') {
    return { mode: 'original', playablePath: filePath }
  }
  if (isUsableCache(plan.outputPath)) {
    return { mode: plan.mode, playablePath: plan.outputPath }
  }
  mkdirSync(path.dirname(plan.outputPath), { recursive: true })
  try {
    await convertWithPlan(ffmpegPath, filePath, plan)
    if (!isUsableCache(plan.outputPath)) {
      throw new Error('ffmpeg produced an empty preview file')
    }
    return { mode: plan.mode, playablePath: plan.outputPath }
  } catch (error) {
    removeCache(plan.outputPath)
    if (plan.mode !== 'remux') {
      throw error
    }
    const fallback = transcodeFallbackPlan(playableCachePath(filePath, 'mp4', options?.cacheDir))
    if (isUsableCache(fallback.outputPath)) {
      return { mode: 'transcode', playablePath: fallback.outputPath }
    }
    mkdirSync(path.dirname(fallback.outputPath), { recursive: true })
    try {
      await convertWithPlan(ffmpegPath, filePath, fallback)
      if (!isUsableCache(fallback.outputPath)) {
        throw new Error('ffmpeg produced an empty preview file')
      }
      return { mode: 'transcode', playablePath: fallback.outputPath }
    } catch {
      removeCache(fallback.outputPath)
      throw error
    }
  }
}

/**
 * Return a Chromium-playable local path, remuxing or transcoding when needed.
 */
export const preparePlayableMedia = async (
  ffmpegPath: string,
  filePath: string,
  options?: PreparePlayableMediaOptions
): Promise<{ mode: PlayablePrepareMode; playablePath: string }> => {
  const key = prepareKey(filePath)
  const existing = inflightPrepares.get(key)
  if (existing) {
    return existing
  }
  const work = preparePlayableMediaOnce(ffmpegPath, filePath, options)
  inflightPrepares.set(key, work)
  try {
    return await work
  } finally {
    if (inflightPrepares.get(key) === work) {
      inflightPrepares.delete(key)
    }
  }
}

/**
 * Run ffmpeg without buffering the whole log into execFile's maxBuffer.
 */
const runFfmpeg = async (ffmpegPath: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const chunks: Buffer[] = []
    let bytes = 0
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
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      const detail = Buffer.concat(chunks).toString('utf8').trim()
      const reason = signal ? `signal ${signal}` : `code ${code}`
      reject(new Error(detail || `ffmpeg exited with ${reason}`))
    })
  })
}

/**
 * True when a previous remux/transcode produced a non-empty file.
 */
const isUsableCache = (filePath: string): boolean =>
  existsSync(filePath) && statSync(filePath).size > 0

/**
 * Delete a failed preview so the next attempt cannot reuse a truncated file.
 */
const removeCache = (filePath: string): void => {
  if (existsSync(filePath)) {
    unlinkSync(filePath)
  }
}

/**
 * Stable cache path for a remuxed or transcoded preview file.
 */
const playableCachePath = (filePath: string, ext: PlayableContainer, cacheDir?: string): string => {
  const stats = statSync(filePath)
  const digest = createHash('sha1')
    .update(`${filePath}:${stats.mtimeMs}:${stats.size}:${PREVIEW_CACHE_VERSION}`)
    .digest('hex')
  return path.join(cacheDir ?? path.join(tmpdir(), 'vidbee-html5-preview'), `${digest}.${ext}`)
}
