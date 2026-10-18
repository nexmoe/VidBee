import {
  type AgentActivity,
  type AgentArtifact,
  type AgentCatalogNotice,
  type AgentChatRun,
  type AgentImageAttachment,
  type AgentRunEvent,
  type AgentRunStatus,
  type AgentThread,
  type AgentThreadPatch,
  type AgentThreadSummary,
  selectedAgentMessages
} from './agent-chat'

/** Dirty rows a streaming commit may publish without rewriting the conversation. */
export interface AgentPersistScope {
  thread?: boolean
  messageIds?: string[]
  runIds?: string[]
  artifactIds?: string[]
}

/** Video, prompt, or pinned thread that a renderer is allowed to apply. */
export interface AgentRouteIdentity {
  downloadId: string
  promptId: string
  threadId?: string | null
}

/** Result of comparing one event with the authoritative thread. */
export type AgentEventApplyResult =
  | { kind: 'ignored' }
  | { kind: 'unchanged'; thread: AgentThread }
  | { kind: 'applied'; thread: AgentThread }
  | { kind: 'gap'; thread: AgentThread | null; observedSeq: number }

/**
 * In-flight gap repair for one identity.
 * One episode is a single RPC plus one follow-up. A newer seq may open another episode.
 */
export interface AgentGapRecovery {
  inflight: boolean
  observedSeq: number
  /** Highest seq already covered by a finished episode. Newer seqs may repair again. */
  coveredSeq: number
  followUpUsed: boolean
}

/** Remembered catalog notice so a late list cannot undo a newer rename or delete. */
export interface CatalogMemoryEntry {
  revision: number
  removed: boolean
  history: boolean
  downloadId: string
  summary?: AgentThreadSummary
}

/**
 * Start a gap-repair record with no request outstanding.
 */
export function createAgentGapRecovery(): AgentGapRecovery {
  return { inflight: false, observedSeq: 0, coveredSeq: 0, followUpUsed: false }
}

/**
 * Raise the highest seq seen for this identity.
 * @param recovery Current repair record.
 * @param seq Seq observed on an event or accepted snapshot.
 */
export function observeAgentSeq(recovery: AgentGapRecovery, seq: number): AgentGapRecovery {
  if (!Number.isFinite(seq) || seq <= recovery.observedSeq) {
    return recovery
  }
  return { ...recovery, observedSeq: seq }
}

/**
 * Open one recovery RPC.
 * Gap repairs wait until a seq newer than the last finished episode arrives.
 * Focus and the first load use `refresh` and are not held by that mark.
 * @param recovery Current repair record.
 * @param reason Why this repair was requested.
 */
export function requestAgentRecovery(
  recovery: AgentGapRecovery,
  reason: 'gap' | 'refresh' = 'gap'
): { recovery: AgentGapRecovery; action: 'start' | 'busy' | 'wait' } {
  if (recovery.inflight) {
    return { recovery, action: 'busy' }
  }
  if (reason === 'gap' && recovery.observedSeq <= recovery.coveredSeq) {
    return { recovery, action: 'wait' }
  }
  return { recovery: { ...recovery, inflight: true, followUpUsed: false }, action: 'start' }
}

/**
 * Finish one recovery RPC. A short snapshot may start one follow-up, never a loop.
 * After that follow-up is still behind, wait for a newer seq instead of retrying now.
 * @param recovery Record that owns the RPC just finished.
 * @param appliedSeq Seq now held for this identity, or 0 when none was accepted.
 */
export function settleAgentRecovery(
  recovery: AgentGapRecovery,
  appliedSeq: number
): { recovery: AgentGapRecovery; action: 'settled' | 'follow-up' | 'wait' } {
  const idle = { ...recovery, inflight: false }
  if (appliedSeq >= idle.observedSeq) {
    return {
      recovery: { ...idle, followUpUsed: false, coveredSeq: idle.observedSeq },
      action: 'settled'
    }
  }
  if (!idle.followUpUsed) {
    return {
      recovery: { ...idle, followUpUsed: true, inflight: true },
      action: 'follow-up'
    }
  }
  return {
    recovery: { ...idle, followUpUsed: false, coveredSeq: idle.observedSeq },
    action: 'wait'
  }
}

