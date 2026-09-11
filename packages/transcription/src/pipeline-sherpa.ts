import { readAsrResult } from './asr-json'
import { buildOfflineRecognizerConfig, resolveAsrModelPaths } from './asr-recognizer'
import { type AsrTierId, asrTierInfo, DEFAULT_ASR_TIER, parseAsrTier } from './asr-tiers'
import { wordsFromAsrResult } from './asr-words'
import { readPcmWav } from './audio'
import {
  applyChineseScriptToSegment,
  chineseScriptOf,
  languageAfterChineseScript
} from './chinese-script'
import {
  appendManifestChunk,
  chunkKey,
  completedChunkKeys,
  loadChunkManifest,
  patchChunkManifest
} from './chunk-manifest'
import { modelVersion } from './model-catalog'
import type { ModelManager } from './model-manager'
import { type PipelineRunInput, report, type TranscriptionPipeline } from './pipeline'
import { needsPunctuation, type Punctuator, punctuateCues, punctuateWords } from './punctuate'
import {
  assignSpeakersToSegments,
  type PipelineSeed,
  seedDurationMs,
  singleSpeakerTurns
} from './speaker-assign'
import {
  DIARIZE_OVERLAP_MS,
  diarizeChunkWindows,
  mergeChunkTurns,
  mergeChunkTurnsByEmbeddings,
  pickSpeakerEmbedTurns,
  type SpeakerEmbed,
  shiftTurns
} from './speaker-chunks'
import { CLUSTERING_THRESHOLD } from './speaker-cluster'
import { DEFAULT_SPEAKER_COUNT, parseSpeakerCount, sherpaNumClusters } from './speaker-count'
import {
  embeddingIdForLanguage,
  SPEAKER_EMBEDDING_ERES2NET_ID,
  SPEAKER_EMBEDDING_TITANET_ID
} from './speaker-embed'
import {
  fillUncoveredTurns,
  type TimedTurn,
  type TimeInterval,
  turnsForAsr
} from './speaker-refine'
import type { PipelineResult, PipelineSegment, PipelineSpeaker } from './types'

export { CLUSTERING_THRESHOLD }
/** Official sherpa default (header + Python example). */
export const MIN_DURATION_ON_SEC = 0.3
export const MIN_DURATION_OFF_SEC = 0.5
export const DIARIZE_NUM_THREADS = 2

export interface SherpaPipelineOptions {
  models: ModelManager
  createAddon?: () => SherpaAddon
}

export interface SherpaWave {
  sampleRate: number
  samples: Float32Array
}

export interface SherpaVad {
  acceptWaveform: (samples: Float32Array) => void
  isEmpty: () => boolean
  front: (enableExternalBuffer?: boolean) => { samples?: Float32Array; start?: number }
  pop: () => void
  flush: () => void
  config?: { sileroVad?: { windowSize?: number } }
}

export interface SherpaDiarization {
  sampleRate?: number
  process: (
    samples: Float32Array
  ) =>
    | Array<{ start: number; end: number; speaker: number }>
    | { get?: (i: number) => { start: number; end: number; speaker: number }; size?: number }
}

export interface SherpaStream {
  acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void
  inputFinished?: () => void
  handle?: unknown
  setOption?: (key: string, value: string) => void
}

export interface SherpaEmbeddingExtractor {
  compute: (stream: SherpaStream, enableExternalBuffer?: boolean) => Float32Array
  createStream: () => SherpaStream
  dim?: number
  isReady?: (stream: SherpaStream) => boolean
}

export interface SherpaRecognizer {
  createStream: () => SherpaStream
  decode: (stream: SherpaStream) => void
  getResult: (stream: SherpaStream) => {
    durations?: number[]
    text?: string
    timestamps?: number[]
    tokens?: string[]
  }
}

export interface SherpaPunctuation {
  addPunct: (text: string) => string
}

