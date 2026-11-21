import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  backgroundChildSpawnOptions,
  FFMPEG_ENCODE_THREADS,
  lowerChildPriority
} from '@vidbee/task-queue/process'
import { isNoAudioStreamError, NO_AUDIO_STREAM_ERROR } from './errors'
import { ffprobePathFromFfmpeg } from './extract-captions'

export const TARGET_SAMPLE_RATE = 16_000

export interface ExtractedAudio {
  wavPath: string
  durationMs: number
}

/**
 * Return true when a cached 16 kHz wav is long enough to reuse.
 */
export const isReusableExtractedWav = (wavMs: number, sourceMs: number): boolean => {
  if (wavMs <= 0) {
    return false
  }
  if (sourceMs <= 0) {
    return true
  }
  return wavMs + 1500 >= sourceMs * 0.9
}

/**
 * Decode the source media to a 16 kHz mono wav, re-extracting a short leftover file.
 */
export async function extractMonoWav(input: {
  sourceFilePath: string
  ffmpegPath: string
  outputDir: string
  signal?: AbortSignal
}): Promise<ExtractedAudio> {
  if (!existsSync(input.sourceFilePath) || statSync(input.sourceFilePath).size <= 0) {
    throw new Error(`source file missing: ${input.sourceFilePath}`)
  }
  if (!existsSync(input.ffmpegPath)) {
    throw new Error(`ffmpeg not found: ${input.ffmpegPath}`)
  }
  mkdirSync(input.outputDir, { recursive: true })
  const wavPath = join(input.outputDir, 'audio-16k-mono.wav')
  const sourceMs = await probeDurationMs(input.ffmpegPath, input.sourceFilePath)
  if (existsSync(wavPath) && statSync(wavPath).size > 0) {
    const cachedMs = await probeDurationMs(input.ffmpegPath, wavPath)
    if (isReusableExtractedWav(cachedMs, sourceMs)) {
      return { wavPath, durationMs: cachedMs }
    }
  }
  if (!(await probeHasAudioStream(input.ffmpegPath, input.sourceFilePath))) {
    throw new Error(NO_AUDIO_STREAM_ERROR)
  }
  await runFfmpeg(
    input.ffmpegPath,
    [
      '-y',
      '-i',
      input.sourceFilePath,
      '-ac',
      '1',
      '-ar',
      String(TARGET_SAMPLE_RATE),
      '-threads',
      FFMPEG_ENCODE_THREADS,
      '-vn',
      wavPath
    ],
    input.signal
  )
  if (!existsSync(wavPath) || statSync(wavPath).size <= 0) {
    throw new Error('ffmpeg conversion failed: empty wav')
  }
  let durationMs = await probeDurationMs(input.ffmpegPath, wavPath)
  if (!isReusableExtractedWav(durationMs, sourceMs)) {
    durationMs = await remuxThenDecode({
      ffmpegPath: input.ffmpegPath,
      sourceFilePath: input.sourceFilePath,
      outputDir: input.outputDir,
      wavPath,
      signal: input.signal
    })
  }
  if (!isReusableExtractedWav(durationMs, sourceMs)) {
    throw new Error(`ffmpeg conversion truncated: wav ${durationMs}ms vs source ${sourceMs}ms`)
  }
  return { wavPath, durationMs }
}

/**
 * Remux the first audio stream to m4a, then decode. Some Bilibili HEVC+AAC
 * MKV files decode as ~5s when ffmpeg reads the container directly.
 */
const remuxThenDecode = async (input: {
  ffmpegPath: string
  sourceFilePath: string
  outputDir: string
  wavPath: string
  signal?: AbortSignal
}): Promise<number> => {
  const copyPath = join(input.outputDir, 'audio-copy.m4a')
  try {
    await runFfmpeg(
      input.ffmpegPath,
      [
        '-y',
        '-i',
        input.sourceFilePath,
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-c',
        'copy',
        copyPath
      ],
      input.signal
    )
    await runFfmpeg(
      input.ffmpegPath,
      [
        '-y',
        '-i',
        copyPath,
        '-ac',
        '1',
        '-ar',
        String(TARGET_SAMPLE_RATE),
        '-threads',
        FFMPEG_ENCODE_THREADS,
        input.wavPath
      ],
      input.signal
    )
  } finally {
    rmSync(copyPath, { force: true })
  }
  if (!existsSync(input.wavPath) || statSync(input.wavPath).size <= 0) {
    throw new Error('ffmpeg conversion failed: empty wav after remux')
  }
  return probeDurationMs(input.ffmpegPath, input.wavPath)
}

