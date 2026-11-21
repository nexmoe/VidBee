import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { getTtsModel, type TtsModelId } from '../../shared/tts-models'

export const REFERENCE_SAMPLE_RATE = 24_000
export const REFERENCE_MAX_SECONDS = 30
export const POCKET_REFERENCE_SECONDS = 12

export interface LocalSpeechConfigInput {
  modelId: TtsModelId
  model: string
  lang?: string
  chineseRules: boolean
  vocoder?: string
  dataDir?: string
}

/** List only real model-root entries; downloaded symlinks cannot redirect native model reads. */
export function speechModelEntries(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }
  return readdirSync(directory).filter(
    (name) => !lstatSync(path.join(directory, name)).isSymbolicLink()
  )
}

/** Discover the official example voices without accepting arbitrary filesystem paths. */
export function speechModelReferences(directory: string): { file: string; text?: string }[] {
  const references: { file: string; text?: string }[] = []
  for (const folder of ['test_wavs', 'voices', 'samples']) {
    const target = path.join(directory, folder)
    if (
      !(existsSync(target) && lstatSync(target).isDirectory()) ||
      lstatSync(target).isSymbolicLink()
    ) {
      continue
    }
    for (const name of speechModelEntries(target)
      .filter((file) => file.endsWith('.wav'))
      .sort()) {
      const transcript = path.join(target, name.replace(/\.wav$/, '.txt'))
      references.push({
        file: `${folder}/${name}`,
        text:
          existsSync(transcript) &&
          lstatSync(transcript).isFile() &&
          lstatSync(transcript).size <= 16_000
            ? readFileSync(transcript, 'utf8').trim()
            : undefined
      })
    }
  }
  return references
}

/** Select a bundled reference voice and bind any supplied transcript to a contained audio file. */
export function speechModelReference(
  directory: string,
  reference?: { file: string; text?: string }
) {
  const selected =
    reference ??
    speechModelReferences(directory).find((item) => item.text) ??
    speechModelReferences(directory)[0]
  if (!selected) {
    throw new Error(
      'This TTS model requires a reference audio file from its installed model directory'
    )
  }
  const file = path.resolve(directory, selected.file)
  const relative = path.relative(realpathSync(directory), realpathSync(file))
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !lstatSync(file).isFile() ||
    lstatSync(file).isSymbolicLink() ||
    !file.endsWith('.wav')
  ) {
    throw new Error('Reference audio must be a WAV file inside the selected model directory')
  }
  return { file, text: selected.text }
}

/** Resolve model files by family conventions, including the publisher's precision and filename variants. */
export function localSpeechConfig(input: LocalSpeechConfigInput) {
  const { family } = getTtsModel(input.modelId)
  const entries = speechModelEntries(input.model)
  /** Resolve a required publisher file, never silently selecting another model. */
  const required = (name: string): string => {
    if (!entries.includes(name)) {
      throw new Error(`Missing ${family} model file: ${name}`)
    }
    return path.join(input.model, name)
  }
  /** Resolve the requested precision while accepting the model family's standard filename variants. */
  const weight = (stem: string): string => {
    let candidates = entries
      .filter(
        (name) =>
          name.endsWith('.onnx') &&
          (name === `${stem}.onnx` || name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`))
      )
      .sort()
    if (!candidates.length && stem === 'model') {
      candidates = entries
        .filter((name) => name.endsWith('.onnx') && !/(?:vocoder|vocos|hifigan)/.test(name))
        .sort()
    }
    const precision = input.modelId.includes('int8')
      ? 'int8'
      : input.modelId.includes('fp16')
        ? 'fp16'
        : ''
    const selected =
      (precision ? candidates.find((name) => name.includes(precision)) : undefined) ??
      candidates.find((name) => name === `${stem}.onnx`) ??
      candidates[0]
    if (!selected) {
      throw new Error(`Missing ${family} ONNX weights: ${stem}`)
    }
    return required(selected)
  }
  const lexicons = entries.includes('lexicon.txt')
    ? ['lexicon.txt']
    : entries.filter((name) => /^lexicon.*\.txt$/.test(name) && !name.includes('gb-en')).sort()
  const dataDir = entries.includes('espeak-ng-data')
    ? path.join(input.model, 'espeak-ng-data')
    : (input.dataDir ?? '')
  const text = {
    tokens: family === 'pocket' || family === 'supertonic' ? '' : required('tokens.txt'),
    lexicon: lexicons.map(required).join(','),
    dataDir
  }
  let model: Record<string, string | number>
  switch (family) {
    case 'vits':
      model = { ...text, model: weight('model') }
      break
    case 'kokoro':
      model = {
        ...text,
        model: weight('model'),
        voices: required('voices.bin'),
        lang: input.lang ?? ''
      }
      break
    case 'kitten':
      model = {
        model: weight('model'),
        voices: required('voices.bin'),
        tokens: text.tokens,
        dataDir
      }
      break
    case 'matcha':
      model = { ...text, acousticModel: weight('model'), vocoder: input.vocoder ?? '' }
      break
    case 'zipvoice':
      model = {
        ...text,
        encoder: weight('encoder'),
        decoder: weight('decoder'),
        vocoder: input.vocoder ?? ''
      }
      break
    case 'pocket':
      model = {
        lmFlow: weight('lm_flow'),
        lmMain: weight('lm_main'),
        encoder: weight('encoder'),
        decoder: weight('decoder'),
        textConditioner: weight('text_conditioner'),
        vocabJson: required('vocab.json'),
        tokenScoresJson: required('token_scores.json')
      }
      break
    case 'supertonic':
      model = {
        durationPredictor: weight('duration_predictor'),
        textEncoder: weight('text_encoder'),
        vectorEstimator: weight('vector_estimator'),
        vocoder: weight('vocoder'),
        ttsJson: required('tts.json'),
        unicodeIndexer: required('unicode_indexer.bin'),
        voiceStyle: required('voice.bin')
      }
      break
    default:
      throw new Error(`Unsupported TTS model family: ${String(family)}`)
  }
  const language = input.lang?.split('-')[0]
  /** Keep Chinese rules away from other languages and honor language-specific normalizers when present. */
  const rules = (extension: string) =>
    entries
      .filter(
        (name) =>
          name.endsWith(extension) &&
          /^(?:date|number|phone|normalize|rule)[-_.]/.test(name) &&
          (input.chineseRules
            ? !/[-_](en|de|fr|es)\./.test(name)
            : Boolean(language && new RegExp(`[-_]${language}\\.`).test(name)))
      )
      .sort()
      .map(required)
      .join(',')
  return {
    model: { [family]: model, numThreads: 1, provider: 'cpu', debug: false },
    ruleFsts: rules('.fst'),
    ruleFars: rules('.far'),
    maxNumSentences: 1
  }
}
