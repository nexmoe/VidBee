import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fetchFirstOk, githubDownloadUrls } from '@vidbee/transcription/download-mirrors'
import { app } from 'electron'
import { z } from 'zod'
import {
  getTtsModel,
  type TtsModelDefinition,
  ttsModelFamily,
  ttsModelIdSchema
} from '../../shared/tts-models'
import snapshot from './tts-catalog.json'

export interface SpeechAsset {
  name: string
  size: number
  sha256?: string
  release: string
}

const releaseSchema = z.object({
  assets: z
    .array(
      z.object({
        name: z.string().max(240),
        size: z.number().int().positive(),
        digest: z.string().nullable().optional()
      })
    )
    .max(3000)
})
const MAX_METADATA_BYTES = 8_000_000
const CACHE_MS = 6 * 60 * 60 * 1000
const cache = new Map<string, { fetchedAt: number; assets: SpeechAsset[] }>()

/** Resolve all speech caches inside the current profile, including isolated test profiles. */
export function speechModelsDirectory(): string {
  return (
    process.env.VIDBEE_LOCALIZATION_MODELS_DIR ??
    path.join(app.getPath('userData'), 'models', 'localization')
  )
}

/** Read bounded native metadata so speaker IDs are checked against the actual installed weights. */
export function installedSpeechInfo(
  modelId: string
): { voiceCount: number; sampleRate: number } | null {
  try {
    const file = path.join(speechModelsDirectory(), modelId, 'speech-info.json')
    if (lstatSync(file).size > 8192 || lstatSync(file).isSymbolicLink()) {
      return null
    }
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      voiceCount: number
      sampleRate: number
    }
    return Number.isInteger(data.voiceCount) && data.voiceCount >= 0 && data.sampleRate > 0
      ? data
      : null
  } catch {
    return null
  }
}

/** Read bounded official metadata; malformed assets cannot introduce paths or arbitrary URLs. */
function releaseAssets(raw: unknown, release: string): SpeechAsset[] {
  return releaseSchema
    .parse(raw)
    .assets.filter((asset) => /^[a-zA-Z0-9][a-zA-Z0-9._-]+$/.test(asset.name))
    .map((asset) => ({
      name: asset.name,
      size: asset.size,
      sha256: /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ? asset.digest?.slice(7) : undefined,
      release
    }))
}

/** Bound catalog response memory independently of an upstream Content-Length header. */
async function readRelease(response: Response): Promise<unknown> {
  if (!response.body) {
    throw new Error('Empty speech model catalog')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) {
        break
      }
      bytes += part.value.length
      if (bytes > MAX_METADATA_BYTES) {
        throw new Error('Speech model catalog exceeds its size limit')
      }
      chunks.push(part.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Refresh publisher assets on demand and preserve a bounded offline catalog between restarts. */
export async function speechReleaseAssets(
  release: string,
  signal: AbortSignal,
  refresh = false
): Promise<SpeechAsset[]> {
  signal.throwIfAborted()
  const file = path.join(speechModelsDirectory(), `${release}-catalog.json`)
  let saved = cache.get(file)
  if (!saved) {
    try {
      const text = await readFile(file, 'utf8')
      if (text.length <= MAX_METADATA_BYTES) {
        const raw = JSON.parse(text) as { fetchedAt?: number; data?: unknown }
        if (typeof raw.fetchedAt === 'number') {
          saved = { fetchedAt: raw.fetchedAt, assets: releaseAssets(raw.data, release) }
        }
      }
    } catch {
      /* Missing or stale metadata is replaced from the official release. */
    }
  }
  if (!refresh && saved && Date.now() - saved.fetchedAt < CACHE_MS) {
    return saved.assets
  }
  try {
    const url = `https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/${release}`
    const { response } = await fetchFirstOk(githubDownloadUrls(url), fetch, {
      signal,
      headers: { Accept: 'application/vnd.github+json' }
    })
    const data = await readRelease(response)
    const assets = releaseAssets(data, release)
    if (!assets.length) {
      throw new Error('The official speech model catalog is empty')
    }
    const fetchedAt = Date.now()
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          fetchedAt,
          data: {
            assets: assets.map((asset) => ({
              name: asset.name,
              size: asset.size,
              digest: asset.sha256 ? `sha256:${asset.sha256}` : null
            }))
          }
        })
      )
      await rename(temporary, file)
    } finally {
      await rm(temporary, { force: true })
    }
    cache.set(file, { fetchedAt, assets })
    return assets
  } catch (error) {
    signal.throwIfAborted()
    if (saved) {
      cache.set(file, { fetchedAt: Date.now(), assets: saved.assets })
      return saved.assets
    }
    const resources = snapshot.resources.filter((asset) => asset.release === release)
    if (release !== 'tts-models' && !resources.length) {
      throw error
    }
    const assets: SpeechAsset[] = [
      ...(release === 'tts-models'
        ? snapshot.models.map(([id, size, sha256]) => ({
            name: `${id}.tar.bz2`,
            size: Number(size),
            sha256: typeof sha256 === 'string' ? sha256 : undefined,
            release
          }))
        : []),
      ...resources.map((asset) => ({ ...asset, sha256: asset.sha256 ?? undefined }))
    ]
    cache.set(file, { fetchedAt: Date.now(), assets })
    return assets
  }
}

/** Convert a publisher archive into a selectable model without downloading its weights. */
export function speechModelDefinition(asset: SpeechAsset): TtsModelDefinition | null {
  if (!asset.name.endsWith('.tar.bz2')) {
    return null
  }
  const id = asset.name.slice(0, -8)
  if (!(ttsModelIdSchema.safeParse(id).success && ttsModelFamily(id))) {
    return null
  }
  const metadata = getTtsModel(id)
  return { ...metadata, downloadBytes: asset.size, sha256: asset.sha256 ?? metadata.sha256 }
}

/** Discover every official TTS model supported by the bundled native engine. */
export async function speechModelCatalog(
  signal: AbortSignal,
  refresh = false
): Promise<TtsModelDefinition[]> {
  return (await speechReleaseAssets('tts-models', signal, refresh)).flatMap((asset) => {
    const model = speechModelDefinition(asset)
    return model ? [model] : []
  })
}

/** Refuse invented IDs while allowing newly published models without changing application code. */
export async function requireSpeechModel(
  id: string,
  signal: AbortSignal
): Promise<TtsModelDefinition> {
  ttsModelIdSchema.parse(id)
  let model = (await speechModelCatalog(signal)).find((candidate) => candidate.id === id)
  if (!model) {
    model = (await speechModelCatalog(signal, true)).find((candidate) => candidate.id === id)
  }
  if (!model) {
    throw new Error(`TTS model is not in the official sherpa-onnx release: ${id}`)
  }
  const info = installedSpeechInfo(id)
  return info && info.voiceCount > 0 ? { ...model, voiceCount: info.voiceCount } : model
}
