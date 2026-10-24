import type {
  AgentCatalogNotice,
  AgentThread,
  AgentThreadPatch,
  AgentThreadSummary
} from '../../shared/agent-chat'
import {
  agentConversationTitle,
  agentThreadIsRunning,
  agentThreadLatestRun,
  agentThreadUpdatedAt
} from '../../shared/agent-history'
import {
  type AgentPersistScope,
  projectAgentPatch,
  projectAgentThread,
  selectedAgentRunView
} from '../../shared/agent-thread-patch'
import { agentActivity } from './agent-activity'
import { peekDesktopTaskQueueRef } from './queue-ref'

/** IPC carries a full public thread for admission, terminal, and thread-level edits. */
export const AGENT_SNAPSHOT_TYPES = new Set([
  'run.started',
  'run.completed',
  'run.aborted',
  'run.error',
  'run.interrupted',
  'thread.thinking-selected',
  'thread.renamed',
  'thread.grants-updated',
  'thread.branch-selected',
  'images.selected',
  'images.removed'
])

/**
 * SQL rewrites every entity only for admission, terminal, and rename.
 * Grants, retries, and streaming keep the caller's dirty scope.
 */
export const AGENT_WRITE_ALL_TYPES = new Set([
  'run.started',
  'run.completed',
  'run.aborted',
  'run.error',
  'run.interrupted',
  'thread.renamed'
])

/** Directory changes: title, membership, or the selected run's status. */
export const AGENT_CATALOG_TYPES = new Set([
  'run.started',
  'run.completed',
  'run.aborted',
  'run.error',
  'run.interrupted',
  'thread.renamed',
  'thread.branch-selected',
  'images.selected',
  'images.removed'
])

let catalogRevision = 0

/** Stamp snapshots so a late HTTP response cannot overwrite a newer catalog notice. */
export function getAgentCatalogRevision(): number {
  return catalogRevision
}

/**
 * Choose snapshot versus patch delivery without dropping an explicit dirty scope.
 *
 * @param type Persisted event type.
 * @param scope Rows the caller marked dirty. Omit it only to rewrite every row.
 */
export function agentSavePlan(
  type: string,
  scope?: AgentPersistScope
): { delivery: 'snapshot' | 'patch'; scope?: AgentPersistScope } {
  return {
    delivery: AGENT_SNAPSHOT_TYPES.has(type) ? 'snapshot' : 'patch',
    scope: AGENT_WRITE_ALL_TYPES.has(type) ? undefined : scope
  }
}

/**
 * Public snapshot. `agentActivity` runs once per run.
 *
 * @param thread Stored or live thread.
 */
export function publicAgentThread(thread: AgentThread): AgentThread {
  return projectAgentThread(thread, agentActivity)
}

/**
 * Public patch. `agentActivity` runs only for runs included in the scope.
 *
 * @param thread Stored thread at the committed seq.
 * @param scope Dirty entities for this commit.
 */
export function publicAgentPatch(thread: AgentThread, scope: AgentPersistScope): AgentThreadPatch {
  return projectAgentPatch(thread, scope, agentActivity)
}

/**
 * Summary row shared by history lists and catalog notices.
 *
 * @param thread Conversation to describe. Private fields are not copied.
 */
export function agentDirectorySummary(thread: AgentThread): AgentThreadSummary {
  const videoTitle = peekDesktopTaskQueueRef()?.get(thread.downloadId)?.input?.title?.trim() ?? ''
  const latest = agentThreadLatestRun(thread)
  return {
    id: thread.id,
    downloadId: thread.downloadId,
    promptId: thread.promptId,
    title: agentConversationTitle(thread, videoTitle),
    updatedAt: agentThreadUpdatedAt(thread),
    running: agentThreadIsRunning(thread),
    status: latest?.status ?? 'idle',
    model: latest?.model ?? ''
  }
}

/**
 * Directory upsert. Its revision is independent of the thread seq.
 *
 * @param thread Conversation whose title, membership, or selected status changed.
 */
export function agentCatalogUpsert(thread: AgentThread): AgentCatalogNotice {
  catalogRevision += 1
  const selected = selectedAgentRunView(thread)
  return {
    kind: 'upsert',
    summary: agentDirectorySummary(thread),
    history: thread.messages.length > 0 || Boolean(thread.images?.length),
    runStatus: selected.status,
    statusUpdatedAt: selected.updatedAt,
    revision: catalogRevision
  }
}

/**
 * Directory removal. This does not allocate a thread seq.
 *
 * @param id Conversation id.
 * @param downloadId Video that owned the conversation.
 */
export function agentCatalogRemove(id: string, downloadId: string): AgentCatalogNotice {
  catalogRevision += 1
  return { kind: 'remove', id, downloadId, revision: catalogRevision }
}
