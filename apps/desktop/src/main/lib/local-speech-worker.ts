import { readFileSync } from 'node:fs'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { getTtsModel, type TtsModelId } from '../../shared/tts-models'
import {
  localSpeechConfig,
  POCKET_REFERENCE_SECONDS,
  REFERENCE_MAX_SECONDS,
  REFERENCE_SAMPLE_RATE
} from './local-speech-config'
import { speechCueSpeed } from './local-speech-timing'

export interface LocalSpeechRequest {
  modelId: TtsModelId
  model: string
  vocoder?: string
  dataDir?: string
  language?: string
  reference?: { file: string; text?: string }
  cues: { text: string; available: number; cueIndex?: number }[]
  maxSpeed: number
  voice: number
  lang?: string
  chineseRules: boolean
}

interface GeneratedAudio {
  samples: Float32Array
  sampleRate: number
}

interface SpeechAddon {
  OfflineTts: new (
    config: Record<string, unknown>
  ) => {
    numSpeakers: number
    sampleRate: number
    generate: (input: {
      text: string
      sid: number
      speed: number
      enableExternalBuffer: boolean
      generationConfig?: Record<string, unknown>
    }) => GeneratedAudio
  }
  writeWave: (filename: string, audio: GeneratedAudio) => boolean
}

/** Load the bundled native addon once per track, entirely outside Electron's main process. */
async function synthesize(): Promise<void> {
  const requestFile = process.argv[2]
  if (!requestFile) {
    throw new Error('A local speech request file is required')
  }
  const request = JSON.parse(readFileSync(requestFile, 'utf8')) as LocalSpeechRequest
  const directory = path.dirname(requestFile)
  const addon = require('sherpa-onnx-node') as SpeechAddon
  const definition = getTtsModel(request.modelId)
  const tts = new addon.OfflineTts(localSpeechConfig(request))
  if (
    !Number.isInteger(request.voice) ||
    request.voice < 0 ||
    request.voice >= (tts.numSpeakers > 0 ? tts.numSpeakers : 1)
  ) {
    throw new Error(`Invalid voice ID for ${definition.name}: ${request.voice}`)
  }
  process.stdout.write(
    `speech_metadata=${JSON.stringify({ voiceCount: tts.numSpeakers, sampleRate: tts.sampleRate })}\n`
  )
  let generationConfig: Record<string, unknown> | undefined
  if (definition.family === 'supertonic') {
    generationConfig = {
      sid: request.voice,
      speed: 1,
      numSteps: 8,
      extra: { lang: request.language ?? 'en' }
    }
  }
  if (request.cues.length && (definition.family === 'pocket' || definition.family === 'zipvoice')) {
    if (!request.reference) {
      throw new Error('This model requires reference audio')
    }
    if (definition.family === 'zipvoice' && !request.reference.text) {
      throw new Error('ZipVoice requires the exact reference audio transcript')
    }
    const buffer = readFileSync(request.reference.file)
    if (
      !buffer.length ||
      buffer.length > REFERENCE_MAX_SECONDS * REFERENCE_SAMPLE_RATE * 4 ||
      buffer.length % 4
    ) {
      throw new Error('Invalid normalized reference audio')
    }
    const samples = new Float32Array(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    )
    generationConfig = {
      sid: request.voice,
      speed: 1,
      numSteps: definition.family === 'pocket' ? 5 : 4,
      referenceAudio: samples,
      referenceSampleRate: REFERENCE_SAMPLE_RATE,
      referenceText: request.reference.text,
      extra: {
        max_reference_audio_len:
          definition.family === 'pocket' ? POCKET_REFERENCE_SECONDS : REFERENCE_MAX_SECONDS
      }
    }
  }
  for (const [index, cue] of request.cues.entries()) {
    const cueIndex = cue.cueIndex ?? index + 1
    process.stdout.write(`speech_progress=${index + 1}/${request.cues.length}\n`)
    await setImmediate()
    const audio = tts.generate({
      text: cue.text,
      sid: request.voice,
      speed: 1,
      // Electron-as-Node forbids N-API external ArrayBuffers.
      enableExternalBuffer: false,
      generationConfig
    })
    if (!(audio.samples.length && audio.sampleRate > 0)) {
      throw new Error(`Speech generation produced no audio for cue ${cueIndex}`)
    }
    speechCueSpeed(
      audio.samples.length / audio.sampleRate,
      cue.available,
      request.maxSpeed,
      cueIndex - 1
    )
    if (!addon.writeWave(path.join(directory, `raw-${index}.wav`), audio)) {
      throw new Error(`Could not save generated audio for cue ${cueIndex}`)
    }
  }
}

/** Report native failures through the bounded parent process stderr channel. */
function reportFailure(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

void synthesize().catch(reportFailure)
