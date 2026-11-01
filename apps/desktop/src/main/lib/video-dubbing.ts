import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captionLanguageForMatch } from '@vidbee/transcription'
import { buildAssDocument } from '../../shared/subtitle-export'
import { resolveTtsSpeaker } from '../../shared/tts-models'
import { type DubbingInput, dubbingInputSchema } from '../../shared/video-localization'
import { settingsManager } from '../settings'
import { runAgentMediaProcess, withAgentMedia } from './agent-media'
import { type IndexedSubtitleCue, resolveSpokenCues } from './dubbing-text'
import { escapeFfmpegSubtitlePath } from './export-video-subtitles-args'
import { ffmpegManager } from './ffmpeg-manager'
import { requireSpeechModel } from './local-speech-catalog'
import {
  POCKET_REFERENCE_SECONDS,
  REFERENCE_MAX_SECONDS,
  REFERENCE_SAMPLE_RATE,
  speechModelReference
} from './local-speech-config'
import { prepareLocalSpeech, synthesizeLocalSpeech } from './local-speech-runtime'
import { speechCueIntervals, speechCueSpeed } from './local-speech-timing'
import { probeLocalMedia } from './media-probe'
import {
  localizationSource,
  publishLocalizedMedia,
  withLocalizationDirectory
} from './video-localization'

type Progress = (text: string) => void
type SpeechRuntime = Awaited<ReturnType<typeof prepareLocalSpeech>>
const SAMPLE_RATE = 24_000
const SEGMENT_SECONDS = 60

/** Run only an owned background process with bounded output and cancellation. */
async function processMedia(
  executable: string,
  args: string[],
  directory: string,
  signal: AbortSignal,
  env?: NodeJS.ProcessEnv,
  onProgress?: Progress,
  timeoutMs = 120_000
) {
  return await runAgentMediaProcess(executable, args, {
    directory,
    signal,
    env,
    timeoutMs,
    onProgress,
    maxBytes: 8_000_000_000
  })
}

/** Concatenate application-generated relative filenames without exposing paths to FFmpeg's parser. */
async function concatenate(
  ffmpeg: string,
  directory: string,
  files: string[],
  output: string,
  signal: AbortSignal
) {
  const list = `${output}.txt`
  await writeFile(path.join(directory, list), files.map((file) => `file '${file}'`).join('\n'))
  await processMedia(
    ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      '-n',
      '-protocol_whitelist',
      'file,pipe',
      '-f',
      'concat',
      '-safe',
      '1',
      '-i',
      path.join(directory, list),
      '-c:a',
      'pcm_s16le',
      path.join(directory, output)
    ],
    directory,
    signal
  )
}

/** Fit one generated cue, refusing any speed adjustment that would cut off spoken words. */
async function fitSpeechCue(input: {
  ffmpeg: string
  directory: string
  index: number
  cueIndex: number
  available: number
  maxSpeed: number
  signal: AbortSignal
}) {
  const { ffmpeg, directory, index, cueIndex, available, maxSpeed, signal } = input
  const raw = path.join(directory, `raw-${index}.wav`)
  const probe = await probeLocalMedia(raw, signal)
  const duration = Number(probe.format?.duration)
  if (!(duration > 0)) {
    throw new Error(`Speech generation produced no audio for cue ${cueIndex}`)
  }
  const speed = speechCueSpeed(duration, available, maxSpeed, cueIndex - 1)
  const file = `cue-${index}.wav`
  await processMedia(
    ffmpeg,
    [
      '-nostdin',
      '-v',
      'error',
      '-n',
      '-i',
      raw,
      '-af',
      `atempo=${speed}`,
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      path.join(directory, file)
    ],
    directory,
    signal
  )
  const fitted = await probeLocalMedia(path.join(directory, file), signal)
  const fittedDuration = Number(fitted.format?.duration)
  if (!(fittedDuration > 0) || fittedDuration > available + 0.001) {
    throw new Error(
      `Cue ${cueIndex} still exceeds its subtitle interval after tempo adjustment. Shorten its spoken text with speechOverrides; no speech was truncated.`
    )
  }
  await rm(raw)
  return { file, duration: fittedDuration }
}

