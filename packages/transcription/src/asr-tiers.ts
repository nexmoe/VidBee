export const ASR_TIER_IDS = [
  'minimal',
  'whisper-base',
  'balanced',
  'whisper-medium',
  'whisper-turbo',
  'sense-voice',
  'sense-voice-2025',
  'parakeet-v2',
  'parakeet-v3',
  'orukeet',
  'quality'
] as const

export type AsrTierId = (typeof ASR_TIER_IDS)[number]

export type { SpeakerCount } from './speaker-count'
export {
  DEFAULT_SPEAKER_COUNT,
  isSpeakerCount,
  MAX_SPEAKER_COUNT,
  parseSpeakerCount,
  SPEAKER_COUNT_CHOICES,
  sherpaNumClusters
} from './speaker-count'

export type AsrFamily = 'whisper' | 'qwen3' | 'sense-voice' | 'parakeet'

export type AsrLanguageGroup = 'zh' | 'cjk' | 'en' | 'multi'

export type MachineClass = 'low' | 'mid' | 'high'

export interface AsrTierInfo {
  id: AsrTierId
  family: AsrFamily
  modelId: string
  /** Model archive or directory name. */
  archiveName: string
  bytesHint: number
  minRamGB: number
  qualityRank: number
  languages: readonly AsrLanguageGroup[]
  performance: {
    machine: string
    speed: string
    quality: string
  }
}

export const DEFAULT_ASR_TIER: AsrTierId = 'minimal'

/** Official k2-fsa/sherpa-onnx asr-models assets (verified 2026-08-19). */
export const WHISPER_TINY_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2'
export const WHISPER_TINY_DIR = 'sherpa-onnx-whisper-tiny'
export const WHISPER_BASE_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2'
export const WHISPER_BASE_DIR = 'sherpa-onnx-whisper-base'
export const WHISPER_SMALL_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2'
export const WHISPER_SMALL_DIR = 'sherpa-onnx-whisper-small'
export const WHISPER_MEDIUM_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-medium.tar.bz2'
export const WHISPER_MEDIUM_DIR = 'sherpa-onnx-whisper-medium'
export const WHISPER_TURBO_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2'
export const WHISPER_TURBO_DIR = 'sherpa-onnx-whisper-turbo'
export const SENSE_VOICE_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2'
export const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
export const SENSE_VOICE_2025_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2'
export const SENSE_VOICE_2025_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09'
export const PARAKEET_V2_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2'
export const PARAKEET_V2_DIR = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8'
export const PARAKEET_V3_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2'
export const PARAKEET_V3_DIR = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'
export const ORUKEET_DIR = 'sherpa-onnx-orukeet-v0.1.0-int8'
export const QWEN3_ASR_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2'
export const QWEN3_ASR_DIR = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25'

