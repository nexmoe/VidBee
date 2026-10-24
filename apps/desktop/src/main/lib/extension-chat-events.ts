import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentRunEvent, AgentThread } from '../../shared/agent-chat'
import type {
  ExtensionChatEvent,
  ExtensionChatState,
  ExtensionChatVideo
} from '../../shared/extension-chat'
import { subscribeAgentEvents } from './agent-events'
import { aiStore } from './ai-store'
import { peekDesktopTaskQueueRef } from './queue-ref'

/** Send only public video context to the extension's history navigator. */
export function extensionChatVideo(downloadId: string): ExtensionChatVideo | undefined {
  const task = peekDesktopTaskQueueRef()?.get(downloadId)
  if (!task) {
    return undefined
  }
  return {
    downloadId,
    url: task.input.url,
    title: task.input.title ?? '',
    duration: (task.output?.durationMs ?? 0) / 1000
  }
}

/** Remove local attachment paths before any snapshot leaves Desktop. */
export function browserChatThread(thread: AgentThread): AgentThread {
  return {
    ...thread,
    artifacts: thread.artifacts.map((artifact) => ({
      ...artifact,
      path: '',
      posterPath: undefined
    })),
    images: thread.images?.map((image) => ({ ...image, path: '' }))
  }
}

/** Keep browser patches identical to IPC patches while concealing local media paths. */
function browserEvent(event: AgentRunEvent): AgentRunEvent {
  return {
    ...event,
    snapshot: event.snapshot ? browserChatThread(event.snapshot) : undefined,
    patch: event.patch
      ? {
          ...event.patch,
          artifacts: event.patch.artifacts?.map((artifact) => ({
            ...artifact,
            path: '',
            posterPath: undefined
          })),
          images: event.patch.images?.map((image) => ({ ...image, path: '' }))
        }
      : undefined
  }
}

/** Push committed Agent events and settings revisions; reconnect always starts from a fresh snapshot. */
export function streamExtensionChatEvents(
  _req: IncomingMessage,
  res: ServerResponse,
  current: () => ExtensionChatState,
  threadId: () => string | undefined,
  touch: () => void
): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  let closed = false
  /** Bound queued bytes while allowing a large frame to drain through Node backpressure. */
  const send = (event: ExtensionChatEvent): void => {
    if (closed || res.destroyed) {
      return
    }
    const frame = `data: ${JSON.stringify(event)}\n\n`
    if (res.writableLength + Buffer.byteLength(frame) > 32_000_000) {
      res.destroy()
      return
    }
    res.write(frame)
  }
  const offAgent = subscribeAgentEvents((event) => {
    if (event.catalog || event.threadId === threadId()) {
      const downloadId =
        event.catalog?.kind === 'upsert' ? event.catalog.summary.downloadId : undefined
      send({
        type: 'agent',
        event: browserEvent(event),
        source: downloadId ? extensionChatVideo(downloadId) : undefined
      })
      if (event.type === 'thread.deleted') {
        send({ type: 'snapshot', state: current() })
      }
    }
  })
  const offSettings = aiStore.subscribe(() => {
    send({ type: 'snapshot', state: current() })
    send({ type: 'settings' })
  })
  const heartbeat = setInterval(() => {
    touch()
    if (!(closed || res.destroyed)) {
      res.write(': heartbeat\n\n')
    }
  }, 15_000)
  /** Release only this connection's subscriptions when its panel closes or token is revoked. */
  const close = (): void => {
    if (closed) {
      return
    }
    closed = true
    clearInterval(heartbeat)
    offAgent()
    offSettings()
    res.end()
  }
  res.once('error', close)
  res.once('close', close)
  send({ type: 'snapshot', state: current() })
  return close
}
