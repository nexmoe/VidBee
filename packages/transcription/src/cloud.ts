/** Public speech identifiers and wire types are safe to import in renderer and Worker code. */
export const DEFAULT_CLOUD_TRANSCRIPTION_MODEL = 'qwen/qwen3-asr-1.7b'
export const MAX_CLOUD_AUDIO_BYTES = 9_601_024
export const MAX_CLOUD_AUDIO_SECONDS = 300

export type TranscriptionProvider = 'local' | 'cloud'

export interface CloudTranscriptionModel {
  id: string
  name: string
  creditsPerSecond: number
}

export interface CloudTranscriptionCatalog {
  defaultModelId: string
  models: CloudTranscriptionModel[]
  maxAudioBytes: number
  maxAudioSeconds: number
}

export interface CloudTranscriptionResult {
  requestId: string
  modelId: string
  text: string
  language: string | null
  audioSeconds: number
  credits: number
}

/** Keep old settings and tasks local unless Cloud was explicitly selected. */
export function parseTranscriptionProvider(value: unknown): TranscriptionProvider {
  return value === 'cloud' ? 'cloud' : 'local'
}
