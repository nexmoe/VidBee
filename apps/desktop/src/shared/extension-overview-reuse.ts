import { isDownloadTaskKind, type TaskKind } from '@vidbee/task-queue'
import { type AgentThread, selectedAgentMessages } from './agent-chat'
import { AI_OVERVIEW_PROMPT_ID } from './ai-prompts'
import type { AiPromptRunSnapshot, AiPromptRunStatus } from './ai-types'
import { videoIdentityFromUrl } from './video-identity'

/** Download-shaped row used to match an extension watch URL to Desktop history. */
export interface OverviewDownloadMatch {
  id: string
  kind: TaskKind
  input: { url: string }
  updatedAt: number
}

/** Attach an existing Desktop Overview, start on that download, or use an ephemeral job. */
export interface ExtensionOverviewTarget {
  downloadId: string
  reused: boolean
  snapshot: AiPromptRunSnapshot | null
}

/**
 * True when an existing Overview is worth showing instead of starting another run.
 *
 * @param snapshot Live agent or prompt-run result for one download.
 */
export function isReusableOverviewSnapshot(snapshot: AiPromptRunSnapshot): boolean {
  if (snapshot.status === 'running') {
    return true
  }
  if (snapshot.status === 'idle') {
    return false
  }
  return Boolean(snapshot.text.trim())
}

/**
 * Project the selected Overview agent reply onto the extension snapshot contract.
 *
 * @param thread Persisted Desktop agent thread for this video.
 */
export function snapshotFromOverviewThread(thread: AgentThread): AiPromptRunSnapshot | null {
  const assistant = [...selectedAgentMessages(thread)]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (!assistant) {
    return null
  }
  const run = thread.runs.find((item) => item.id === assistant.runId)
  const status = overviewStatusFromAgent(run?.status, assistant.text)
  if (!status) {
    return null
  }
  return {
    downloadId: thread.downloadId,
    promptId: thread.promptId || AI_OVERVIEW_PROMPT_ID,
    status,
    text: assistant.text,
    thinking: assistant.thinking,
    thinkingMs: assistant.thinkingMs ?? 0,
    error: run?.error ?? null,
    errorCode: run?.error ? 'unknown' : null,
    updatedAt: run?.updatedAt ?? assistant.createdAt
  }
}

/**
 * Map an agent run onto the prompt-run statuses the extension already polls.
 *
 * @param runStatus Agent lifecycle for the selected assistant message.
 * @param text Visible Overview answer.
 */
function overviewStatusFromAgent(
  runStatus: AgentThread['runs'][number]['status'] | undefined,
  text: string
): AiPromptRunStatus | null {
  if (runStatus === 'running') {
    return 'running'
  }
  if (runStatus === 'aborted' || runStatus === 'interrupted') {
    return 'aborted'
  }
  if (runStatus === 'error') {
    return 'error'
  }
  return text.trim() ? 'completed' : null
}

/**
 * Pick the newest matching Desktop download, preferring one that already has Overview.
 *
 * @param sourceUrl Watch URL from the extension tab.
 * @param tasks Local download history rows.
 * @param hasReusableOverview True when that download already has a showable Overview.
 */
export function findDownloadIdForSourceUrl(
  sourceUrl: string,
  tasks: readonly OverviewDownloadMatch[],
  hasReusableOverview: (downloadId: string) => boolean = () => false
): string | null {
  const identity = videoIdentityFromUrl(sourceUrl)
  if (!identity) {
    return null
  }
  const matches = tasks.filter(
    (task) => isDownloadTaskKind(task.kind) && videoIdentityFromUrl(task.input.url) === identity
  )
  if (matches.length === 0) {
    return null
  }
  const withOverview = matches.filter((task) => hasReusableOverview(task.id))
  const pool = withOverview.length > 0 ? withOverview : matches
  return [...pool].sort((left, right) => right.updatedAt - left.updatedAt)[0]?.id ?? null
}

/**
 * Reuse a Desktop download's Overview when possible; otherwise bind work to that download.
 *
 * @param input Source URL, regenerate flag, local tasks, and a live Overview lookup.
 */
export function resolveExtensionOverviewTarget(input: {
  forceRegenerate: boolean
  sourceUrl: string
  ephemeralDownloadId: string
  tasks: readonly OverviewDownloadMatch[]
  overviewFor: (downloadId: string) => AiPromptRunSnapshot | null
}): ExtensionOverviewTarget {
  if (input.forceRegenerate) {
    return { downloadId: input.ephemeralDownloadId, reused: false, snapshot: null }
  }
  const downloadId = findDownloadIdForSourceUrl(input.sourceUrl, input.tasks, (id) => {
    const snapshot = input.overviewFor(id)
    return Boolean(snapshot && isReusableOverviewSnapshot(snapshot))
  })
  if (!downloadId) {
    return { downloadId: input.ephemeralDownloadId, reused: false, snapshot: null }
  }
  const snapshot = input.overviewFor(downloadId)
  if (snapshot && isReusableOverviewSnapshot(snapshot)) {
    return { downloadId, reused: true, snapshot }
  }
  return { downloadId, reused: false, snapshot: null }
}