/**
 * Allow a focus repair to read again. Does not cancel an RPC already in flight.
 * @param recovery Current repair record.
 */
export function resetAgentRecovery(recovery: AgentGapRecovery): AgentGapRecovery {
  if (recovery.coveredSeq === 0 && !recovery.followUpUsed) {
    return recovery
  }
  return { ...recovery, followUpUsed: false, coveredSeq: 0 }
}

/**
 * Keep a public artifact without its local filesystem path.
 * @param artifact Stored artifact.
 */
export function projectAgentArtifact(artifact: AgentArtifact): AgentArtifact {
  return { ...artifact, path: '', posterPath: undefined }
}

/**
 * Keep a public image without its local filesystem path.
 * @param image Stored image attachment.
 */
export function projectAgentImage(image: AgentImageAttachment): AgentImageAttachment {
  return { ...image, path: '' }
}

/**
 * Copy one run for IPC, dropping provider-private fields.
 * @param run Stored run. Its private arrays are not reused.
 * @param activity Public activity already projected for this run only.
 */
export function projectAgentRun(run: AgentChatRun, activity: AgentActivity[]): AgentChatRun {
  return {
    ...run,
    activity,
    rawMessages: [],
    workingNotes: undefined,
    sessionEntries: undefined,
    evidenceCoverage: undefined,
    evidenceSource: undefined,
    fullSourceReview: undefined,
    articleSections: undefined,
    contextCheckpoint: undefined,
    contextSummary: undefined,
    tools: run.tools.map((tool) => ({
      ...tool,
      approval: tool.approval ? { ...tool.approval } : undefined
    }))
  }
}

/**
 * Copy a whole thread for a snapshot IPC payload.
 * @param thread Stored thread.
 * @param activityFor Called once per run. Pass `agentActivity` from main.
 */
export function projectAgentThread(
  thread: AgentThread,
  activityFor: (run: AgentChatRun) => AgentActivity[]
): AgentThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({ ...message })),
    runs: thread.runs.map((run) => projectAgentRun(run, activityFor(run))),
    artifacts: thread.artifacts.map(projectAgentArtifact),
    images: thread.images?.map(projectAgentImage)
  }
}

/**
 * Copy only the dirty entities. `activityFor` runs for dirty runs and no others.
 * @param thread Stored thread, including its committed seq.
 * @param scope Rows touched by this commit.
 * @param activityFor Public activity for one run.
 */
export function projectAgentPatch(
  thread: AgentThread,
  scope: AgentPersistScope,
  activityFor: (run: AgentChatRun) => AgentActivity[]
): AgentThreadPatch {
  const patch: AgentThreadPatch = {
    downloadId: thread.downloadId,
    promptId: thread.promptId,
    threadId: thread.id
  }
  if (scope.thread) {
    patch.leafId = thread.leafId
    if (thread.title !== undefined) {
      patch.title = thread.title
    }
    if (thread.toolGrants) {
      patch.toolGrants = [...thread.toolGrants]
    }
    if (thread.images) {
      patch.images = thread.images.map(projectAgentImage)
    }
  }
  if (scope.messageIds?.length) {
    const ids = new Set(scope.messageIds)
    patch.messages = thread.messages
      .filter((message) => ids.has(message.id))
      .map((message) => ({ ...message }))
  }
  if (scope.runIds?.length) {
    const ids = new Set(scope.runIds)
    const runs: AgentChatRun[] = []
    for (const run of thread.runs) {
      if (!ids.has(run.id)) {
        continue
      }
      runs.push(projectAgentRun(run, activityFor(run)))
    }
    patch.runs = runs
  }
  if (scope.artifactIds?.length) {
    const ids = new Set(scope.artifactIds)
    patch.artifacts = thread.artifacts
      .filter((artifact) => ids.has(artifact.id))
      .map(projectAgentArtifact)
  }
  return patch
}

