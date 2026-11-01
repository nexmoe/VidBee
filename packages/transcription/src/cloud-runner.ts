import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractMonoWav } from './audio'
import { manifestWorkKey, sourceFingerprint } from './chunk-manifest'
import type { CloudTranscriptionResult } from './cloud'
import type { PipelineResult, PipelineSegment, TranscriptionStage } from './types'

const SAMPLE_RATE = 16_000
const CLIP_SAMPLES = 20 * SAMPLE_RATE

interface SavedClip {
  start: number
  end: number
  requestId: string
  result?: CloudTranscriptionResult
}

interface CloudProgress {
  accountId: string
  clips: SavedClip[]
}

export interface CloudTranscriptionRunInput {
  accountId: string
  taskId: string
  sourceFilePath: string
  modelId: string
  ffmpegPath: string
  workRoot: string
  signal: AbortSignal
  transcribe: (
    audio: Uint8Array,
    requestId: string,
    signal: AbortSignal
  ) => Promise<CloudTranscriptionResult>
  onProgress: (stage: TranscriptionStage, percent: number | null) => void
  onPartial: (segment: PipelineSegment) => void
}

/** Persist request identities before upload so a lost response can be replayed without another charge. */
async function saveCloudProgress(filePath: string, progress: CloudProgress): Promise<void> {
  const temporary = `${filePath}.tmp`
  await writeFile(temporary, JSON.stringify(progress))
  await rename(temporary, filePath)
}

/** Wrap one PCM clip in a canonical WAV envelope whose duration is verified by Cloud. */
export function cloudClipWav(pcm: Uint8Array): Uint8Array<ArrayBuffer> {
  const wav = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(wav.buffer)
  wav.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, wav.byteLength - 8, true)
  wav.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  wav.set(new TextEncoder().encode('data'), 36)
  view.setUint32(40, pcm.byteLength, true)
  wav.set(pcm, 44)
  return wav
}

/** Prefer a quiet 100 ms boundary near the end of a clip rather than cutting a word at a fixed interval. */
function clipBoundary(pcm: Buffer): number {
  const samples = pcm.byteLength / 2
  if (samples < CLIP_SAMPLES) {
    return samples
  }
  const window = SAMPLE_RATE / 10
  let best = samples
  let quietest = Number.POSITIVE_INFINITY
  for (let start = 15 * SAMPLE_RATE; start + window <= samples; start += window) {
    let energy = 0
    for (let sample = start; sample < start + window; sample++) {
      const value = pcm.readInt16LE(sample * 2)
      energy += value * value
    }
    if (energy <= quietest) {
      quietest = energy
      best = start + window / 2
    }
  }
  return best
}

/** Locate ffmpeg's PCM payload without loading a long recording into memory. */
async function pcmPayload(
  file: Awaited<ReturnType<typeof open>>
): Promise<{ offset: number; samples: number }> {
  const header = Buffer.alloc(12)
  await file.read(header, 0, 12, 0)
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('ffmpeg did not produce PCM WAV audio')
  }
  const { size } = await file.stat()
  let format = false
  for (let offset = 12; offset + 8 <= size; ) {
    const chunk = Buffer.alloc(8)
    await file.read(chunk, 0, 8, offset)
    const length = chunk.readUInt32LE(4)
    if (offset + 8 + length > size) {
      throw new Error('ffmpeg produced truncated WAV audio')
    }
    if (chunk.toString('ascii', 0, 4) === 'fmt ') {
      const fmt = Buffer.alloc(16)
      await file.read(fmt, 0, 16, offset + 8)
      format =
        length >= 16 &&
        fmt.readUInt16LE(0) === 1 &&
        fmt.readUInt16LE(2) === 1 &&
        fmt.readUInt32LE(4) === SAMPLE_RATE &&
        fmt.readUInt16LE(14) === 16
    } else if (chunk.toString('ascii', 0, 4) === 'data') {
      if (!(format && length) || length % 2) {
        throw new Error('ffmpeg produced unsupported PCM audio')
      }
      return { offset: offset + 8, samples: length / 2 }
    }
    offset += 8 + length + (length % 2)
  }
  throw new Error('ffmpeg audio payload is missing')
}