export interface SherpaAddon {
  Vad: new (config: Record<string, unknown>, bufferSizeInSeconds?: number) => SherpaVad
  OfflineSpeakerDiarization: new (config: Record<string, unknown>) => SherpaDiarization
  OfflineRecognizer: new (config: Record<string, unknown>) => SherpaRecognizer
  OfflinePunctuation?: new (config: Record<string, unknown>) => SherpaPunctuation
  SpeakerEmbeddingExtractor?: new (config: Record<string, unknown>) => SherpaEmbeddingExtractor
  readWave: (path: string) => SherpaWave
}

/** Qwen3-ASR decode OOMs / SIGTRAPs on multi-minute turns in-process. */
export const MAX_ASR_CHUNK_MS = 15_000

export const splitTurnForAsr = <T extends { startMs: number; endMs: number }>(
  turn: T,
  maxChunkMs = MAX_ASR_CHUNK_MS
): T[] => {
  if (turn.endMs - turn.startMs <= maxChunkMs) {
    return [turn]
  }
  const pieces: T[] = []
  for (let startMs = turn.startMs; startMs < turn.endMs; startMs += maxChunkMs) {
    pieces.push({ ...turn, startMs, endMs: Math.min(turn.endMs, startMs + maxChunkMs) })
  }
  return pieces
}

