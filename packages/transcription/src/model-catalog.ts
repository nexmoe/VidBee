import {
  type AsrTierId,
  FIRE_RED_ASR_ARCHIVE,
  FIRE_RED_ASR_DIR,
  FOURIER_DIR,
  ORUKEET_DIR,
  PARAKEET_V2_ARCHIVE,
  PARAKEET_V2_DIR,
  PARAKEET_V3_ARCHIVE,
  PARAKEET_V3_DIR,
  QWEN3_ASR_1_7B_DIR,
  QWEN3_ASR_ARCHIVE,
  QWEN3_ASR_DIR,
  SENSE_VOICE_2025_ARCHIVE,
  SENSE_VOICE_2025_DIR,
  SENSE_VOICE_ARCHIVE,
  SENSE_VOICE_DIR,
  WHISPER_BASE_ARCHIVE,
  WHISPER_BASE_DIR,
  WHISPER_MEDIUM_ARCHIVE,
  WHISPER_MEDIUM_DIR,
  WHISPER_SMALL_ARCHIVE,
  WHISPER_SMALL_DIR,
  WHISPER_TINY_ARCHIVE,
  WHISPER_TINY_DIR,
  WHISPER_TURBO_ARCHIVE,
  WHISPER_TURBO_DIR
} from './asr-tiers'
import { QWEN3_ASR_TOKENIZER_FILES } from './qwen3-tokenizer'
import {
  CAMPPLUS_FILE,
  CAMPPLUS_URL,
  ERES2NET_FILE,
  ERES2NET_URL,
  SPEAKER_EMBEDDING_CAMPPLUS_ID,
  SPEAKER_EMBEDDING_ERES2NET_ID,
  SPEAKER_EMBEDDING_TITANET_ID,
  TITANET_FILE,
  TITANET_URL
} from './speaker-embed'
import { DEFAULT_MODEL_VERSION, type ModelFileSpec, type ModelGroup } from './types'

const PYANNOTE_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
const PYANNOTE_DIR = 'sherpa-onnx-pyannote-segmentation-3-0'
const PUNCT_CT_ARCHIVE =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2'
const PUNCT_CT_DIR = 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8'
const ORUKEET_BASE_URL =
  'https://huggingface.co/oruk/orukeet/resolve/debfb0d5423d4b0446361e0ea024e6891e23a249/onnx/sherpa-v0.1.0-int8'
const ORUKEET_MANIFEST = `${ORUKEET_DIR}/manifest.json`
// Immutable publisher revision and independent checksums for the noncommercial desktop model.
const FOURIER_REVISION = '3fda023e157ce7986f137f76fcf326ed6e08fa73'
const FOURIER_REPO_BASE = `https://huggingface.co/oruk/oruk-fourier-2b/resolve/${FOURIER_REVISION}`
const FOURIER_BASE = `${FOURIER_REPO_BASE}/onnx/sherpa-int8`

/** Pinned 1.7B export linked by the official sherpa-onnx Qwen3-ASR documentation. */
const QWEN3_ASR_1_7B_BASE_URL =
  'https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/cb045ad80b8970c9d411d463e5b78991a566596c'

/**
 * Publisher-provided sherpa-onnx assets. Whisper packages use int8
 * encoder/decoder files; SenseVoice uses a single int8 model.
 * Qwen3 stays at its existing directory so already-downloaded files are reused.
 */
