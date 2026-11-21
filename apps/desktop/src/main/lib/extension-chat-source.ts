import { createHash } from 'node:crypto'
import { isDownloadTaskKind, type Task } from '@vidbee/task-queue'
import type { ExtensionChatSource } from '../../shared/extension-chat'
import { isExtensionSourceUrl } from '../../shared/extension-source-url'
import { videoIdentityFromUrl } from '../../shared/video-identity'
import { getDesktopTaskQueueRef } from './queue-ref'
import { broadcastTranscript, getTranscriptSnapshot, getTranscriptStore } from './transcript-host'

const imports = new Map<string, Promise<string>>()

/** Validate browser captions before importing any persistent Desktop data. */
export function isExtensionChatSource(value: unknown): value is ExtensionChatSource {
  if (!value || typeof value !== 'object') {
    return false
  }
  const input = value as ExtensionChatSource
  return (
    isExtensionSourceUrl(input.sourceUrl) &&
    typeof input.title === 'string' &&
    input.title.length <= 2000 &&
    Number.isFinite(input.duration) &&
    input.duration >= 0 &&
    input.duration <= 31_536_000 &&
    typeof input.auto === 'boolean' &&
    (input.language === undefined ||
      (typeof input.language === 'string' && input.language.length <= 64)) &&
    Array.isArray(input.segments) &&
    input.segments.length > 0 &&
    input.segments.length <= 100_000 &&
    input.segments.every(
      (segment) =>
        segment &&
        Number.isFinite(segment.start) &&
        segment.start >= 0 &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start &&
        typeof segment.text === 'string' &&
        segment.text.length <= 20_000
    ) &&
    input.segments.some((segment) => segment.text.trim()) &&
    input.segments.reduce((size, segment) => size + segment.text.length, 0) <= 1_000_000
  )
}

/** Match the same video before creating a source-only library entry; never schedule a media download. */
async function importSource(input: ExtensionChatSource, identity: string): Promise<string> {
  const queue = getDesktopTaskQueueRef()
  const matches: Task[] = []
  let cursor: string | null = null
  do {
    const page = queue.list({ limit: 200, cursor })
    matches.push(
      ...page.tasks.filter(
        (task) =>
          isDownloadTaskKind(task.kind) &&
          (videoIdentityFromUrl(task.input.url) ?? task.input.url) === identity
      )
    )
    cursor = page.nextCursor
  } while (cursor)
  // Keep an existing library identity stable, including conversations first created by the browser.
  matches.sort((left, right) => left.createdAt - right.createdAt)
  let downloadId = matches[0]?.id
  if (!downloadId) {
    const id = `extension-${createHash('sha256').update(identity).digest('hex')}`
    downloadId = (
      await queue.importCompleted({
        id,
        input: {
          kind: 'video',
          url: input.sourceUrl,
          title: input.title,
          options: { type: 'video', source: 'browser-extension', duration: input.duration }
        },
        output: { filePath: '', size: 0, durationMs: input.duration * 1000, sha256: null }
      })
    ).id
  }
  const store = getTranscriptStore()
  // Browser refreshes must never replace Desktop's edited captions or selected ASR source.
  if (!store.hasCurrent(downloadId)) {
    store.commit({
      downloadTaskId: downloadId,
      transcriptionTaskId: `extension-captions:${downloadId}`,
      sourceFilePath: null,
      result: {
        resultKind: 'transcript',
        modelVersion: 'browser-captions',
        asrTier: null,
        sourceKind: 'captions',
        language: input.language ?? null,
        speakers: [],
        segments: input.segments.map((segment) => ({
          startMs: segment.start * 1000,
          endMs: segment.end * 1000,
          text: segment.text,
          speakerKey: null,
          confidence: null
        }))
      }
    })
    broadcastTranscript(getTranscriptSnapshot(downloadId))
  }
  return downloadId
}

/** Serialize imports of the same video so multiple side panels share one durable source. */
export async function resolveExtensionChatSource(input: ExtensionChatSource): Promise<string> {
  const identity = videoIdentityFromUrl(input.sourceUrl) ?? input.sourceUrl
  const pending = imports.get(identity)
  if (pending) {
    return await pending
  }
  const task = importSource(input, identity)
  imports.set(identity, task)
  try {
    return await task
  } finally {
    if (imports.get(identity) === task) {
      imports.delete(identity)
    }
  }
}