const loadAddon = (): SherpaAddon => {
  try {
    // Native addon — resolved only inside the isolated worker.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('sherpa-onnx-node') as SherpaAddon
  } catch (err) {
    throw new Error(
      `sherpa-onnx-node native addon is not available: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

const collectTurns = (
  raw: ReturnType<SherpaDiarization['process']>
): Array<{ start: number; end: number; speaker: number }> => {
  if (Array.isArray(raw)) {
    return raw
  }
  const turns: Array<{ start: number; end: number; speaker: number }> = []
  if (raw && typeof raw.size === 'number' && typeof raw.get === 'function') {
    for (let i = 0; i < raw.size; i += 1) {
      turns.push(raw.get(i))
    }
  }
  return turns
}

export class SherpaTranscriptionPipeline implements TranscriptionPipeline {
  constructor(private readonly opts: SherpaPipelineOptions) {}

  async run(input: PipelineRunInput): Promise<PipelineResult> {
    if (input.signal?.aborted) {
      throw new Error('cancelled')
    }
    const speakerCount = parseSpeakerCount(input.speakerCount, DEFAULT_SPEAKER_COUNT)
    const seed = input.existingTranscript
    const asrTier = parseAsrTier(seed?.asrTier ?? input.asrTier, DEFAULT_ASR_TIER)
    if (seed?.segments.length && speakerCount === 1) {
      return await this.commitSeed(input, seed, singleSpeakerTurns(seedDurationMs(seed)), asrTier)
    }

    const runVad = !input.skipVad && input.autoSkipAllowed && !seed
    const loadSpeaker = speakerCount !== 1
    const loadAsr = !seed
    report(input, 'preparing-models', null, runVad ? 'vad' : loadAsr ? 'asr' : 'speaker')
    if (runVad) {
      await this.opts.models.ensureReady({ groups: ['vad'] })
    }

    report(input, runVad ? 'detecting-speech' : 'recognizing', 0.05)
    const addon = this.opts.createAddon ? this.opts.createAddon() : loadAddon()
    const wave = readPcmWav(input.wavPath)
    const waveMs = Math.round((wave.samples.length / Math.max(1, wave.sampleRate)) * 1000)
    const durationMs = waveMs > 0 ? waveMs : input.durationMs
    const speechIntervals = runVad ? this.collectSpeechIntervals(addon, wave, input) : []
    const speech = !runVad || speechIntervals.length > 0
    const script = chineseScriptOf(input.language ?? '')
    if (!speech && input.autoSkipAllowed && !seed) {
      report(input, 'committing', 1, 'no-speech')
      return {
        resultKind: 'no-speech',
        language: null,
        modelVersion,
        asrTier,
        speakers: [],
        segments: []
      }
    }

    if (seed?.segments.length) {
      if (loadSpeaker) {
        report(input, 'preparing-models', 0.3, 'speaker')
        await this.opts.models.ensureReady({ groups: ['speaker'] })
      }
      return await this.commitSeed(
        input,
        seed,
        this.speakerTurns(addon, wave, speechIntervals, durationMs, input, null),
        asrTier,
        addon
      )
    }

    if (loadAsr) {
      report(input, 'preparing-models', 0.3, 'asr')
      await this.opts.models.ensureReady({ groups: ['asr'], tiers: [asrTier] })
    }
    const manifest = input.manifestPath ? loadChunkManifest(input.manifestPath) : null
    report(input, 'recognizing', 0.35)
    const recognized = await this.recognize(
      addon,
      wave,
      this.asrTurnsFromSpeech(speechIntervals, durationMs, !runVad),
      input,
      manifest,
      asrTier,
      durationMs,
      script
    )
    if (loadSpeaker) {
      report(input, 'preparing-models', 0.85, 'speaker')
      await this.opts.models.ensureReady({ groups: ['speaker'] })
    }
    const assigned = assignSpeakersToSegments(
      recognized.segments,
      loadSpeaker
        ? this.speakerTurns(addon, wave, speechIntervals, durationMs, input, manifest)
        : singleSpeakerTurns(durationMs)
    )
    report(input, 'committing', 1)
    return {
      resultKind: 'transcript',
      language: languageAfterChineseScript(assigned.segments, script),
      modelVersion,
      asrTier,
      speakers: assigned.speakers,
      segments: assigned.segments
    }
  }

  /**
   * Overlay new speaker turns onto an existing captions or ASR transcript and finish.
   *
   * @param input Pipeline run input.
   * @param seed Words from the previous ASR result.
   * @param turns Fresh diarization turns.
   * @param asrTier Model already used for the text.
   */
  private async commitSeed(
    input: PipelineRunInput,
    seed: PipelineSeed,
    turns: TimedTurn[],
    asrTier: ReturnType<typeof parseAsrTier>,
    addon?: SherpaAddon
  ): Promise<PipelineResult> {
    let seedSegments = seed.segments
    if (seed.sourceKind === 'captions') {
      const joined = seedSegments.map((segment) => segment.text).join('')
      if (needsPunctuation(joined)) {
        const punct = await this.tryCreatePunctuator(input, addon)
        if (punct) {
          seedSegments = punctuateCues(punct, seedSegments)
        }
      }
    }
    const assigned = assignSpeakersToSegments(seedSegments, turns)
    for (const segment of assigned.segments) {
      input.onPartial?.(segment)
    }
    report(input, 'committing', 1)
    return {
      resultKind: 'transcript',
      language: seed.language,
      modelVersion: seed.modelVersion || modelVersion,
      asrTier: seed.sourceKind === 'captions' ? seed.asrTier : asrTier,
      sourceKind: seed.sourceKind,
      speakers: assigned.speakers,
      segments: assigned.segments
    }
  }

  /**
   * Walk VAD speech (or the whole file) in 15s pieces so ASR can stream before diarization.
   *
   * @param speech Intervals from Silero, or empty when VAD was skipped.
   * @param durationMs Audio length.
   * @param skipVad When true, ignore VAD and recognize the full timeline.
   */
  private asrTurnsFromSpeech(
    speech: TimeInterval[],
    durationMs: number,
    skipVad: boolean
  ): TimedTurn[] {
    const base: TimedTurn[] =
      skipVad || speech.length === 0
        ? []
        : speech.map((interval) => ({
            startMs: interval.startMs,
            endMs: interval.endMs,
            speakerKey: 'speaker-1'
          }))
    return fillUncoveredTurns(base, durationMs).map((turn) => ({
      ...turn,
      speakerKey: 'speaker-1'
    }))
  }

  /**
   * Reuse saved clustering, or run speaker diarization now.
   *
   * @param addon Native sherpa addon.
   * @param wave Full-file waveform.
   * @param speech VAD intervals used as a fallback mask.
   * @param durationMs Audio length.
   * @param input Pipeline run input.
   * @param manifest Resume manifest, if any.
   */
  private speakerTurns(
    addon: SherpaAddon,
    wave: SherpaWave,
    speech: TimeInterval[],
    durationMs: number,
    input: PipelineRunInput,
    manifest: ReturnType<typeof loadChunkManifest>
  ): TimedTurn[] {
    if (manifest?.turns.length) {
      return fillUncoveredTurns(manifest.turns, durationMs)
    }
    report(input, 'diarizing', 0.88)
    const turns = this.diarize(addon, wave, speech, durationMs, input)
    if (manifest && input.manifestPath) {
      const latest = patchChunkManifest(input.manifestPath, { turns })
      manifest.turns = latest.turns
      manifest.chunks = latest.chunks
      manifest.speakers = latest.speakers
    }
    return turns
  }

  private collectSpeechIntervals(
    addon: SherpaAddon,
    wave: SherpaWave,
    input: PipelineRunInput
  ): TimeInterval[] {
    const vadPath = this.opts.models.pathByRole('vad')
    if (!vadPath) {
      throw new Error('model missing: silero vad')
    }
    const durationSec = wave.samples.length / Math.max(1, wave.sampleRate)
    const bufferSec = Math.min(600, Math.max(120, Math.ceil(durationSec) + 5))
    const vad = new addon.Vad(
      {
        sileroVad: {
          model: vadPath,
          threshold: 0.35,
          minSilenceDuration: 0.3,
          minSpeechDuration: 0.15,
          windowSize: 512,
          maxSpeechDuration: 20
        },
        sampleRate: wave.sampleRate,
        numThreads: 1
      },
      bufferSec
    )
    const window = vad.config?.sileroVad?.windowSize ?? 512
    const intervals: TimeInterval[] = []
    const take = () => {
      while (!vad.isEmpty()) {
        const front = vad.front(false)
        const startSample = front.start ?? 0
        const length = front.samples?.length ?? 0
        intervals.push({
          startMs: Math.round((startSample / wave.sampleRate) * 1000),
          endMs: Math.round(((startSample + length) / wave.sampleRate) * 1000)
        })
        vad.pop()
      }
    }
    for (let i = 0; i + window <= wave.samples.length; i += window) {
      if (input.signal?.aborted) {
        throw new Error('cancelled')
      }
      vad.acceptWaveform(wave.samples.subarray(i, i + window))
      take()
    }
    vad.flush()
    take()
    return intervals
  }

  /**
   * Run sherpa OfflineSpeakerDiarization (pyannote neural segmentation).
   * VAD is not used as a diarization mask.
   */
  private diarize(
    addon: SherpaAddon,
    wave: SherpaWave,
    speech: TimeInterval[],
    durationMs: number,
    input: PipelineRunInput
  ): TimedTurn[] {
    const totalMs = durationMs || Math.round((wave.samples.length / wave.sampleRate) * 1000)
    const speakerCount = parseSpeakerCount(input.speakerCount, DEFAULT_SPEAKER_COUNT)
    if (speakerCount === 1) {
      const solo: TimedTurn[] = (speech.length > 0 ? speech : [{ startMs: 0, endMs: totalMs }]).map(
        (interval) => ({
          startMs: interval.startMs,
          endMs: interval.endMs,
          speakerKey: 'speaker-1'
        })
      )
      return turnsForAsr(solo, speech, totalMs, { knownCount: true })
    }
    return this.diarizeSherpa(addon, wave, speech, totalMs, input, speakerCount)
  }

  /**
   * Resolve the CAM++ embedding, falling back to already-downloaded TitaNet or eres2net.
   */
  private embeddingPath(embeddingId: string): string | null {
    return (
      this.opts.models.pathById(embeddingId) ??
      this.opts.models.pathById(SPEAKER_EMBEDDING_TITANET_ID) ??
      this.opts.models.pathById(SPEAKER_EMBEDDING_ERES2NET_ID) ??
      this.opts.models.pathByRole('embedding')
    )
  }

  /**
   * Extract one speaker-level embedding from the longest clean turns in a chunk.
   */
  private embedSpeakerTurns(
    extractor: SherpaEmbeddingExtractor,
    wave: SherpaWave,
    turns: TimedTurn[]
  ): Float32Array | null {
    if (turns.length === 0) {
      return null
    }
    const parts: Float32Array[] = []
    let total = 0
    for (const turn of turns) {
      const start = Math.max(0, Math.floor((turn.startMs / 1000) * wave.sampleRate))
      const end = Math.min(wave.samples.length, Math.ceil((turn.endMs / 1000) * wave.sampleRate))
      if (end <= start) {
        continue
      }
      parts.push(wave.samples.subarray(start, end))
      total += end - start
    }
    if (total === 0) {
      return null
    }
    const joined = new Float32Array(total)
    let offset = 0
    for (const part of parts) {
      joined.set(part, offset)
      offset += part.length
    }
    const stream = extractor.createStream()
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: joined })
    stream.inputFinished?.()
    if (extractor.isReady && !extractor.isReady(stream)) {
      return null
    }
    const vector = extractor.compute(stream, false)
    if (!vector || vector.length === 0) {
      return null
    }
    return vector
  }

  /**
   * sherpa OfflineSpeakerDiarization: pyannote segmentation per chunk, then a
   * global speaker-embedding recluster (even for a single window).
   */
  private diarizeSherpa(
    addon: SherpaAddon,
    wave: SherpaWave,
    speech: TimeInterval[],
    totalMs: number,
    input: PipelineRunInput,
    speakerCount: ReturnType<typeof parseSpeakerCount>
  ): TimedTurn[] {
    const seg = this.opts.models.pathByRole('segmentation')
    const embeddingId = embeddingIdForLanguage(input.language)
    const emb = this.embeddingPath(embeddingId)
    if (!(seg && emb)) {
      throw new Error('model missing: speaker diarization')
    }
    const numClusters = sherpaNumClusters(speakerCount)
    const sd = new addon.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: seg, windowShiftRatio: 0.1 },
        numThreads: DIARIZE_NUM_THREADS,
        provider: 'cpu'
      },
      embedding: { model: emb, numThreads: DIARIZE_NUM_THREADS, provider: 'cpu' },
      clustering: { numClusters, threshold: CLUSTERING_THRESHOLD },
      minDurationOn: MIN_DURATION_ON_SEC,
      minDurationOff: MIN_DURATION_OFF_SEC
    })
    const windows = diarizeChunkWindows(totalMs)
    const Extractor = addon.SpeakerEmbeddingExtractor
    const extractor = Extractor
      ? new Extractor({
          model: emb,
          numThreads: DIARIZE_NUM_THREADS,
          provider: 'cpu'
        })
      : null
    const bridge = extractor ? 'global-recluster' : 'sherpa'
    report(
      input,
      'diarizing',
      0.88,
      `path=${bridge} embedding=${embeddingId} numClusters=${numClusters} threshold=${CLUSTERING_THRESHOLD} windows=${windows.length}`
    )
    const chunkTurns: TimedTurn[][] = []
    const chunkEmbeds: SpeakerEmbed[][] = []
    let merged: TimedTurn[] = []
    for (let i = 0; i < windows.length; i += 1) {
      if (input.signal?.aborted) {
        throw new Error('cancelled')
      }
      const window = windows[i]
      if (!window) {
        continue
      }
      const start = Math.max(0, Math.floor((window.startMs / 1000) * wave.sampleRate))
      const end = Math.min(wave.samples.length, Math.ceil((window.endMs / 1000) * wave.sampleRate))
      const slice = wave.samples.subarray(start, Math.max(start + 1, end))
      const raw = collectTurns(sd.process(slice)).map((turn) => ({
        startMs: Math.round(turn.start * 1000),
        endMs: Math.round(turn.end * 1000),
        speakerKey: `speaker-${turn.speaker + 1}`
      }))
      const shifted = shiftTurns(raw, window.startMs)
      chunkTurns.push(shifted)
      const embeds: SpeakerEmbed[] = []
      if (extractor) {
        const localKeys = [...new Set(shifted.map((turn) => turn.speakerKey))].filter(
          (key) => key !== 'unknown'
        )
        for (const key of localKeys) {
          const picked = pickSpeakerEmbedTurns(shifted, key)
          if (picked.length === 0) {
            continue
          }
          try {
            const vector = this.embedSpeakerTurns(extractor, wave, picked)
            if (vector) {
              embeds.push({ speakerKey: key, vector })
            }
          } catch (error) {
            report(
              input,
              'diarizing',
              0.88 + (0.1 * (i + 1)) / Math.max(1, windows.length),
              `embed-skip ${key}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }
      }
      chunkEmbeds.push(embeds)
      const windowNote = `window ${i + 1}/${windows.length}`
      report(
        input,
        'diarizing',
        0.88 + (0.1 * (i + 1)) / Math.max(1, windows.length),
        windowNote
      )
    }
    const embedCount = chunkEmbeds.reduce((sum, embeds) => sum + embeds.length, 0)
    if (embedCount > 0) {
      merged = mergeChunkTurnsByEmbeddings(windows, chunkTurns, chunkEmbeds, {
        threshold: CLUSTERING_THRESHOLD,
        k: speakerCount === 'auto' ? undefined : speakerCount
      })
    } else {
      for (let i = 0; i < chunkTurns.length; i += 1) {
        const shifted = chunkTurns[i]
        const window = windows[i]
        if (!(shifted && window)) {
          continue
        }
        if (merged.length === 0) {
          merged = shifted
          continue
        }
        merged = mergeChunkTurns(
          merged,
          shifted,
          window.startMs,
          window.startMs + DIARIZE_OVERLAP_MS
        )
      }
    }
    const speakerKeys = new Set(merged.map((turn) => turn.speakerKey)).size
    report(
      input,
      'diarizing',
      0.98,
      `path=${bridge} embedding=${embeddingId} numClusters=${numClusters} threshold=${CLUSTERING_THRESHOLD} speakers=${speakerKeys}`
    )
    return turnsForAsr(merged, speech, totalMs, { knownCount: speakerCount !== 'auto' })
  }

  private async recognize(
    addon: SherpaAddon,
    wave: SherpaWave,
    turns: Array<{ startMs: number; endMs: number; speakerKey: string }>,
    input: PipelineRunInput,
    manifest: ReturnType<typeof loadChunkManifest>,
    asrTier: AsrTierId,
    durationMs: number,
    script: ReturnType<typeof chineseScriptOf>
  ): Promise<{ speakers: PipelineSpeaker[]; segments: PipelineSegment[] }> {
    const recognizer = this.createRecognizer(addon, asrTier)
    let punctuator: Punctuator | null = null
    let punctTried = false
    const speakerKeys = [...new Set(turns.map((turn) => turn.speakerKey))]
    const speakers: PipelineSpeaker[] = manifest?.speakers.length
      ? manifest.speakers
      : speakerKeys.map((key, index) => ({
          speakerKey: key,
          displayName: key === 'unknown' ? 'Unknown speaker' : `Speaker ${index + 1}`
        }))
    if (manifest && input.manifestPath && manifest.speakers.length === 0) {
      const latest = patchChunkManifest(input.manifestPath, { speakers })
      manifest.speakers = latest.speakers
      manifest.chunks = latest.chunks
    }
    const done = manifest ? completedChunkKeys(manifest) : new Set<string>()
    const segments: PipelineSegment[] = manifest
      ? manifest.chunks.map((chunk) =>
          applyChineseScriptToSegment(
            {
              speakerKey: chunk.speakerKey,
              startMs: chunk.startMs,
              endMs: chunk.endMs,
              text: chunk.text,
              words: chunk.words,
              confidence: chunk.confidence
            },
            script
          )
        )
      : []
    for (const existing of segments) {
      input.onPartial?.(existing)
    }
    const pieces = turns.flatMap((turn) => splitTurnForAsr(turn))
    for (let i = 0; i < pieces.length; i += 1) {
      if (input.signal?.aborted) {
        throw new Error('cancelled')
      }
      const turn = pieces[i]
      if (!turn) {
        continue
      }
      report(
        input,
        'recognizing',
        0.6 + (0.35 * i) / Math.max(1, pieces.length),
        `asr ${i + 1}/${pieces.length}`
      )
      if (done.has(chunkKey(turn.startMs, turn.endMs))) {
        continue
      }
      const start = Math.max(0, Math.floor((turn.startMs / 1000) * wave.sampleRate))
      const end = Math.min(
        wave.samples.length,
        Math.ceil(((turn.endMs + 200) / 1000) * wave.sampleRate)
      )
      const chunk = wave.samples.subarray(start, Math.max(start + 1, end))
      const stream = recognizer.createStream()
      stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: chunk })
      recognizer.decode(stream)
      const recognized = readAsrResult(recognizer, stream)
      let text = (recognized.text ?? '').trim()
      if (!text) {
        continue
      }
      let words = wordsFromAsrResult(recognized, turn.startMs, turn.endMs)
      if (needsPunctuation(text)) {
        if (!punctTried) {
          punctTried = true
          punctuator = await this.tryCreatePunctuator(input, addon)
        }
        if (punctuator) {
          const next = punctuateWords(punctuator, text, words)
          text = next.text
          words = next.words ?? words
        }
      }
      const segment = applyChineseScriptToSegment(
        {
          speakerKey: turn.speakerKey === 'unknown' ? null : turn.speakerKey,
          startMs: turn.startMs,
          endMs: turn.endMs,
          text,
          words,
          confidence: null
        },
        script
      )
      segments.push(segment)
      input.onPartial?.(segment)
      if (input.manifestPath) {
        appendManifestChunk(
          input.manifestPath,
          {
            index: i,
            startMs: turn.startMs,
            endMs: turn.endMs,
            speakerKey: segment.speakerKey,
            text: segment.text,
            words: segment.words,
            confidence: null
          },
          { speakers, durationMs }
        )
      }
    }
    return { speakers, segments: segments.sort((a, b) => a.startMs - b.startMs) }
  }

  /**
   * Load OfflinePunctuation when the model is on disk or can be fetched.
   * Download/load failures skip restoration; the caller still finishes.
   */
  private async tryCreatePunctuator(
    input: PipelineRunInput,
    addon?: SherpaAddon
  ): Promise<Punctuator | null> {
    try {
      const resolved = addon ?? (this.opts.createAddon ? this.opts.createAddon() : loadAddon())
      if (!resolved.OfflinePunctuation) {
        return null
      }
      let path = this.opts.models.pathByRole('punctuation')
      if (!path) {
        report(input, 'preparing-models', null, 'punct')
        try {
          await this.opts.models.ensureReady({ groups: ['punct'] })
        } catch {
          return null
        }
        path = this.opts.models.pathByRole('punctuation')
      }
      if (!path) {
        return null
      }
      return new resolved.OfflinePunctuation({
        model: { ctTransformer: path, numThreads: 1, provider: 'cpu', debug: 0 }
      })
    } catch {
      return null
    }
  }

  private createRecognizer(addon: SherpaAddon, asrTier: AsrTierId): SherpaRecognizer {
    return new addon.OfflineRecognizer(
      buildOfflineRecognizerConfig(
        asrTierInfo(asrTier).family,
        resolveAsrModelPaths(this.opts.models, asrTier),
        2
      )
    )
  }
}