/**
 * Event header safe to store. Snapshot, patch, and catalog payloads stay off the row.
 * @param event Event about to be broadcast.
 */
export function durableAgentEvent(
  event: AgentRunEvent
): Pick<AgentRunEvent, 'threadId' | 'runId' | 'messageId' | 'seq' | 'type' | 'createdAt'> {
  return {
    threadId: event.threadId,
    runId: event.runId,
    messageId: event.messageId,
    seq: event.seq,
    type: event.type,
    createdAt: event.createdAt
  }
}

/**
 * Route a snapshot or patch. Catalog-only notices have no thread route.
 * @param event Broadcast event.
 */
export function agentEventRoute(
  event: AgentRunEvent
): { downloadId: string; promptId: string; threadId: string } | null {
  if (event.patch) {
    return {
      downloadId: event.patch.downloadId,
      promptId: event.patch.promptId,
      threadId: event.patch.threadId
    }
  }
  if (event.snapshot) {
    return {
      downloadId: event.snapshot.downloadId,
      promptId: event.snapshot.promptId,
      threadId: event.snapshot.id
    }
  }
  return null
}

/**
 * True when the event belongs to the renderer's current video and prompt or thread.
 * @param event Broadcast event.
 * @param identity Tab identity. `threadId` pins one conversation.
 */
export function agentEventMatches(event: AgentRunEvent, identity: AgentRouteIdentity): boolean {
  const route = agentEventRoute(event)
  if (!route || route.downloadId !== identity.downloadId) {
    return false
  }
  if (identity.threadId) {
    return route.threadId === identity.threadId
  }
  return route.promptId === identity.promptId
}

/**
 * Replace entities by id. The array is copied when any row changes; other rows keep their identity.
 * @param current Current array. It is not mutated.
 * @param updates Replacement or new rows.
 */
function replaceById<T extends { id: string }>(
  current: readonly T[],
  updates: readonly T[] | undefined
): T[] {
  if (!updates?.length) {
    return current as T[]
  }
  const next = current.slice()
  for (const item of updates) {
    const index = next.findIndex((row) => row.id === item.id)
    if (index === -1) {
      next.push(item)
    } else {
      next[index] = item
    }
  }
  return next
}

/**
 * Apply one patch onto a thread without mutating either object.
 * @param current Authoritative thread.
 * @param patch Dirty public entities.
 * @param seq Committed seq of the patch event.
 */
export function applyAgentThreadPatch(
  current: AgentThread,
  patch: AgentThreadPatch,
  seq: number
): AgentThread {
  return {
    ...current,
    seq,
    leafId: patch.leafId === undefined ? current.leafId : patch.leafId,
    title: patch.title === undefined ? current.title : patch.title,
    toolGrants: patch.toolGrants === undefined ? current.toolGrants : [...patch.toolGrants],
    messages: replaceById(current.messages, patch.messages),
    runs: replaceById(current.runs, patch.runs),
    artifacts: replaceById(current.artifacts, patch.artifacts),
    images:
      patch.images === undefined ? current.images : patch.images.map((image) => ({ ...image }))
  }
}

/**
 * Accept a full thread only when its seq is newer. Equal seq keeps the local object.
 * @param current Authoritative thread, or null before hydration.
 * @param incoming Snapshot from IPC or an applied patch.
 */
export function acceptAgentThread(current: AgentThread | null, incoming: AgentThread): AgentThread {
  if (current && current.id === incoming.id && current.seq >= incoming.seq) {
    return current
  }
  return incoming
}

/**
 * Compare one event with the authoritative thread.
 * Snapshots may skip seqs. Patches apply only at `current.seq + 1`.
 * @param current Authoritative thread for this identity.
 * @param event Broadcast event.
 * @param identity Current video, prompt, and optional pinned thread.
 */
