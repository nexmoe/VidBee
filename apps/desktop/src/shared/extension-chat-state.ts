import { applyAgentRunEvent } from './agent-thread-patch'
import type { ExtensionChatEvent, ExtensionChatState } from './extension-chat'

/** Apply the same ordered thread patches as Desktop without polling conversation snapshots. */
export function applyExtensionChatEvent(
  current: ExtensionChatState,
  incoming: ExtensionChatEvent
): { state: ExtensionChatState; gap: boolean } {
  if (incoming.type === 'snapshot') {
    return { state: incoming.state, gap: false }
  }
  if (incoming.type !== 'agent') {
    return { state: current, gap: false }
  }
  const { event } = incoming
  let next = current
  const notice = event.catalog
  if (notice && notice.revision > current.revision) {
    const id = notice.kind === 'remove' ? notice.id : notice.summary.id
    const threads = current.catalog.threads.filter((item) => item.id !== id)
    const history = current.catalog.history.filter((item) => item.id !== id)
    const statuses = { ...current.catalog.statuses }
    if (notice.kind === 'upsert') {
      if (notice.summary.downloadId === current.catalog.downloadId) {
        threads.push(notice.summary)
        statuses[notice.summary.promptId] = {
          status: notice.runStatus,
          updatedAt: notice.statusUpdatedAt
        }
      }
      if (notice.history) {
        history.push(notice.summary)
      }
    }
    next = {
      ...current,
      revision: notice.revision,
      catalog: {
        ...current.catalog,
        threads: threads.sort((a, b) => b.updatedAt - a.updatedAt),
        history: history.sort((a, b) => b.updatedAt - a.updatedAt),
        statuses,
        sources: incoming.source
          ? { ...current.catalog.sources, [incoming.source.downloadId]: incoming.source }
          : current.catalog.sources
      }
    }
  }
  if (event.type === 'thread.deleted' && event.threadId === next.thread?.id) {
    return { state: { ...next, thread: null }, gap: false }
  }
  const thread = next.thread
  if (!thread || event.threadId !== thread.id) {
    return { state: next, gap: false }
  }
  const result = applyAgentRunEvent(thread, event, {
    downloadId: thread.downloadId,
    promptId: thread.promptId,
    threadId: thread.id
  })
  return {
    state: result.kind === 'applied' ? { ...next, thread: result.thread } : next,
    gap: result.kind === 'gap'
  }
}
