import type { AgentCatalogNotice, AgentRunStatus, AgentThreadSummary } from '@shared/agent-chat'
import type { AiSettingsSnapshot } from '@shared/ai-types'
import { atom } from 'jotai'

/** Latest Agent result on one conversation (skill, Overview, or chat) of a video. */
export interface AgentTaskActivity {
  threadId: string
  downloadId: string
  promptId: string
  /** Conversation title from the directory. */
  title: string
  status: AgentRunStatus
  /** Model id that produced the result; empty while a run is still resolving it. */
  model: string
  updatedAt: number
}

/** Keyed by thread id. */
export type AgentTaskMap = Record<string, AgentTaskActivity>

/**
 * Return a copy without one key, or the same map when it is absent.
 *
 * @param map Current activity map.
 * @param key Key to drop.
 */
function withoutKey(map: AgentTaskMap, key: string): AgentTaskMap {
  if (!(key in map)) {
    return map
  }
  const next = { ...map }
  delete next[key]
  return next
}

/**
 * Activity for one directory row, or null when the conversation never ran.
 *
 * @param row Directory row from main.
 */
function rowActivity(row: AgentThreadSummary): AgentTaskActivity | null {
  const status = row.running ? 'running' : row.status
  if (!status || status === 'idle') {
    return null
  }
  return {
    threadId: row.id,
    downloadId: row.downloadId,
    promptId: row.promptId,
    title: row.title,
    status,
    model: row.model ?? '',
    updatedAt: row.updatedAt
  }
}

/**
 * Apply a catalog notice. Main sends one on run start, every terminal state, rename and deletion.
 *
 * @param map Current activity map.
 * @param notice Directory notice from `ai:agent-event`.
 */
export function applyAgentCatalogActivity(
  map: AgentTaskMap,
  notice: AgentCatalogNotice
): AgentTaskMap {
  if (notice.kind === 'remove') {
    return withoutKey(map, notice.id)
  }
  const activity = rowActivity(notice.summary)
  if (!activity) {
    return withoutKey(map, notice.summary.id)
  }
  return { ...map, [activity.threadId]: activity }
}

/**
 * Replace the map with a fresh directory list. Threads changed by live events
 * while the list was in flight keep their newer state.
 *
 * @param map Current activity map.
 * @param rows Directory rows from `ai.listAgentHistory`.
 * @param touched Thread ids updated by events since the request started.
 */
export function mergeAgentHistoryActivity(
  map: AgentTaskMap,
  rows: readonly AgentThreadSummary[],
  touched: ReadonlySet<string>
): AgentTaskMap {
  const next: AgentTaskMap = {}
  for (const id of touched) {
    const activity = map[id]
    if (activity) {
      next[id] = activity
    }
  }
  for (const row of rows) {
    if (touched.has(row.id)) {
      continue
    }
    const activity = rowActivity(row)
    if (activity) {
      next[row.id] = activity
    }
  }
  return next
}

/**
 * Group results by video: running first, then newest.
 *
 * @param map Current activity map.
 */
export function groupAgentTasksByDownload(map: AgentTaskMap): Record<string, AgentTaskActivity[]> {
  const grouped: Record<string, AgentTaskActivity[]> = {}
  for (const activity of Object.values(map)) {
    const list = grouped[activity.downloadId] ?? []
    list.push(activity)
    grouped[activity.downloadId] = list
  }
  for (const list of Object.values(grouped)) {
    list.sort(
      (left, right) =>
        Number(right.status === 'running') - Number(left.status === 'running') ||
        right.updatedAt - left.updatedAt
    )
  }
  return grouped
}

export const agentTaskMapAtom = atom<AgentTaskMap>({})

export const agentTasksByDownloadAtom = atom((get) =>
  groupAgentTasksByDownload(get(agentTaskMapAtom))
)

/** Prompt titles and providers used to label results and resolve model icons. */
export const agentTaskAiSnapshotAtom = atom<AiSettingsSnapshot | null>(null)
