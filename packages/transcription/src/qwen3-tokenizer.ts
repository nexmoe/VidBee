import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DirectoryMemberRequirement } from './types'

/** Prefix for a model tree that must not be treated as installed. */
export const INCOMPLETE_MODEL_ERROR = 'incomplete model'

/**
 * Action the reporter confirmed unblocks Qwen3-ASR when the on-disk tokenizer
 * cannot be repaired automatically.
 */
export const QWEN3_TOKENIZER_REPAIR_HINT =
  'Replace the Qwen3-ASR tokenizer from the official package, or switch to Whisper Tiny.'

/**
 * Tokenizer files shipped in sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.
 * Sizes and digests are from that revision, not a later package.
 */
export const QWEN3_ASR_TOKENIZER_FILES: readonly DirectoryMemberRequirement[] = [
  {
    name: 'vocab.json',
    minBytes: 2_776_833,
    sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
    json: true
  },
  {
    name: 'merges.txt',
    minBytes: 1_671_853,
    sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5'
  },
  {
    name: 'tokenizer_config.json',
    minBytes: 12_487,
    sha256: '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c',
    json: true
  }
]

export interface DirectoryAssessment {
  present: boolean
  bytes: number
  /** Set when the directory exists but does not match the pinned members. */
  issue: string | null
}

const assessmentCache = new Map<string, { key: string; result: DirectoryAssessment }>()

const incomplete = (detail: string, withHint: boolean): string => {
  const message = `${INCOMPLETE_MODEL_ERROR}: ${detail}`
  return withHint ? `${message}. ${QWEN3_TOKENIZER_REPAIR_HINT}` : message
}

/**
 * Decide whether a directory matches pinned member files.
 * A missing directory is not installed. A directory that exists with truncated
 * JSON, short files, or a bad checksum is an incomplete model.
 *
 * @param dir Absolute directory path.
 * @param members Version-pinned files that must all pass.
 * @param withRepairHint Append the Qwen3 tokenizer workaround to the error.
 */
export const assessDirectoryMembers = (
  dir: string,
  members: readonly DirectoryMemberRequirement[],
  withRepairHint = false
): DirectoryAssessment => {
  let dirStats: ReturnType<typeof statSync> | null = null
  try {
    dirStats = existsSync(dir) ? statSync(dir) : null
  } catch {
    dirStats = null
  }
  if (!dirStats) {
    return { present: false, bytes: 0, issue: null }
  }
  const folder = basename(dir)
  if (!dirStats.isDirectory()) {
    return {
      present: false,
      bytes: 0,
      issue: incomplete(`${folder} is not a directory`, withRepairHint)
    }
  }

  const cacheKey = members
    .map((member) => {
      const path = join(dir, member.name)
      try {
        if (!existsSync(path)) {
          return `${member.name}:missing`
        }
        const stats = statSync(path)
        return `${member.name}:${stats.size}:${stats.mtimeMs}:${member.minBytes}:${member.sha256}`
      } catch {
        return `${member.name}:unreadable`
      }
    })
    .join('|')
  const cached = assessmentCache.get(dir)
  if (cached?.key === cacheKey) {
    return cached.result
  }

  const fail = (detail: string): DirectoryAssessment => {
    const result = { present: false, bytes: 0, issue: incomplete(detail, withRepairHint) }
    assessmentCache.set(dir, { key: cacheKey, result })
    return result
  }

  let bytes = 0
  const present: { member: DirectoryMemberRequirement; path: string; label: string }[] = []
  for (const member of members) {
    const path = join(dir, member.name)
    const label = `${folder}/${member.name}`
    let stats: ReturnType<typeof statSync> | null = null
    try {
      stats = existsSync(path) ? statSync(path) : null
    } catch {
      stats = null
    }
    if (!stats?.isFile() || stats.size <= 0) {
      return fail(`missing ${label}`)
    }
    present.push({ member, path, label })
  }
  for (const { member, path, label } of present) {
    const body = readFileSync(path)
    const stats = statSync(path)
    if (member.json) {
      try {
        const parsed = JSON.parse(body.toString('utf8')) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return fail(`${label} is truncated JSON`)
        }
      } catch {
        return fail(`${label} is truncated JSON`)
      }
    }
    if (stats.size < member.minBytes) {
      return fail(`${label} is truncated`)
    }
    const digest = createHash('sha256').update(body).digest('hex')
    if (digest !== member.sha256) {
      return fail(`${label} checksum mismatch`)
    }
    bytes += stats.size
  }

  const result = { present: true, bytes, issue: null }
  assessmentCache.set(dir, { key: cacheKey, result })
  return result
}