/** Build a complete speech timeline, retaining source silence instead of concatenating speech back-to-back. */
async function synthesizeTrack(
  runtime: SpeechRuntime,
  ffmpeg: string,
  directory: string,
  cues: IndexedSubtitleCue[],
  duration: number,
  input: DubbingInput,
  signal: AbortSignal,
  progress: Progress,
  voice: number,
  lang?: string,
  chineseRules = false
) {
  const intervals = speechCueIntervals(cues, duration)
  let reference: { file: string; text?: string } | undefined
  if (runtime.family === 'pocket' || runtime.family === 'zipvoice') {
    const selected = speechModelReference(runtime.model, input.reference)
    if (runtime.family === 'zipvoice' && !selected.text) {
      throw new Error(
        'ZipVoice requires reference.text: the exact transcript of the selected model reference WAV. Use manage_tts_model action=prepare to inspect bundled references.'
      )
    }
    const probe = await probeLocalMedia(selected.file, signal)
    const seconds = Number(probe.format?.duration)
    if (
      !(Number.isFinite(seconds) && seconds > 0) ||
      (runtime.family === 'zipvoice' && seconds > REFERENCE_MAX_SECONDS)
    ) {
      throw new Error(
        'TTS reference audio must have a usable duration; ZipVoice references must not exceed 30 seconds'
      )
    }
    const file = path.join(directory, 'reference.f32')
    await processMedia(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-n',
        '-i',
        selected.file,
        ...(runtime.family === 'pocket' ? ['-t', String(POCKET_REFERENCE_SECONDS)] : []),
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(REFERENCE_SAMPLE_RATE),
        '-f',
        'f32le',
        file
      ],
      directory,
      signal
    )
    reference = { file, text: selected.text }
  }
  await synthesizeLocalSpeech({
    modelId: runtime.modelId,
    model: runtime.model,
    vocoder: runtime.vocoder,
    dataDir: runtime.dataDir,
    language: chineseRules ? 'zh' : (lang ?? 'en'),
    reference,
    cues: cues.map((cue, index) => ({
      text: cue.text,
      cueIndex: cue.cueIndex,
      available: intervals[index].end - intervals[index].start
    })),
    maxSpeed: input.maxSpeed,
    directory,
    voice,
    lang,
    chineseRules,
    signal,
    onProgress: progress
  })
  const files: string[] = []
  let cursor = 0
  /** Insert real silence for each unvoiced source interval. */
  const silence = async (seconds: number) => {
    if (seconds < 0.001) {
      return
    }
    const file = `silence-${files.length}.wav`
    await processMedia(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-n',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
        '-t',
        String(seconds),
        '-c:a',
        'pcm_s16le',
        path.join(directory, file)
      ],
      directory,
      signal
    )
    files.push(file)
  }
  for (const [index, { start, end }] of intervals.entries()) {
    signal.throwIfAborted()
    await silence(start - cursor)
    progress(`Aligning speech ${index + 1}/${cues.length}`)
    const synthesized = await fitSpeechCue({
      ffmpeg,
      directory,
      index,
      cueIndex: cues[index].cueIndex,
      available: end - start,
      maxSpeed: input.maxSpeed,
      signal
    })
    files.push(synthesized.file)
    await silence(end - start - synthesized.duration)
    cursor = end
  }
  await silence(duration - cursor)
  await concatenate(ffmpeg, directory, files, 'speech.wav', signal)
  for (const file of files) {
    await rm(path.join(directory, file))
  }
}

/** Separate vocals in bounded CPU chunks so long videos do not require a full uncompressed waveform in memory. */
async function separateBackground(
  runtime: SpeechRuntime,
  ffmpeg: string,
  source: string,
  directory: string,
  duration: number,
  signal: AbortSignal,
  progress: Progress
) {
  if (!runtime.separator) {
    throw new Error('Local source separation runtime is unavailable')
  }
  const files: string[] = []
  for (let start = 0; start < duration; start += SEGMENT_SECONDS) {
    signal.throwIfAborted()
    progress(
      `Separating original vocals ${Math.floor(start / SEGMENT_SECONDS) + 1}/${Math.ceil(duration / SEGMENT_SECONDS)}`
    )
    const wav = path.join(directory, 'separation-input.wav')
    const vocals = path.join(directory, 'vocals.wav')
    const file = `background-${files.length}.wav`
    await processMedia(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-ss',
        String(start),
        '-i',
        source,
        '-t',
        String(Math.min(SEGMENT_SECONDS, duration - start)),
        '-vn',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        wav
      ],
      directory,
      signal
    )
    await processMedia(
      runtime.separator,
      [
        `--spleeter-vocals=${path.join(runtime.separation, 'vocals.fp16.onnx')}`,
        `--spleeter-accompaniment=${path.join(runtime.separation, 'accompaniment.fp16.onnx')}`,
        '--num-threads=1',
        `--input-wav=${wav}`,
        `--output-vocals-wav=${vocals}`,
        `--output-accompaniment-wav=${path.join(directory, file)}`
      ],
      directory,
      signal,
      runtime.env
    )
    files.push(file)
    await rm(vocals, { force: true })
  }
  await concatenate(ffmpeg, directory, files, 'background.wav', signal)
  for (const file of files) {
    await rm(path.join(directory, file))
  }
  await rm(path.join(directory, 'separation-input.wav'), { force: true })
}