/** Decode locally, recognize serially in Cloud, and resume successful clips through normal queue retries. */
export async function runCloudTranscription(
  input: CloudTranscriptionRunInput
): Promise<{ result: PipelineResult; durationMs: number; cleanup: () => Promise<void> }> {
  input.signal.throwIfAborted()
  const key = manifestWorkKey(
    input.taskId,
    sourceFingerprint(input.sourceFilePath),
    `cloud-v1:${input.modelId}`
  )
  const directory = join(input.workRoot, 'vidbee-transcript', key)
  await mkdir(directory, { recursive: true })
  const progressPath = join(directory, 'cloud.json')
  let saved: CloudProgress
  try {
    saved = JSON.parse(await readFile(progressPath, 'utf8')) as CloudProgress
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    saved = { accountId: input.accountId, clips: [] }
    await saveCloudProgress(progressPath, saved)
  }
  if (saved.accountId !== input.accountId) {
    throw new Error('Sign in with the Cloud account that started this transcription')
  }
  input.onProgress('preparing-audio', null)
  const audio = await extractMonoWav({
    sourceFilePath: input.sourceFilePath,
    ffmpegPath: input.ffmpegPath,
    outputDir: directory,
    signal: input.signal
  })
  input.signal.throwIfAborted()
  const file = await open(audio.wavPath, 'r')
  const segments: PipelineSegment[] = []
  let language: string | null = null
  try {
    const payload = await pcmPayload(file)
    let start = 0
    let index = 0
    while (start < payload.samples) {
      input.signal.throwIfAborted()
      const pcm = Buffer.alloc(Math.min(CLIP_SAMPLES, payload.samples - start) * 2)
      const { bytesRead } = await file.read(pcm, 0, pcm.length, payload.offset + start * 2)
      if (bytesRead !== pcm.length) {
        throw new Error('Extracted audio changed during Cloud transcription')
      }
      const end = start + clipBoundary(pcm)
      let clip = saved.clips[index]
      if (clip && (clip.start !== start || clip.end !== end)) {
        throw new Error('Cloud transcription checkpoint does not match the audio')
      }
      if (!clip) {
        clip = { start, end, requestId: randomUUID() }
        saved.clips.push(clip)
        await saveCloudProgress(progressPath, saved)
      }
      input.onProgress('recognizing', start / payload.samples)
      if (!clip.result) {
        for (let restart = 0; restart < 2; restart++) {
          try {
            clip.result = await input.transcribe(
              cloudClipWav(pcm.subarray(0, (end - start) * 2)),
              clip.requestId,
              input.signal
            )
            await saveCloudProgress(progressPath, saved)
            break
          } catch (error) {
            const details = error as { code?: string; status?: number }
            // An old failed reservation needs a fresh id; ambiguous failures keep their id for replay.
            if (details.code === 'AI_TRANSCRIPTION_FAILED') {
              clip.requestId = randomUUID()
              await saveCloudProgress(progressPath, saved)
              if (details.status === 409 && restart === 0) {
                continue
              }
            }
            throw error
          }
        }
      }
      const result = clip.result
      if (!result) {
        throw new Error('Cloud transcription did not return a clip result')
      }
      language ??= result.language
      if (result.text) {
        const segment: PipelineSegment = {
          speakerKey: null,
          startMs: Math.round((start / SAMPLE_RATE) * 1000),
          endMs: Math.round((end / SAMPLE_RATE) * 1000),
          text: result.text,
          words: [],
          confidence: null
        }
        segments.push(segment)
        input.onPartial(segment)
      }
      start = end
      index++
    }
    input.onProgress('committing', 1)
    return {
      /** Delete decoded audio only after the executor commits the paid result locally. */
      cleanup: async () => {
        try {
          await rm(directory, { recursive: true, force: true })
        } catch {
          /* Scratch cleanup does not invalidate a committed transcript. */
        }
      },
      durationMs: Math.round((payload.samples / SAMPLE_RATE) * 1000),
      result: {
        resultKind: segments.length ? 'transcript' : 'no-speech',
        language,
        modelVersion: `cloud:${input.modelId}`,
        asrTier: `cloud:${input.modelId}`,
        sourceKind: 'asr',
        speakers: [],
        segments
      }
    }
  } finally {
    await file.close()
  }
}