export const MODEL_CATALOG: readonly ModelFileSpec[] = [
  {
    id: 'silero-vad',
    role: 'vad',
    group: 'vad',
    fileName: 'silero_vad.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    required: true
  },
  {
    id: 'pyannote-segmentation',
    role: 'segmentation',
    group: 'speaker',
    fileName: `${PYANNOTE_DIR}/model.onnx`,
    url: PYANNOTE_ARCHIVE,
    required: true
  },
  {
    id: SPEAKER_EMBEDDING_CAMPPLUS_ID,
    role: 'embedding',
    group: 'speaker',
    fileName: CAMPPLUS_FILE,
    url: CAMPPLUS_URL,
    required: true
  },
  {
    id: SPEAKER_EMBEDDING_ERES2NET_ID,
    role: 'embedding',
    group: 'speaker',
    fileName: ERES2NET_FILE,
    url: ERES2NET_URL,
    required: false
  },
  {
    id: SPEAKER_EMBEDDING_TITANET_ID,
    role: 'embedding',
    group: 'speaker',
    fileName: TITANET_FILE,
    url: TITANET_URL,
    required: false
  },
  {
    id: 'whisper-tiny-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'minimal',
    fileName: `${WHISPER_TINY_DIR}/tiny-encoder.int8.onnx`,
    url: WHISPER_TINY_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-tiny-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'minimal',
    fileName: `${WHISPER_TINY_DIR}/tiny-decoder.int8.onnx`,
    url: WHISPER_TINY_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-tiny-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'minimal',
    fileName: `${WHISPER_TINY_DIR}/tiny-tokens.txt`,
    url: WHISPER_TINY_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-base-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'whisper-base',
    fileName: `${WHISPER_BASE_DIR}/base-encoder.int8.onnx`,
    url: WHISPER_BASE_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-base-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'whisper-base',
    fileName: `${WHISPER_BASE_DIR}/base-decoder.int8.onnx`,
    url: WHISPER_BASE_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-base-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'whisper-base',
    fileName: `${WHISPER_BASE_DIR}/base-tokens.txt`,
    url: WHISPER_BASE_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-small-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'balanced',
    fileName: `${WHISPER_SMALL_DIR}/small-encoder.int8.onnx`,
    url: WHISPER_SMALL_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-small-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'balanced',
    fileName: `${WHISPER_SMALL_DIR}/small-decoder.int8.onnx`,
    url: WHISPER_SMALL_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-small-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'balanced',
    fileName: `${WHISPER_SMALL_DIR}/small-tokens.txt`,
    url: WHISPER_SMALL_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-medium-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'whisper-medium',
    fileName: `${WHISPER_MEDIUM_DIR}/medium-encoder.int8.onnx`,
    url: WHISPER_MEDIUM_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-medium-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'whisper-medium',
    fileName: `${WHISPER_MEDIUM_DIR}/medium-decoder.int8.onnx`,
    url: WHISPER_MEDIUM_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-medium-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'whisper-medium',
    fileName: `${WHISPER_MEDIUM_DIR}/medium-tokens.txt`,
    url: WHISPER_MEDIUM_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-turbo-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'whisper-turbo',
    fileName: `${WHISPER_TURBO_DIR}/turbo-encoder.int8.onnx`,
    url: WHISPER_TURBO_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-turbo-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'whisper-turbo',
    fileName: `${WHISPER_TURBO_DIR}/turbo-decoder.int8.onnx`,
    url: WHISPER_TURBO_ARCHIVE,
    required: true
  },
  {
    id: 'whisper-turbo-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'whisper-turbo',
    fileName: `${WHISPER_TURBO_DIR}/turbo-tokens.txt`,
    url: WHISPER_TURBO_ARCHIVE,
    required: true
  },
  {
    id: 'sense-voice-model',
    role: 'asr-model',
    group: 'asr',
    tier: 'sense-voice',
    fileName: `${SENSE_VOICE_DIR}/model.int8.onnx`,
    url: SENSE_VOICE_ARCHIVE,
    required: true
  },
  {
    id: 'sense-voice-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'sense-voice',
    fileName: `${SENSE_VOICE_DIR}/tokens.txt`,
    url: SENSE_VOICE_ARCHIVE,
    required: true
  },
  {
    id: 'sense-voice-2025-model',
    role: 'asr-model',
    group: 'asr',
    tier: 'sense-voice-2025',
    fileName: `${SENSE_VOICE_2025_DIR}/model.int8.onnx`,
    url: SENSE_VOICE_2025_ARCHIVE,
    required: true
  },
  {
    id: 'sense-voice-2025-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'sense-voice-2025',
    fileName: `${SENSE_VOICE_2025_DIR}/tokens.txt`,
    url: SENSE_VOICE_2025_ARCHIVE,
    required: true
  },
  {
    id: 'fire-red-asr-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'fire-red-asr',
    fileName: `${FIRE_RED_ASR_DIR}/encoder.int8.onnx`,
    url: FIRE_RED_ASR_ARCHIVE,
    required: true
  },
  {
    id: 'fire-red-asr-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'fire-red-asr',
    fileName: `${FIRE_RED_ASR_DIR}/decoder.int8.onnx`,
    url: FIRE_RED_ASR_ARCHIVE,
    required: true
  },
  {
    id: 'fire-red-asr-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'fire-red-asr',
    fileName: `${FIRE_RED_ASR_DIR}/tokens.txt`,
    url: FIRE_RED_ASR_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v2-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'parakeet-v2',
    fileName: `${PARAKEET_V2_DIR}/encoder.int8.onnx`,
    url: PARAKEET_V2_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v2-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'parakeet-v2',
    fileName: `${PARAKEET_V2_DIR}/decoder.int8.onnx`,
    url: PARAKEET_V2_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v2-joiner',
    role: 'asr-joiner',
    group: 'asr',
    tier: 'parakeet-v2',
    fileName: `${PARAKEET_V2_DIR}/joiner.int8.onnx`,
    url: PARAKEET_V2_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v2-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'parakeet-v2',
    fileName: `${PARAKEET_V2_DIR}/tokens.txt`,
    url: PARAKEET_V2_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v3-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'parakeet-v3',
    fileName: `${PARAKEET_V3_DIR}/encoder.int8.onnx`,
    url: PARAKEET_V3_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v3-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'parakeet-v3',
    fileName: `${PARAKEET_V3_DIR}/decoder.int8.onnx`,
    url: PARAKEET_V3_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v3-joiner',
    role: 'asr-joiner',
    group: 'asr',
    tier: 'parakeet-v3',
    fileName: `${PARAKEET_V3_DIR}/joiner.int8.onnx`,
    url: PARAKEET_V3_ARCHIVE,
    required: true
  },
  {
    id: 'parakeet-v3-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'parakeet-v3',
    fileName: `${PARAKEET_V3_DIR}/tokens.txt`,
    url: PARAKEET_V3_ARCHIVE,
    required: true
  },
  {
    id: 'orukeet-manifest',
    role: 'asr-extra',
    group: 'asr',
    tier: 'orukeet',
    fileName: ORUKEET_MANIFEST,
    url: `${ORUKEET_BASE_URL}/manifest.json`,
    sha256: '7e80f93f0e9b923c392424b0f85d28a717feee0a4d2a6aa9bfa723693868e727',
    required: true
  },
  {
    id: 'orukeet-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'orukeet',
    fileName: `${ORUKEET_DIR}/encoder.int8.onnx`,
    url: `${ORUKEET_BASE_URL}/encoder.int8.onnx`,
    checksumManifest: ORUKEET_MANIFEST,
    required: true
  },
  {
    id: 'orukeet-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'orukeet',
    fileName: `${ORUKEET_DIR}/decoder.int8.onnx`,
    url: `${ORUKEET_BASE_URL}/decoder.int8.onnx`,
    checksumManifest: ORUKEET_MANIFEST,
    required: true
  },
  {
    id: 'orukeet-joiner',
    role: 'asr-joiner',
    group: 'asr',
    tier: 'orukeet',
    fileName: `${ORUKEET_DIR}/joiner.int8.onnx`,
    url: `${ORUKEET_BASE_URL}/joiner.int8.onnx`,
    checksumManifest: ORUKEET_MANIFEST,
    required: true
  },
  {
    id: 'orukeet-tokens',
    role: 'asr-tokens',
    group: 'asr',
    tier: 'orukeet',
    fileName: `${ORUKEET_DIR}/tokens.txt`,
    url: `${ORUKEET_BASE_URL}/tokens.txt`,
    checksumManifest: ORUKEET_MANIFEST,
    required: true
  },
  {
    id: 'orukeet-license',
    role: 'asr-extra',
    group: 'asr',
    tier: 'orukeet',
    fileName: `${ORUKEET_DIR}/LICENSE-WEIGHTS`,
    url: `${ORUKEET_BASE_URL}/LICENSE-WEIGHTS`,
    checksumManifest: ORUKEET_MANIFEST,
    required: true
  },
  {
    id: 'orukeet-notice',
    role: 'asr-extra',
    group: 'asr',
    tier: 'orukeet',
    fileName: `${ORUKEET_DIR}/NOTICE.md`,
    url: `${ORUKEET_BASE_URL}/NOTICE.md`,
    checksumManifest: ORUKEET_MANIFEST,
    required: true
  },
  {
    id: 'qwen3-asr-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'quality',
    fileName: `${QWEN3_ASR_DIR}/encoder.int8.onnx`,
    url: QWEN3_ASR_ARCHIVE,
    required: true
  },
  {
    id: 'qwen3-asr-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'quality',
    fileName: `${QWEN3_ASR_DIR}/decoder.int8.onnx`,
    url: QWEN3_ASR_ARCHIVE,
    required: true
  },
  {
    id: 'qwen3-asr-frontend',
    role: 'asr-frontend',
    group: 'asr',
    tier: 'quality',
    fileName: `${QWEN3_ASR_DIR}/conv_frontend.onnx`,
    url: QWEN3_ASR_ARCHIVE,
    required: true
  },
  {
    id: 'qwen3-asr-tokenizer',
    role: 'asr-tokenizer',
    group: 'asr',
    tier: 'quality',
    fileName: `${QWEN3_ASR_DIR}/tokenizer`,
    url: QWEN3_ASR_ARCHIVE,
    directoryMembers: QWEN3_ASR_TOKENIZER_FILES,
    required: true
  },
  {
    id: 'qwen3-asr-1.7b-encoder',
    role: 'asr-encoder',
    group: 'asr',
    tier: 'qwen3-1.7b',
    fileName: `${QWEN3_ASR_1_7B_DIR}/encoder.int8.onnx`,
    url: `${QWEN3_ASR_1_7B_BASE_URL}/model_1.7B/encoder.int8.onnx`,
    sha256: '436fbd910a0c8914851e5ac1354e807be9f283d08a5da728adaa609731c41469',
    required: true
  },
  {
    id: 'qwen3-asr-1.7b-decoder',
    role: 'asr-decoder',
    group: 'asr',
    tier: 'qwen3-1.7b',
    fileName: `${QWEN3_ASR_1_7B_DIR}/decoder.int8.onnx`,
    url: `${QWEN3_ASR_1_7B_BASE_URL}/model_1.7B/decoder.int8.onnx`,
    sha256: 'c43c853fa6e97d08365cb8a5502b360b595cd43c00dc60e4d8ca7cc18cad460b',
    required: true
  },
  {
    id: 'qwen3-asr-1.7b-frontend',
    role: 'asr-frontend',
    group: 'asr',
    tier: 'qwen3-1.7b',
    fileName: `${QWEN3_ASR_1_7B_DIR}/conv_frontend.onnx`,
    url: `${QWEN3_ASR_1_7B_BASE_URL}/model_1.7B/conv_frontend.onnx`,
    sha256: 'fa894a4ba53da6a4238f2a6ca0b09362e505d39cecbd646051b033e2e8d7e2fb',
    required: true
  },
  {
    id: 'qwen3-asr-1.7b-tokenizer',
    role: 'asr-tokenizer',
    group: 'asr',
    tier: 'qwen3-1.7b',
    fileName: `${QWEN3_ASR_1_7B_DIR}/tokenizer`,
    url: `${QWEN3_ASR_1_7B_BASE_URL}/tokenizer`,
    directoryMembers: QWEN3_ASR_TOKENIZER_FILES,
    required: true
  },
  {
    id: 'fourier-en-conv-frontend-onnx',
    role: 'asr-frontend',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/conv_frontend.onnx`,
    url: `${FOURIER_BASE}/conv_frontend.onnx`,
    sha256: '19ddcb711237bba84f7aa385ce7c63320bcb736ce8888299064036d57a774bd9',
    required: true
  },
  {
    id: 'fourier-en-decoder-int8-onnx',
    role: 'asr-decoder',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/decoder.int8.onnx`,
    url: `${FOURIER_BASE}/decoder.int8.onnx`,
    sha256: 'd252adc96e55aa858876896e20783a357fda4c38e216d5be1c7b42bf73c86e8b',
    required: true
  },
  {
    id: 'fourier-en-decoder-int8-onnx-data',
    role: 'asr-extra',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/decoder.int8.onnx.data`,
    url: `${FOURIER_BASE}/decoder.int8.onnx.data`,
    sha256: '4625b41d68653f974af294b6ef5539c36e32d0477d0a2262a9157e275a09433f',
    required: true
  },
  {
    id: 'fourier-en-encoder-int8-onnx',
    role: 'asr-encoder',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/encoder.int8.onnx`,
    url: `${FOURIER_BASE}/encoder.int8.onnx`,
    sha256: '61255ca9e30a52c0d1da59ade9327792f08e32849cb1570da19be9ed6760cef9',
    required: true
  },
  {
    id: 'fourier-en-encoder-int8-onnx-data',
    role: 'asr-extra',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/encoder.int8.onnx.data`,
    url: `${FOURIER_BASE}/encoder.int8.onnx.data`,
    sha256: 'a11a260308504627190fbf662478eec9ff95cb36b3387f257892f6fb8886e8a1',
    required: true
  },
  {
    id: 'fourier-en-tokenizer',
    role: 'asr-tokenizer',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/tokenizer`,
    url: `${FOURIER_BASE}/tokenizer`,
    directoryMembers: [
      {
        name: 'config.json',
        minBytes: 2072,
        sha256: '9306077f32e1989f6128d12a0e471a3bd612389dbd5bff81305b8f558fee9901',
        json: true
      },
      {
        name: 'merges.txt',
        minBytes: 1_671_853,
        sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5'
      },
      {
        name: 'tokenizer.json',
        minBytes: 11_429_377,
        sha256: 'bd2a97b55c8f7f9c328c73ee9b9178771037e9f566dfca8e238a063d41cbac92',
        json: true
      },
      {
        name: 'tokenizer_config.json',
        minBytes: 10_386,
        sha256: 'e8f0641c46b7c259b8d4a34097471dab636bd5d5062f480ed7c97a3d3b3981ee',
        json: true
      },
      {
        name: 'vocab.json',
        minBytes: 3_080_118,
        sha256: '97dfe4fe392c23cda68fe01c60babe50a57c894fc0cf44d02c4048ad283499c3',
        json: true
      }
    ],
    required: true
  },
  {
    id: 'fourier-en-config-json',
    role: 'asr-extra',
    tier: 'fourier-en',
    group: 'asr',
    fileName: `${FOURIER_DIR}/config.json`,
    url: `${FOURIER_REPO_BASE}/config.json`,
    sha256: '5bc1d99c141fc866b61efca97dcbc6412a38db25ff0934c38bf7b46fa09485a2',
    required: true
  },
  {
    id: 'punct-ct-transformer-zh-en',
    role: 'punctuation',
    group: 'punct',
    fileName: `${PUNCT_CT_DIR}/model.int8.onnx`,
    url: PUNCT_CT_ARCHIVE,
    required: true
  }
]

export const QWEN3_ASR_MODEL_DIR = QWEN3_ASR_DIR
export const modelVersion = DEFAULT_MODEL_VERSION

/**
 * Filter the catalog by model group and optional ASR ids.
 */
export const catalogFor = (opts?: {
  groups?: readonly ModelGroup[]
  tiers?: readonly AsrTierId[]
}): readonly ModelFileSpec[] => {
  const groups = opts?.groups
  const tiers = opts?.tiers
  return MODEL_CATALOG.filter((spec) => {
    if (spec.required === false) {
      return false
    }
    // Punctuation is required so ensureReady can fetch it, but only when asked.
    if (spec.group === 'punct') {
      return Boolean(groups?.includes('punct'))
    }
    if (groups && groups.length > 0 && !groups.includes(spec.group)) {
      return false
    }
    if (!spec.tier) {
      return true
    }
    if (!tiers || tiers.length === 0) {
      return false
    }
    return tiers.includes(spec.tier)
  })
}

export const MINIMAL_MODEL_GROUPS: readonly ModelGroup[] = ['vad', 'speaker', 'asr']
export const MINIMAL_MODEL_TIERS: readonly AsrTierId[] = ['minimal']