export function applyAgentRunEvent(
  current: AgentThread | null,
  event: AgentRunEvent,
  identity: AgentRouteIdentity
): AgentEventApplyResult {
  if (!agentEventMatches(event, identity)) {
    return { kind: 'ignored' }
  }
  if (event.snapshot) {
    if (current && current.id === event.snapshot.id && current.seq >= event.snapshot.seq) {
      return { kind: 'unchanged', thread: current }
    }
    return { kind: 'applied', thread: event.snapshot }
  }
  if (!event.patch) {
    return { kind: 'ignored' }
  }
  if (!current || current.id !== event.patch.threadId) {
    return { kind: 'gap', thread: current, observedSeq: event.seq }
  }
  if (event.seq <= current.seq) {
    return { kind: 'unchanged', thread: current }
  }
  if (event.seq !== current.seq + 1) {
    return { kind: 'gap', thread: current, observedSeq: event.seq }
  }
  return { kind: 'applied', thread: applyAgentThreadPatch(current, event.patch, event.seq) }
}

/**
 * Status of the selected branch. Branch changes this even when the title does not.
 * @param thread Public or stored thread.
 */
export function selectedAgentRunView(thread: AgentThread): {
  status: AgentRunStatus | 'idle'
  updatedAt: number
} {
  const latest = selectedAgentMessages(thread).at(-1)
  const run = latest ? thread.runs.find((item) => item.messageId === latest.id) : undefined
  return {
    status: run?.status ?? 'idle',
    updatedAt: run?.updatedAt ?? latest?.createdAt ?? 0
  }
}

/**
 * Record a catalog notice when its revision is newer. Thread seq is not consulted.
 * @param memory Notices already applied.
 * @param notice Directory notice from main.
 */
export function rememberCatalog(
  memory: ReadonlyMap<string, CatalogMemoryEntry>,
  notice: AgentCatalogNotice
): { memory: Map<string, CatalogMemoryEntry>; applied: boolean } {
  const id = notice.kind === 'remove' ? notice.id : notice.summary.id
  const downloadId = notice.kind === 'remove' ? notice.downloadId : notice.summary.downloadId
  const previous = memory.get(id)
  if (previous && notice.revision <= previous.revision) {
    return { memory: memory as Map<string, CatalogMemoryEntry>, applied: false }
  }
  const next = new Map(memory)
  if (notice.kind === 'remove') {
    next.set(id, { revision: notice.revision, removed: true, history: false, downloadId })
    return { memory: next, applied: true }
  }
  next.set(id, {
    revision: notice.revision,
    removed: false,
    history: notice.history,
    downloadId,
    summary: notice.summary
  })
  return { memory: next, applied: true }
}

/**
 * Overlay notices that arrived after a list request started.
 * @param rows Rows returned by a list RPC.
 * @param memory Notices applied locally.
 * @param requestedRevision Highest revision already applied when the RPC started.
 * @param options Limit to one video, or to history membership.
 */
export function mergeCatalogList(
  rows: readonly AgentThreadSummary[],
  memory: ReadonlyMap<string, CatalogMemoryEntry>,
  requestedRevision: number,
  options?: { downloadId?: string; historyOnly?: boolean }
): AgentThreadSummary[] {
  const next = new Map<string, AgentThreadSummary>()
  for (const row of rows) {
    if (options?.downloadId && row.downloadId !== options.downloadId) {
      continue
    }
    next.set(row.id, row)
  }
  for (const [id, state] of memory) {
    if (state.revision <= requestedRevision) {
      continue
    }
    if (options?.downloadId && state.downloadId !== options.downloadId) {
      continue
    }
    if (state.removed || (options?.historyOnly && !state.history)) {
      next.delete(id)
      continue
    }
    if (state.summary) {
      next.set(id, state.summary)
    }
  }
  return [...next.values()]
}
