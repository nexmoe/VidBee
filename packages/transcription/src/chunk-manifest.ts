import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson } from './atomic-file'
import type {
  PipelineSegment,
  PipelineSpeaker,
  TranscriptStageTiming,
  TranscriptWord
} from './types'

export interface ManifestTurn {
  startMs: number
  endMs: number
  speakerKey: string
}

export interface ManifestChunk {
  index: number
  startMs: number
  endMs: number
  speakerKey: string | null
  text: string
  words?: TranscriptWord[]
  confidence: number | null
}

export interface ChunkManifest {
  key: {
    taskId: string
    fingerprint: string
    modelVersion: string
  }
  durationMs: number | null
  speakers: PipelineSpeaker[]
  turns: ManifestTurn[]
  chunks: ManifestChunk[]
  stages: TranscriptStageTiming[]
}

export const sourceFingerprint = (filePath: string): string => {
  const stat = statSync(filePath)
  return `${stat.size}:${Math.round(stat.mtimeMs)}`
}

export const manifestWorkKey = (
  taskId: string,
  fingerprint: string,
  modelVersion: string
): string =>
  createHash('sha256')
    .update(`${taskId}\0${fingerprint}\0${modelVersion}`)
    .digest('hex')
    .slice(0, 24)

export const manifestPathFor = (workDir: string): string => join(workDir, 'chunks.json')

/**
 * Host-only stage clock, kept off `chunks.json` so the worker can append ASR
 * chunks without sharing a `.tmp` rename.
 *
 * @param workDir Pipeline work directory.
 */
export const stagesPathFor = (workDir: string): string => join(workDir, 'stages.json')

const emptyManifest = (
  taskId: string,
  fingerprint: string,
  modelVersion: string
): ChunkManifest => ({
  key: { taskId, fingerprint, modelVersion },
  durationMs: null,
  speakers: [],
  turns: [],
  chunks: [],
  stages: []
})

export const loadChunkManifest = (filePath: string): ChunkManifest | null => {
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as ChunkManifest
    if (!(parsed?.key?.taskId && parsed.key.fingerprint && parsed.key.modelVersion)) {
      return null
    }
    parsed.speakers ??= []
    parsed.turns ??= []
    parsed.chunks ??= []
    parsed.stages ??= []
    return parsed
  } catch {
    return null
  }
}

/**
 * Atomically persist the ASR chunk manifest.
 *
 * @param filePath Destination `chunks.json` path.
 * @param manifest Manifest to write.
 */
export const saveChunkManifest = (filePath: string, manifest: ChunkManifest): void => {
  atomicWriteJson(filePath, manifest)
}

/**
 * Merge fields into the on-disk manifest. In-memory snapshots must not rewrite
 * `chunks` — that used to wipe ASR after diarization saved turns.
 *
 * @param filePath Destination `chunks.json` path.
 * @param patch Speakers, turns, or duration to publish.
 */
export const patchChunkManifest = (
  filePath: string,
  patch: Partial<Pick<ChunkManifest, 'speakers' | 'turns' | 'durationMs'>>
): ChunkManifest => {
  const current = loadChunkManifest(filePath)
  if (!current) {
    throw new Error(`chunk manifest missing: ${filePath}`)
  }
  if (patch.speakers) {
    current.speakers = patch.speakers
  }
  if (patch.turns) {
    current.turns = patch.turns
  }
  if (typeof patch.durationMs === 'number') {
    current.durationMs = patch.durationMs
  }
  saveChunkManifest(filePath, current)
  return current
}

export const ensureChunkManifest = (input: {
  workDir: string
  taskId: string
  fingerprint: string
  modelVersion: string
}): { path: string; manifest: ChunkManifest } => {
  const path = manifestPathFor(input.workDir)
  const existing = loadChunkManifest(path)
  const matches =
    existing &&
    existing.key.taskId === input.taskId &&
    existing.key.fingerprint === input.fingerprint &&
    existing.key.modelVersion === input.modelVersion
  // modelVersion includes the diarization pipeline revision, so leftover
  // turns from an older clustering path are discarded here.
  const manifest = matches
    ? existing
    : emptyManifest(input.taskId, input.fingerprint, input.modelVersion)
  if (!matches) {
    saveChunkManifest(path, manifest)
  }
  return { path, manifest }
}

/**
 * Load thinking-step timings written by the host process.
 *
 * @param workDir Pipeline work directory.
 */
export const loadManifestStages = (workDir: string): TranscriptStageTiming[] | null => {
  const filePath = stagesPathFor(workDir)
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!Array.isArray(parsed)) {
      return null
    }
    return parsed.filter((item): item is TranscriptStageTiming => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const row = item as { stage?: unknown; startedAt?: unknown }
      return typeof row.stage === 'string' && typeof row.startedAt === 'number'
    })
  } catch {
    return null
  }
}

/**
 * Persist thinking-step timings next to ASR chunks so a restart can resume the clock.
 * Written to `stages.json` so the host never races the worker's `chunks.json`.
 *
 * @param workDir Pipeline work directory.
 * @param stages Stage history with start timestamps.
 */
export const saveManifestStages = (workDir: string, stages: TranscriptStageTiming[]): void => {
  atomicWriteJson(stagesPathFor(workDir), stages)
}

export const chunkKey = (startMs: number, endMs: number): string => `${startMs}:${endMs}`

export const completedChunkKeys = (manifest: ChunkManifest): Set<string> =>
  new Set(manifest.chunks.map((chunk) => chunkKey(chunk.startMs, chunk.endMs)))

export const appendManifestChunk = (
  filePath: string,
  chunk: ManifestChunk,
  extras?: Partial<Pick<ChunkManifest, 'speakers' | 'turns' | 'durationMs'>>
): ChunkManifest => {
  const current = loadChunkManifest(filePath)
  if (!current) {
    throw new Error(`chunk manifest missing: ${filePath}`)
  }
  if (extras?.speakers) {
    current.speakers = extras.speakers
  }
  if (extras?.turns) {
    current.turns = extras.turns
  }
  if (typeof extras?.durationMs === 'number') {
    current.durationMs = extras.durationMs
  }
  const key = chunkKey(chunk.startMs, chunk.endMs)
  if (!current.chunks.some((item) => chunkKey(item.startMs, item.endMs) === key)) {
    current.chunks.push(chunk)
  }
  saveChunkManifest(filePath, current)
  return current
}

export const resultFromManifest = (
  manifest: ChunkManifest
): { speakers: PipelineSpeaker[]; segments: PipelineSegment[] } => ({
  speakers: manifest.speakers,
  segments: [...manifest.chunks]
    .sort((a, b) => a.startMs - b.startMs)
    .map((chunk) => ({
      speakerKey: chunk.speakerKey,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      text: chunk.text,
      words: chunk.words,
      confidence: chunk.confidence
    }))
})