export const ASR_TIERS: readonly AsrTierInfo[] = [
  {
    id: 'minimal',
    family: 'whisper',
    modelId: 'whisper-tiny-int8',
    archiveName: 'sherpa-onnx-whisper-tiny.tar.bz2',
    bytesHint: 75_000_000,
    minRamGB: 4,
    qualityRank: 10,
    languages: ['multi', 'en', 'zh', 'cjk'],
    performance: {
      machine: 'low-end',
      speed: 'fast',
      quality: 'ok'
    }
  },
  {
    id: 'whisper-base',
    family: 'whisper',
    modelId: 'whisper-base-int8',
    archiveName: 'sherpa-onnx-whisper-base.tar.bz2',
    bytesHint: 150_000_000,
    minRamGB: 6,
    qualityRank: 20,
    languages: ['multi', 'en', 'zh', 'cjk'],
    performance: {
      machine: 'low-end',
      speed: 'fast',
      quality: 'good'
    }
  },
  {
    id: 'balanced',
    family: 'whisper',
    modelId: 'whisper-small-int8',
    archiveName: 'sherpa-onnx-whisper-small.tar.bz2',
    bytesHint: 250_000_000,
    minRamGB: 8,
    qualityRank: 30,
    languages: ['multi', 'en', 'zh', 'cjk'],
    performance: {
      machine: 'mainstream',
      speed: 'medium',
      quality: 'good'
    }
  },
  {
    id: 'whisper-medium',
    family: 'whisper',
    modelId: 'whisper-medium-int8',
    archiveName: 'sherpa-onnx-whisper-medium.tar.bz2',
    bytesHint: 770_000_000,
    minRamGB: 12,
    qualityRank: 38,
    languages: ['multi', 'en', 'zh', 'cjk'],
    performance: {
      machine: 'mainstream',
      speed: 'medium',
      quality: 'better'
    }
  },
  {
    id: 'whisper-turbo',
    family: 'whisper',
    modelId: 'whisper-turbo-int8',
    archiveName: 'sherpa-onnx-whisper-turbo.tar.bz2',
    bytesHint: 810_000_000,
    minRamGB: 10,
    qualityRank: 42,
    languages: ['multi', 'en', 'zh', 'cjk'],
    performance: {
      machine: 'mainstream',
      speed: 'medium',
      quality: 'better'
    }
  },
  {
    id: 'sense-voice',
    family: 'sense-voice',
    modelId: 'sense-voice-zh-en-ja-ko-yue-int8',
    archiveName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
    bytesHint: 230_000_000,
    minRamGB: 8,
    qualityRank: 36,
    languages: ['zh', 'cjk', 'en', 'multi'],
    performance: {
      machine: 'mainstream',
      speed: 'fast',
      quality: 'good-cjk'
    }
  },
  {
    id: 'sense-voice-2025',
    family: 'sense-voice',
    modelId: 'sense-voice-zh-en-ja-ko-yue-int8-2025',
    archiveName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    bytesHint: 230_000_000,
    minRamGB: 8,
    qualityRank: 37,
    languages: ['zh', 'cjk', 'en', 'multi'],
    performance: {
      machine: 'mainstream',
      speed: 'fast',
      quality: 'good-cjk'
    }
  },
  {
    id: 'parakeet-v2',
    family: 'parakeet',
    modelId: 'nemo-parakeet-tdt-0.6b-v2-int8',
    archiveName: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
    bytesHint: 650_000_000,
    minRamGB: 10,
    qualityRank: 39,
    languages: ['en'],
    performance: {
      machine: 'mainstream',
      speed: 'fast',
      quality: 'best-en'
    }
  },
  {
    id: 'parakeet-v3',
    family: 'parakeet',
    modelId: 'nemo-parakeet-tdt-0.6b-v3-int8',
    archiveName: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
    bytesHint: 650_000_000,
    minRamGB: 10,
    qualityRank: 41,
    languages: ['en', 'multi'],
    performance: {
      machine: 'mainstream',
      speed: 'fast',
      quality: 'best-en'
    }
  },
  {
    id: 'orukeet',
    family: 'parakeet',
    modelId: 'orukeet-r3-int8',
    archiveName: ORUKEET_DIR,
    bytesHint: 671_504_259,
    minRamGB: 10,
    qualityRank: 41,
    languages: ['en', 'multi'],
    performance: {
      machine: 'mainstream',
      speed: 'fast',
      quality: 'good'
    }
  },
  {
    id: 'quality',
    family: 'qwen3',
    modelId: 'qwen3-asr-0.6b-int8',
    archiveName: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
    bytesHint: 840_000_000,
    minRamGB: 16,
    qualityRank: 50,
    languages: ['zh'],
    performance: {
      machine: 'high-end',
      speed: 'slow',
      quality: 'best-zh'
    }
  }
]

export const ASR_FAMILY_ORDER: readonly AsrFamily[] = [
  'whisper',
  'parakeet',
  'sense-voice',
  'qwen3'
]

/**
 * Return true when the value is a known ASR model id.
 */
export const isAsrTierId = (value: unknown): value is AsrTierId =>
  typeof value === 'string' && (ASR_TIER_IDS as readonly string[]).includes(value)

/**
 * Look up catalog metadata for an ASR model id.
 */
export const asrTierInfo = (id: AsrTierId): AsrTierInfo => {
  const found = ASR_TIERS.find((tier) => tier.id === id)
  if (!found) {
    throw new Error(`unknown asr tier: ${id}`)
  }
  return found
}

/** Retired model ids still stored on older settings / tasks. */
const LEGACY_ASR_TIERS: Record<string, AsrTierId> = {
  'paraformer-zh': 'sense-voice'
}

/**
 * Coerce an unknown setting/task value to a valid ASR model id.
 */
export const parseAsrTier = (value: unknown, fallback: AsrTierId = DEFAULT_ASR_TIER): AsrTierId => {
  if (typeof value === 'string' && value in LEGACY_ASR_TIERS) {
    return LEGACY_ASR_TIERS[value] ?? fallback
  }
  return isAsrTierId(value) ? value : fallback
}

/**
 * Models ranked above the current one, lowest rank first.
 */
export const higherAsrTiers = (id: AsrTierId): AsrTierInfo[] => {
  const rank = asrTierInfo(id).qualityRank
  return ASR_TIERS.filter((tier) => tier.qualityRank > rank).sort(
    (left, right) => left.qualityRank - right.qualityRank
  )
}

/**
 * Next upgrade options for the quality-hint dialog.
 */
export const upgradeAsrTiers = (
  id: AsrTierId,
  recommended: readonly AsrTierId[] = []
): AsrTierInfo[] => {
  const higher = higherAsrTiers(id)
  const preferred = higher.filter((tier) => recommended.includes(tier.id))
  const pool = preferred.length > 0 ? preferred : higher
  return pool.slice(0, 3)
}