/**
 * Spawn ffmpeg and reject with a short no-audio error when the output has no streams.
 *
 * @param bin ffmpeg binary path.
 * @param args ffmpeg arguments.
 * @param signal Optional abort signal to kill the child.
 */
const runFfmpeg = (bin: string, args: string[], signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...backgroundChildSpawnOptions()
    })
    lowerChildPriority(child.pid)
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const onAbort = () => {
      child.kill('SIGTERM')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolve()
        return
      }
      if (isNoAudioStreamError(stderr)) {
        reject(new Error(NO_AUDIO_STREAM_ERROR))
        return
      }
      reject(new Error(`ffmpeg conversion failed (exit ${code}): ${stderr.slice(-2000)}`))
    })
  })

/**
 * Return true when ffprobe reports at least one audio stream.
 * Missing ffprobe is treated as unknown (true) so conversion can still run.
 *
 * @param ffmpegPath Bundled ffmpeg binary.
 * @param filePath Source media path.
 */
const probeHasAudioStream = async (ffmpegPath: string, filePath: string): Promise<boolean> => {
  const ffprobe = ffprobePathFromFfmpeg(ffmpegPath)
  if (!existsSync(ffprobe)) {
    return true
  }
  return new Promise((resolve) => {
    const child = spawn(ffprobe, [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      filePath
    ])
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.on('close', () => {
      resolve(out.trim().length > 0)
    })
    child.on('error', () => resolve(true))
  })
}

/**
 * Read container duration in milliseconds via ffprobe, or 0 when probing fails.
 *
 * @param ffmpegPath Bundled ffmpeg binary.
 * @param wavPath Media path to probe.
 */
const probeDurationMs = async (ffmpegPath: string, wavPath: string): Promise<number> => {
  const ffprobe = ffprobePathFromFfmpeg(ffmpegPath)
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
      wavPath
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

export interface PcmWave {
  sampleRate: number
  samples: Float32Array
}

/**
 * Read a PCM WAV into a JS-owned Float32Array.
 * sherpa-onnx-node's readWave uses N-API external buffers, which Electron-as-Node rejects.
 */
export function readPcmWav(path: string): PcmWave {
  const buf = readFileSync(path)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a wav file: ${path}`)
  }
  let offset = 12
  let sampleRate = TARGET_SAMPLE_RATE
  let bitsPerSample = 16
  let channels = 1
  let data: Buffer | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(start + 2)
      sampleRate = buf.readUInt32LE(start + 4)
      bitsPerSample = buf.readUInt16LE(start + 14)
    } else if (id === 'data') {
      data = buf.subarray(start, start + size)
      break
    }
    offset = start + size + (size % 2)
  }
  if (!data) {
    throw new Error(`wav has no data chunk: ${path}`)
  }
  const frameSize = Math.max(1, channels) * Math.max(1, bitsPerSample / 8)
  const frames = Math.floor(data.length / frameSize)
  const samples = new Float32Array(frames)
  if (bitsPerSample === 16) {
    for (let i = 0; i < frames; i += 1) {
      let sum = 0
      for (let ch = 0; ch < channels; ch += 1) {
        sum += data.readInt16LE((i * channels + ch) * 2) / 32768
      }
      samples[i] = sum / channels
    }
  } else if (bitsPerSample === 32) {
    for (let i = 0; i < frames; i += 1) {
      let sum = 0
      for (let ch = 0; ch < channels; ch += 1) {
        sum += data.readFloatLE((i * channels + ch) * 4)
      }
      samples[i] = sum / channels
    }
  } else if (bitsPerSample === 8) {
    for (let i = 0; i < frames; i += 1) {
      let sum = 0
      for (let ch = 0; ch < channels; ch += 1) {
        sum += ((data[i * channels + ch] ?? 128) - 128) / 128
      }
      samples[i] = sum / channels
    }
  } else {
    throw new Error(`unsupported wav bit depth: ${bitsPerSample}`)
  }
  return { sampleRate, samples }
}
