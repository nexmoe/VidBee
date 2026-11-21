import type { AgentRunEvent } from '@shared/agent-chat'
import type { AiPromptRunSnapshot } from '@shared/ai-types'
import { useStore } from 'jotai'
import { useEffect } from 'react'
import { trackDesktopEvent } from '../lib/desktop-analytics'
import { createDesktopValueTracker } from '../lib/desktop-value-events'
import { ipcEvents } from '../lib/ipc'
import { downloadRecordsAtom } from '../store/downloads'
import type { TranscriptSnapshotView } from '../store/transcripts'

/** Observe live business outcomes once at the app root, independently of page rendering. */
export function useDesktopValueEvents(): void {
  const store = useStore()
  useEffect(() => {
    const tracker = createDesktopValueTracker(trackDesktopEvent)
    /** Resolve provenance from current product state without sending URLs, titles or subscription IDs. */
    const origin = (id: string): unknown => {
      const records = store.get(downloadRecordsAtom)
      const item = records.get(`active:${id}`) ?? records.get(`history:${id}`)
      return item?.origin ?? (item?.subscriptionId ? 'subscription' : undefined)
    }
    const subscriptions = [
      ipcEvents.on('download:started', (id: unknown) => {
        if (typeof id === 'string') {
          tracker.download(id, 'running', origin(id))
        }
      }),
      ipcEvents.on('download:completed', (id: unknown) => {
        if (typeof id === 'string') {
          tracker.download(id, 'completed', origin(id))
        }
      }),
      ipcEvents.on('download:error', (data: unknown) => {
        const id = (data as { id?: unknown } | null)?.id
        if (typeof id === 'string') {
          tracker.download(id, 'failed', origin(id))
        }
      }),
      ipcEvents.on('download:cancelled', (id: unknown) => {
        if (typeof id === 'string') {
          tracker.download(id, 'cancelled', origin(id))
        }
      }),
      ipcEvents.on('ai:agent-event', (data: unknown) => tracker.agent(data as AgentRunEvent)),
      ipcEvents.on('ai:prompt-run', (data: unknown) => tracker.prompt(data as AiPromptRunSnapshot)),
      ipcEvents.on('transcript:updated', (data: unknown) => {
        const snapshot = data as TranscriptSnapshotView | null
        if (typeof snapshot?.downloadTaskId === 'string') {
          tracker.transcript(snapshot)
        }
      })
    ]
    const names = [
      'download:started',
      'download:completed',
      'download:error',
      'download:cancelled',
      'ai:agent-event',
      'ai:prompt-run',
      'transcript:updated'
    ] as const
    return () => {
      for (const [index, name] of names.entries()) {
        ipcEvents.removeListener(name, subscriptions[index])
      }
    }
  }, [store])
}
