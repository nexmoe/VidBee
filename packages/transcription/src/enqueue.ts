import { existsSync, statSync } from 'node:fs'
import {
  PRIORITY_BACKGROUND,
  PRIORITY_USER,
  type Task,
  type TaskCreationMetadata,
  type TaskPriority,
  type TaskQueueAPI,
  TERMINAL_STATUSES,
  TRANSCRIPTION_GROUP_KEY
} from '@vidbee/task-queue'
import type { MemoryTranscriptStore } from './memory-store'
import { buildTranscriptionInput } from './options'
import type { SpeakerCount } from './speaker-count'
import type { TranscriptStore } from './transcript-store'
import type { TranscriptionTrigger } from './types'

const ACTIVE = new Set(['queued', 'running', 'processing', 'paused', 'retry-scheduled'])

export interface EnqueueTranscriptionInput {
  queue: TaskQueueAPI
  creation?: TaskCreationMetadata
  store: TranscriptStore | MemoryTranscriptStore
  downloadTaskId: string
  sourceFilePath: string
  title?: string
  trigger: TranscriptionTrigger
  priority?: TaskPriority
  asrTier?: string
  language?: string
  speakerCount?: SpeakerCount
  rediarize?: boolean
}

export interface EnqueueTranscriptionResult {
  id: string
  created: boolean
  reused: boolean
}

export function listTranscriptionChildren(queue: TaskQueueAPI, downloadTaskId: string): Task[] {
  const out: Task[] = []
  let cursor: string | null = null
  do {
    const page = queue.list({ parentId: downloadTaskId, limit: 200, cursor })
    for (const task of page.tasks) {
      if (task.kind === 'transcription') {
        out.push(task)
      }
    }
    cursor = page.nextCursor
  } while (cursor)
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function findActiveTranscription(
  queue: TaskQueueAPI,
  downloadTaskId: string
): Task | undefined {
  const children = listTranscriptionChildren(queue, downloadTaskId)
  return (
    children.find((task) => task.status === 'running' || task.status === 'processing') ??
    children.find((task) => ACTIVE.has(task.status))
  )
}

/** Enqueue or reuse local transcription without rewriting existing creation provenance. */
export async function enqueueTranscription(
  input: EnqueueTranscriptionInput
): Promise<EnqueueTranscriptionResult> {
  const sourceOk = existsSync(input.sourceFilePath) && statSync(input.sourceFilePath).size > 0
  if (!sourceOk) {
    throw new Error(`source file missing: ${input.sourceFilePath}`)
  }

  const force = input.trigger === 'force'
  const children = listTranscriptionChildren(input.queue, input.downloadTaskId)
  const active = children.find((task) => ACTIVE.has(task.status))
  if (active && !force) {
    return { id: active.id, created: false, reused: true }
  }
  if (active && force) {
    await input.queue.cancel(active.id, 'user')
  }

  const latest = listTranscriptionChildren(input.queue, input.downloadTaskId)[0]
  const latestRecord = input.store.getLatestForDownload(input.downloadTaskId)
  const latestNoSpeech =
    latestRecord?.resultKind === 'no-speech' ||
    latest?.output?.transcript?.resultKind === 'no-speech'

  if (latest && latest.status === 'failed' && !force) {
    await input.queue.retryManual(latest.id)
    return { id: latest.id, created: false, reused: true }
  }
  if (latest && latest.status === 'cancelled' && !force) {
    await input.queue.retryManual(latest.id)
    return { id: latest.id, created: false, reused: true }
  }
  if (latest && latest.status === 'completed' && !force && !latestNoSpeech) {
    return { id: latest.id, created: false, reused: true }
  }

  const added = await input.queue.add({
    input: buildTranscriptionInput({
      creation: input.creation,
      downloadTaskId: input.downloadTaskId,
      sourceFilePath: input.sourceFilePath,
      trigger: input.trigger,
      skipVad: force && !input.rediarize,
      title: input.title,
      asrTier: input.asrTier,
      language: input.language,
      speakerCount: input.speakerCount,
      rediarize: input.rediarize === true
    }),
    parentId: input.downloadTaskId,
    priority: input.priority ?? (input.trigger === 'auto' ? PRIORITY_BACKGROUND : PRIORITY_USER),
    groupKey: TRANSCRIPTION_GROUP_KEY,
    maxAttempts: 3
  })
  return { id: added.id, created: true, reused: false }
}

export const isTerminalTranscription = (task: Task): boolean => TERMINAL_STATUSES.has(task.status)
