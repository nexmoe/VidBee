import { z } from 'zod'

export const TTS_FAMILIES = [
  'vits',
  'matcha',
  'kokoro',
  'kitten',
  'zipvoice',
  'pocket',
  'supertonic'
] as const
export type TtsFamily = (typeof TTS_FAMILIES)[number]
export const ttsModelIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/)

export interface TtsModelDefinition {
  id: string
  name: string
  family: TtsFamily
  description: string
  downloadBytes: number
  sha256?: string
  voiceCount?: number
  languages: readonly { code: string; defaultVoice: number; lang?: string }[]
}

/** Preserve existing defaults and verified metadata as optional overrides, never a selectable-model whitelist. */
const TTS_PRESETS = [
  {
    id: 'kokoro-multi-lang-v1_0',
    name: 'Kokoro v1.0',
    family: 'kokoro',
    description: 'Multilingual local speech with 53 voices. The original default model.',
    downloadBytes: 349_886_476,
    sha256: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4',
    voiceCount: 53,
    languages: [
      { code: 'en', defaultVoice: 0 },
      { code: 'zh', defaultVoice: 48 },
      { code: 'es', defaultVoice: 28, lang: 'es' },
      { code: 'fr', defaultVoice: 30, lang: 'fr' },
      { code: 'hi', defaultVoice: 31, lang: 'hi' },
      { code: 'it', defaultVoice: 35, lang: 'it' },
      { code: 'pt', defaultVoice: 42, lang: 'pt-br' }
    ]
  },
  {
    id: 'kokoro-int8-multi-lang-v1_1',
    name: 'Kokoro v1.1 INT8',
    family: 'kokoro',
    description: 'Chinese and English speech with 103 voices and quantized local weights.',
    downloadBytes: 147_052_523,
    sha256: '259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c',
    voiceCount: 103,
    languages: [
      { code: 'en', defaultVoice: 0 },
      { code: 'zh', defaultVoice: 3 }
    ]
  },
  {
    id: 'vits-melo-tts-zh_en',
    name: 'MeloTTS Chinese + English',
    family: 'vits',
    description:
      'Bilingual local speech with one voice. English pronunciation is limited to words in the model lexicon.',
    downloadBytes: 167_006_755,
    sha256: 'e58351ed7149f290a54534538badd4077cdbe6fddc964b24d0bee870415d1514',
    voiceCount: 1,
    languages: [
      { code: 'en', defaultVoice: 0 },
      { code: 'zh', defaultVoice: 0 }
    ]
  }
] as const satisfies readonly TtsModelDefinition[]

export type TtsModelId = string
export const DEFAULT_TTS_MODEL_ID: TtsModelId = TTS_PRESETS[0].id

/** Classify model families rather than maintaining a whitelist of individual model IDs. */
export function ttsModelFamily(id: string): TtsFamily | null {
  for (const family of TTS_FAMILIES) {
    if (id.includes(family)) {
      return family
    }
  }
  return id.startsWith('nabra-') ? 'kokoro' : null
}

/** Derive language hints from official release naming without inventing a language for unknown datasets. */
function modelLanguages(id: string, family: TtsFamily): string[] {
  if (family === 'supertonic') {
    return id.includes('supertonic-3-')
      ? [
          'ar',
          'bg',
          'hr',
          'cs',
          'da',
          'nl',
          'en',
          'et',
          'fi',
          'fr',
          'de',
          'el',
          'hi',
          'hu',
          'id',
          'it',
          'ja',
          'ko',
          'lv',
          'lt',
          'pl',
          'pt',
          'ro',
          'ru',
          'sk',
          'sl',
          'es',
          'sv',
          'tr',
          'uk',
          'vi'
        ]
      : ['en', 'ko', 'es', 'pt', 'fr']
  }
  if (id.startsWith('nabra-')) {
    return ['ar']
  }
  if (family === 'pocket' || family === 'kitten' || id === 'vits-vctk') {
    return ['en']
  }
  if (
    id.includes('multi-lang') ||
    id.includes('zh-en') ||
    family === 'zipvoice' ||
    id.includes('melo-tts-zh_en')
  ) {
    return ['en', 'zh']
  }
  const match =
    /(?:piper|coqui|mimic3|mms|icefall|kokoro|inflect|tts)[-_]([a-z]{2,3}(?:_[A-Z]{2}|_[a-z]{2})?)(?:[-_]|$)/.exec(
      id
    ) ?? /^vits-([a-z]{2,3})(?:[-_]|$)/.exec(id)
  if (!match) {
    return []
  }
  return match[1]
    .split('_')
    .filter((code) => code === code.toLowerCase())
    .map((code) => new Intl.Locale(code).language)
}

/** Keep the original presets as metadata overrides while accepting every supported release family. */
export function getTtsModel(id: unknown): TtsModelDefinition {
  const model = TTS_PRESETS.find((candidate) => candidate.id === id)
  if (model) {
    return model
  }
  const parsed = ttsModelIdSchema.safeParse(id)
  const family = parsed.success ? ttsModelFamily(parsed.data) : null
  if (!(parsed.success && family)) {
    throw new Error(`Unknown TTS model family: ${String(id)}`)
  }
  return {
    id: parsed.data,
    name: parsed.data,
    family,
    description: `Official sherpa-onnx ${family} model. Voice count is detected after installation.`,
    downloadBytes: 0,
    languages: modelLanguages(parsed.data, family).map((code) => ({ code, defaultVoice: 0 }))
  }
}

/** Recover older or invalid stored preferences using the original default. */
export function parseTtsModelId(value: unknown): TtsModelId {
  const parsed = ttsModelIdSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_TTS_MODEL_ID
}

/** Validate the chosen language and voice before any model download or native inference. */
export function resolveTtsSpeaker(
  modelOrId: TtsModelDefinition | TtsModelId,
  language: string,
  voice?: number
) {
  const model = typeof modelOrId === 'string' ? getTtsModel(modelOrId) : modelOrId
  const speaker = model.languages.find((candidate) => candidate.code === language)
  if (!speaker && model.languages.length) {
    throw new Error(
      `${model.name} does not support subtitle language ${language || '(unknown)'}. Supported languages: ${model.languages.map((candidate) => candidate.code).join(', ')}. Use manage_tts_model to choose a compatible model.`
    )
  }
  const selected = voice ?? speaker?.defaultVoice ?? 0
  if (
    !Number.isInteger(selected) ||
    selected < 0 ||
    (model.voiceCount !== undefined && selected >= model.voiceCount)
  ) {
    throw new Error(
      `${model.name} requires a voice ID from 0 to ${model.voiceCount === undefined ? 'the installed model limit' : model.voiceCount - 1}`
    )
  }
  return { voice: selected, lang: speaker?.lang }
}