/** Render a dubbed video or audio file using managed local models and the existing FFmpeg engine. */
export async function createDubbedVideo(
  downloadId: string,
  raw: unknown,
  signal: AbortSignal,
  progress: Progress
) {
  const input = dubbingInputSchema.parse(raw)
  const { snapshot, source, cues } = localizationSource(downloadId, input.sourceKey)
  const speechCues = resolveSpokenCues(cues, input.speechOverrides)
  const language = captionLanguageForMatch(source.language ?? '').split('-')[0]
  const modelId = input.modelId ?? settingsManager.get('ttsModelId')
  const definition = await requireSpeechModel(modelId, signal)
  const speaker = resolveTtsSpeaker(definition, language, input.voice)
  if (!snapshot.sourceFilePath) {
    throw new Error('Download the source media before generating dubbing')
  }
  const sourceFile = snapshot.sourceFilePath
  return await withAgentMedia(signal, async () => {
    const ffmpeg = await ffmpegManager.ensureInitialized()
    const probe = await probeLocalMedia(sourceFile, signal)
    const duration = Number(probe.format?.duration)
    if (!(Number.isFinite(duration) && duration > 0)) {
      throw new Error('Source media has no usable duration')
    }
    const separate =
      input.background === 'separate' &&
      probe.streams.some((stream) => stream.codec_type === 'audio')
    const runtime = await prepareLocalSpeech(signal, separate, progress, modelId)
    return await withLocalizationDirectory(snapshot.title ?? 'dubbed', async (directory) => {
      await synthesizeTrack(
        runtime,
        ffmpeg,
        directory,
        speechCues,
        duration,
        input,
        signal,
        progress,
        speaker.voice,
        speaker.lang ?? (language !== 'zh' && language !== 'en' ? language : undefined),
        language === 'zh'
      )
      if (separate) {
        await separateBackground(runtime, ffmpeg, sourceFile, directory, duration, signal, progress)
      }
      const hasVideo = probe.streams.some((stream) => stream.codec_type === 'video')
      const extension = hasVideo ? 'mp4' : 'm4a'
      const temporary = path.join(directory, `dubbed.${extension}`)
      const args = [
        '-nostdin',
        '-v',
        'error',
        '-n',
        '-i',
        sourceFile,
        '-i',
        path.join(directory, 'speech.wav')
      ]
      if (separate) {
        args.push('-i', path.join(directory, 'background.wav'))
      }
      args.push(
        '-filter_complex',
        separate
          ? '[1:a]loudnorm=I=-20:TP=-1:LRA=11[voice];[2:a][voice]amix=inputs=2:duration=longest:normalize=0[a]'
          : '[1:a]loudnorm=I=-20:TP=-1:LRA=11[a]',
        '-map',
        '[a]'
      )
      if (hasVideo) {
        args.push('-map', '0:v:0')
        if (input.burnSubtitles) {
          const ass = path.join(directory, 'subtitles.ass')
          await writeFile(ass, buildAssDocument(cues))
          const escaped = escapeFfmpegSubtitlePath(ass)
          args.push(
            '-vf',
            `ass=filename='${escaped}'`,
            '-c:v',
            'libx264',
            '-threads',
            '1',
            '-pix_fmt',
            'yuv420p'
          )
        } else {
          const codec = probe.streams.find((stream) => stream.codec_type === 'video')?.codec_name
          if (codec && ['h264', 'hevc', 'av1', 'mpeg4', 'vp9'].includes(codec)) {
            args.push('-c:v', 'copy')
          } else {
            args.push('-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p')
          }
        }
      } else {
        args.push('-vn')
      }
      args.push(
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-t',
        String(duration),
        '-movflags',
        '+faststart',
        temporary
      )
      progress('Rendering dubbed media')
      args.splice(args.length - 1, 0, '-progress', 'pipe:1', '-nostats')
      await processMedia(ffmpeg, args, directory, signal, undefined, progress, 30 * 60 * 1000)
      await probeLocalMedia(temporary, signal)
      signal.throwIfAborted()
      const output = await publishLocalizedMedia(
        temporary,
        `${snapshot.title ?? 'Media'} ${language} dubbed`,
        extension
      )
      return {
        ...output,
        sourceKey: input.sourceKey,
        cues: cues.length,
        speechOverrides: input.speechOverrides?.length ?? 0,
        language,
        modelId,
        voice: speaker.voice,
        background: separate ? 'separated' : 'removed',
        durationSeconds: duration
      }
    })
  })
}
