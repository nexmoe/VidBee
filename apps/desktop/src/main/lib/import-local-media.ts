import { existsSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { isDownloadTaskKind, type Task, type TaskQueueAPI } from '@vidbee/task-queue'
import { type AsrTierId, enqueueTranscription, type TranscriptStore } from '@vidbee/transcription'
import type { DownloadHistoryItem } from '../../shared/types'
import { projectTaskForRendererHistory } from './projection'

export const LOCAL_AUDIO_EXTENSIONS = [
  'aac',
  'aiff',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'opus',
  'wav',
  'wma'
] as const

export const LOCAL_VIDEO_EXTENSIONS = [
  '3gp',
  'avi',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'webm',
  'wmv'
] as const

const AUDIO_EXTENSIONS = new Set<string>(LOCAL_AUDIO_EXTENSIONS)
const VIDEO_EXTENSIONS = new Set<string>(LOCAL_VIDEO_EXTENSIONS)

export interface MediaFileDialogFilter {
  extensions: string[]
  name: string
}

/**
 * Build native file-dialog filters for local audio and video.
 */
export const mediaFileDialogFilters = (): MediaFileDialogFilter[] => [
  {
    extensions: [...LOCAL_AUDIO_EXTENSIONS, ...LOCAL_VIDEO_EXTENSIONS],
    name: 'Audio and Video'
  },
  { extensions: [...LOCAL_AUDIO_EXTENSIONS], name: 'Audio' },
  { extensions: [...LOCAL_VIDEO_EXTENSIONS], name: 'Video' },
  { extensions: ['*'], name: 'All Files' }
]

export type LocalMediaRejectReason = 'missing' | 'not-media'

export interface ImportLocalMediaItem {
  path: string
  downloadId: string
  created: boolean
  reused: boolean
  historyItem: DownloadHistoryItem
}

export interface ImportLocalMediaRejected {
  path: string
  reason: LocalMediaRejectReason
}

export interface ImportLocalMediaResult {
  imported: ImportLocalMediaItem[]
  rejected: ImportLocalMediaRejected[]
}

export interface ImportLocalMediaInput {
  queue: TaskQueueAPI
  store: TranscriptStore
  paths: string[]
  language?: string
  asrTier?: AsrTierId
}

/**
 * Return the lowercase extension of a filesystem path.
 */
const extensionOf = (filePath: string): string => {
  const name = basename(filePath)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) {
    return ''
  }
  return name.slice(dot + 1).toLowerCase()
}

/**
 * Return audio/video kind for a local file, or null when unsupported.
 */
export const localMediaKind = (filePath: string): 'audio' | 'video' | null => {
  const ext = extensionOf(filePath)
  if (AUDIO_EXTENSIONS.has(ext)) {
    return 'audio'
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video'
  }
  return null
}

/**
 * Normalize a path for identity comparison across imports.
 */
const normalizePath = (filePath: string): string => {
  const resolved = resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Return whether a completed download already points at this file.
 */
const taskSourcePath = (task: Readonly<Task>): string | null => {
  if (task.output?.filePath) {
    return task.output.filePath
  }
  const url = task.input.url
  if (url.startsWith('file://')) {
    return url.slice('file://'.length)
  }
  return null
}

/**
 * Find an existing download task for the same local file.
 */
const findExistingDownload = (queue: TaskQueueAPI, filePath: string): Task | undefined => {
  const needle = normalizePath(filePath)
  let cursor: string | null = null
  do {
    const page = queue.list({ limit: 200, cursor })
    for (const task of page.tasks) {
      if (!isDownloadTaskKind(task.kind) || task.parentId) {
        continue
      }
      const source = taskSourcePath(task)
      if (source && normalizePath(source) === needle) {
        return task
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return undefined
}

/**
 * Import local audio/video files as completed downloads and enqueue transcription.
 */
export const importLocalMediaFiles = async (
  input: ImportLocalMediaInput
): Promise<ImportLocalMediaResult> => {
  const imported: ImportLocalMediaItem[] = []
  const rejected: ImportLocalMediaRejected[] = []
  const seen = new Set<string>()

  for (const rawPath of input.paths) {
    const filePath = resolve(rawPath)
    const key = normalizePath(filePath)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    const kind = localMediaKind(filePath)
    if (!kind) {
      rejected.push({ path: filePath, reason: 'not-media' })
      continue
    }
    if (!existsSync(filePath) || statSync(filePath).size <= 0) {
      rejected.push({ path: filePath, reason: 'missing' })
      continue
    }

    const size = statSync(filePath).size
    const title = basename(filePath)
    const existing = findExistingDownload(input.queue, filePath)
    let downloadId = existing?.id
    let created = false

    if (existing && existing.status === 'completed') {
      downloadId = existing.id
    } else {
      const added = await input.queue.importCompleted({
        input: {
          url: `file://${filePath}`,
          kind,
          title,
          options: {
            type: kind,
            origin: 'manual',
            downloadPath: dirname(filePath),
            savedFileName: title,
            source: 'local-import'
          }
        },
        output: {
          filePath,
          size,
          durationMs: null,
          sha256: null
        }
      })
      downloadId = added.id
      created = added.created
    }

    if (!downloadId) {
      rejected.push({ path: filePath, reason: 'missing' })
      continue
    }

    await enqueueTranscription({
      queue: input.queue,
      store: input.store,
      downloadTaskId: downloadId,
      sourceFilePath: filePath,
      title,
      trigger: 'manual',
      language: input.language,
      asrTier: input.asrTier
    })

    const task = input.queue.get(downloadId)
    const historyItem = task ? projectTaskForRendererHistory(task) : null
    if (!historyItem) {
      rejected.push({ path: filePath, reason: 'missing' })
      continue
    }

    imported.push({
      path: filePath,
      downloadId,
      created,
      reused: !created,
      historyItem
    })
  }

  return { imported, rejected }
}
